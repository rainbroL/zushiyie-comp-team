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
  USERS: 'users'
}

const MIN_SIZE = 2
const HARD_MAX_SIZE = 10

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
    contact,
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

  return { teamId: res._id, teamNumber, maxSize }
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
