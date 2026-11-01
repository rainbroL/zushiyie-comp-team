// 云函数：teamCreate
// 组师爺 · 创建队伍
//
// 为什么建队必须放在服务端：
// 1. 队伍编号（teamNumber）要在并发下自增，客户端算「查最大 + 1」会重号；
// 2. 人数上限（maxSize）以赛事配置为准，不能让客户端传多大就存多大；
// 3. 队长快照（members[0]）从 users 集合取，客户端无法伪造成别人；
// 4. creatorOpenid 只能来自 getWXContext，它是后续审核权限的唯一依据。

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { moderateText } = require('./moderation')

const db = cloud.database()

const COLL = {
  EVENTS: 'events',
  TEAMS: 'teams_event',
  USERS: 'users',
  // 联系方式单独存放：teams_event 是「所有用户可读」，
  // 联系方式若跟着一起见人，队长的微信号就能被任何人批量拉走。
  CONTACTS: 'team_contacts',
  // 建队配额流水：_id = `${openid}__${eventId}`，记录该用户在此赛事的建队次数。
  // 用固定 _id 而不是自增 id，是为了能放进事务按 doc 读取——
  // 事务里不能 where 查询，只有 doc(id).get()，否则并发建队可以绕过配额。
  CREATE_LOG: 'team_create_log'
}

const MIN_SIZE = 2
const HARD_MAX_SIZE = 10

// 同一赛事累计建队次数上限。队伍号只增不复用，删了再建会继续吃号，
// 配额是「刷号」最直接的止损：真要刷得换微信号，成本远高于收益。
const MAX_CREATE_PER_EVENT = 3

const LIMIT = {
  teamName: 20,
  description: 120,
  contact: 50,
  userDesc: 60
}

const ERR_TEXT = {
  INVALID_ACTION: '未知的操作类型',
  NOT_LOGIN: '未获取到用户身份，请在微信中打开',
  PARAM_MISSING: '参数不完整',
  EVENT_NOT_FOUND: '赛事不存在或已下架',
  EVENT_CLOSED: '该赛事暂未开放组队',
  PROFILE_INCOMPLETE: '请先完善个人信息（昵称、年级）',
  ALREADY_HAS_TEAM: '你在该赛事已有队伍，请先解散后再建新队',
  CREATE_QUOTA_EXCEEDED: `该赛事最多创建 ${MAX_CREATE_PER_EVENT} 支队伍，你的名额已用完`,
  NAME_REQUIRED: '请填写队伍名称',
  DESC_REQUIRED: '请填写队伍描述',
  CONTACT_REQUIRED: '请填写联系方式',
  CONTENT_REJECTED: '内容不合规，请修改后再试',
  CREATE_FAILED: '创建失败，请稍后重试'
}

class BizError extends Error {
  constructor(code, message) {
    super(message || ERR_TEXT[code] || code)
    this.code = code
    // 审核类错误需要把「具体哪里不合规」带回前端，所以允许覆盖默认文案
    this.customMessage = message || ''
  }
}

function ok(data) {
  return { ok: true, data: data || {} }
}

function fail(code, message) {
  return { ok: false, code, message: message || ERR_TEXT[code] || '操作失败' }
}

async function getDocOrNull(collection, id) {
  try {
    const res = await db.collection(collection).doc(id).get()
    return res.data || null
  } catch (err) {
    return null
  }
}

// 文本统一处理：合并空白、去首尾、截断，防止超长内容和换行破坏列表布局
function clean(value, max) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

async function getMaxTeamNumber(eventId) {
  const res = await db.collection(COLL.TEAMS)
    .where({ eventId })
    .orderBy('teamNumber', 'desc')
    .limit(1)
    .get()

  if (!res.data.length) return -1
  return Number(res.data[0].teamNumber) || 0
}

// 在事务里从赛事文档的计数器分配编号：并发请求会因写冲突而串行化，不会拿到同一个号。
// 存量赛事还没有 teamCount 字段时，以现有最大编号为起点把计数器补上。
async function allocateTeamNumber(eventId, fallbackBase, retries = 2) {
  try {
    return await db.runTransaction(async (transaction) => {
      const doc = await transaction
        .collection(COLL.EVENTS)
        .doc(eventId)
        .get()
        .then((res) => res.data)
        .catch(() => null)

      if (!doc) throw new BizError('EVENT_NOT_FOUND')

      const next = typeof doc.teamCount === 'number' ? doc.teamCount : fallbackBase + 1

      await transaction.collection(COLL.EVENTS).doc(eventId).update({
        data: { teamCount: next + 1 }
      })

      return next
    })
  } catch (err) {
    // 事务冲突说明有别人刚抢到号，重试一次就能拿到新的
    const text = String((err && (err.errMsg || err.message)) || '')
    if (retries > 0 && /transaction|conflict|冲突/i.test(text)) {
      return allocateTeamNumber(eventId, fallbackBase, retries - 1)
    }
    throw err
  }
}

// ============ 建队配额（防刷号） ============
// 队伍号从赛事计数器自增分配、且不复用，所以「建了删、删了建」就是在吃号。
// 两道闸门：同一赛事只能有一支自己的队（查队伍表，实时准确）；
//          同一赛事累计最多建 MAX_CREATE_PER_EVENT 次（查配额流水，删队也不退还）。

function logId(openid, eventId) {
  return `${openid}__${eventId}`
}

function isConflict(err) {
  const text = String((err && (err.errMsg || err.message)) || '')
  return /transaction|conflict|冲突/i.test(text)
}

// 先保证流水文档存在，事务里才能用 doc(id).get() 一定读得到。
// 不存在的情况两种：集合还没建、或这个人第一次建队。两种情况都要能落地。
async function ensureLogDoc(openid, eventId) {
  const id = logId(openid, eventId)

  try {
    await db.collection(COLL.CREATE_LOG).doc(id).get()
    return id
  } catch (err) {
    // 读不到（不存在或集合未建）继续往下补
  }

  const data = { _id: id, openid, eventId, count: 0, createTime: new Date(), lastCreateTime: null }

  try {
    await db.collection(COLL.CREATE_LOG).add({ data })
  } catch (err) {
    // 集合不存在时首次写入必然失败，建一次再试；仍失败多半是并发下别人刚建了同 _id，都属正常
    try {
      await db.createCollection(COLL.CREATE_LOG)
    } catch (e) {
      // 已存在或无权限，忽略
    }
    try {
      await db.collection(COLL.CREATE_LOG).add({ data })
    } catch (e2) {
      console.warn('[teamCreate] 配额流水补建失败，按已有记录继续', id, e2 && e2.errMsg)
    }
  }

  return id
}

// 预占一次配额：校验与自增放在同一个事务里，并发请求会被串行化，不会超发。
// 注意不在事务内抛业务错误——事务回调里抛出的错误会被 SDK 包装，
// 拿回来时已经不是 BizError，前端就只能看到「创建失败」。改成返回值判断。
async function reserveQuota(id, retries = 2) {
  let outcome
  try {
    outcome = await db.runTransaction(async (transaction) => {
      const doc = await transaction
        .collection(COLL.CREATE_LOG)
        .doc(id)
        .get()
        .then((res) => res.data)
        .catch(() => null)

      const used = (doc && Number(doc.count)) || 0
      if (used >= MAX_CREATE_PER_EVENT) return { allowed: false }

      await transaction.collection(COLL.CREATE_LOG).doc(id).update({
        data: { count: used + 1, lastCreateTime: new Date() }
      })

      return { allowed: true, used: used + 1 }
    })
  } catch (err) {
    if (retries > 0 && isConflict(err)) return reserveQuota(id, retries - 1)
    throw err
  }

  if (!outcome || !outcome.allowed) throw new BizError('CREATE_QUOTA_EXCEEDED')
  return outcome.used
}

// 建队失败时退还刚预占的名额。退不回去最多让用户少一次机会，
// 所以失败只记日志，不能反过来影响主流程的错误提示。
async function releaseQuota(id) {
  try {
    await db.runTransaction(async (transaction) => {
      const doc = await transaction
        .collection(COLL.CREATE_LOG)
        .doc(id)
        .get()
        .then((res) => res.data)
        .catch(() => null)

      const used = (doc && Number(doc.count)) || 0
      if (used <= 0) return

      await transaction.collection(COLL.CREATE_LOG).doc(id).update({
        data: { count: used - 1 }
      })
    })
  } catch (err) {
    console.warn('[teamCreate] 配额退还失败，需人工核对', id, err && err.errMsg)
  }
}

async function handleCreate(openid, event) {
  const eventId = clean(event.eventId, 64)
  if (!eventId) throw new BizError('PARAM_MISSING')

  const targetEvent = await getDocOrNull(COLL.EVENTS, eventId)
  if (!targetEvent) throw new BizError('EVENT_NOT_FOUND')
  if (targetEvent.canTeamUp === false) throw new BizError('EVENT_CLOSED')

  // 队长信息以库里的资料为准，不采信前端传来的昵称
  const userRes = await db.collection(COLL.USERS).where({ _openid: openid }).limit(1).get()
  const user = userRes.data[0] || null
  if (!user || !user.nickName || !user.grade) throw new BizError('PROFILE_INCOMPLETE')

  // ===== 闸门一：同一赛事只能有一支自己的队 =====
  // 直接查队伍表而不是查配额流水，队伍被删掉后这里立刻放行，不会留下「幽灵占用」。
  const mineRes = await db.collection(COLL.TEAMS)
    .where({ eventId, creatorOpenid: openid })
    .limit(1)
    .get()

  if (mineRes.data.length) {
    const existName = mineRes.data[0].teamName || '未命名队伍'
    throw new BizError(
      'ALREADY_HAS_TEAM',
      `你在该赛事已有队伍「${existName}」，请先解散后再建新队`
    )
  }

  const teamName = clean(event.teamName, LIMIT.teamName)
  const description = clean(event.description, LIMIT.description)
  const contact = clean(event.contact, LIMIT.contact)
  const userDesc = clean(event.userDesc, LIMIT.userDesc)

  if (!teamName) throw new BizError('NAME_REQUIRED')
  if (!description) throw new BizError('DESC_REQUIRED')
  if (!contact) throw new BizError('CONTACT_REQUIRED')

  // 内容审核放在分配编号之前：被拦下的请求不应该消耗掉一个队伍编号
  const review = await moderateText({
    texts: [
      { field: 'teamName', value: teamName, mode: 'shape' },
      { field: 'description', value: description, mode: 'full' },
      { field: 'userDesc', value: userDesc, mode: 'shape' },
      { field: 'contact', value: contact, mode: 'contact' }
    ],
    openid
  })
  if (!review.ok) throw new BizError('CONTENT_REJECTED', review.hint)

  // ===== 闸门二：预占配额 =====
  // 放在审核之后：被审核拦下的请求不该吃掉用户的名额。
  // 从这里到建队成功之间的任何失败都要把名额退回去。
  const quotaId = await ensureLogDoc(openid, eventId)
  await reserveQuota(quotaId)

  try {
    // 人数上限以赛事配置封顶，客户端只能在上限内选小，不能自己放大
    const eventMax = Number(targetEvent.maxTeamSize) || 3
    const wanted = Number(event.maxSize) || Math.min(3, eventMax)
    const maxSize = Math.max(MIN_SIZE, Math.min(wanted, eventMax, HARD_MAX_SIZE))

    const fallbackBase = typeof targetEvent.teamCount === 'number'
      ? -1
      : await getMaxTeamNumber(eventId)
    const teamNumber = await allocateTeamNumber(eventId, fallbackBase)

    const members = [{
      openid,
      name: user.nickName,
      grade: user.grade || '',
      avatar: user.avatarUrl || '👤',
      role: '队长',
      isLeader: true,
      desc: userDesc || user.bio || ''
    }]

    const teamData = {
      eventId,
      teamNumber,
      teamName,
      description,
      // 注意这里没有 contact：它写到 team_contacts，只有队员和队长能取到
      maxSize,
      isFull: members.length >= maxSize,
      members,
      creatorOpenid: openid,
      createTime: new Date()
    }

    // 云函数写入不会自动补 _openid，显式写上才能和集合的「仅创建者可读写」规则对齐。
    // 少数环境不允许显式写 _openid，被拒时去掉重试一次。
    let res
    try {
      res = await db.collection(COLL.TEAMS).add({ data: { ...teamData, _openid: openid } })
    } catch (err) {
      console.warn('[teamCreate] 显式写 _openid 被拒，降级重试', err && err.errMsg)
      res = await db.collection(COLL.TEAMS).add({ data: teamData })
    }

    const teamId = res._id

    // 联系方式以 teamId 为主键单独存一份。写失败就把队伍回滚掉，
    // 否则会出现「队伍建成了但联系不上队长」的死队，而页面没有编辑入口可以补救。
    try {
      await db.collection(COLL.CONTACTS).doc(teamId).set({
        data: { teamId, contact, creatorOpenid: openid, createTime: new Date() }
      })
    } catch (err) {
      console.error('[teamCreate] 联系方式写入失败，回滚队伍', teamId, err && err.errMsg)
      try {
        await db.collection(COLL.TEAMS).doc(teamId).remove()
      } catch (rollbackErr) {
        console.error('[teamCreate] 回滚失败，需人工删除', teamId, rollbackErr && rollbackErr.errMsg)
      }
      throw new BizError('CREATE_FAILED')
    }

    return { teamId, teamNumber, maxSize }
  } catch (err) {
    // 没建成就不该占名额：编号分配失败、建队失败、联系方式失败都走这里
    await releaseQuota(quotaId)
    throw err
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('NOT_LOGIN')

  const action = event.action || 'create'

  try {
    if (action !== 'create') throw new BizError('INVALID_ACTION')
    const data = await handleCreate(OPENID, event)
    return ok(data)
  } catch (err) {
    if (err && err.code && ERR_TEXT[err.code]) {
      return fail(err.code, err.customMessage)
    }
    console.error('[teamCreate] 执行失败', action, err)
    return fail('CREATE_FAILED')
  }
}
