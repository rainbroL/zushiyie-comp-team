// 云函数：teamApply
// 组师爺 · 入队申请全流程（申请 / 撤回 / 审核 / 查询上下文）
//
// 设计原则：
// 1. 身份（openid）只在服务端通过 getWXContext 获取，前端传什么都不作数；
// 2. 所有写操作在服务端校验「你是不是队长 / 你够不够资格」，前端不直接读写 applications 集合；
// 3. 申请记录使用确定性 _id（teamId__openid），由数据库天然保证同一人对同一队伍只有一条记录；
// 4. 同意入队放在事务里，避免两个人同时抢最后一个名额导致超员。

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const COLL = {
  TEAMS: 'teams_event',
  USERS: 'users',
  APPLICATIONS: 'applications'
}

const STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled'
}

const ERR_TEXT = {
  INVALID_ACTION: '未知的操作类型',
  PARAM_MISSING: '参数不完整',
  NOT_LOGIN: '未获取到用户身份，请在微信中打开',
  TEAM_NOT_FOUND: '队伍不存在或已解散',
  TEAM_FULL: '队伍人数已满',
  ALREADY_MEMBER: '你已经是该队伍成员',
  ALREADY_APPLIED: '你已提交过申请，请耐心等待审核',
  PROFILE_INCOMPLETE: '请先完善个人信息（昵称、年级）',
  NOT_LEADER: '只有队长可以处理申请',
  APPLICATION_NOT_FOUND: '申请记录不存在',
  APPLICATION_HANDLED: '该申请已被处理',
  DB_ERROR: '服务开小差了，请稍后重试'
}

// 业务异常：能被 main 捕获并原样返回给前端
class BizError extends Error {
  constructor(code) {
    super(ERR_TEXT[code] || code)
    this.code = code
  }
}

function ok(data) {
  return { ok: true, data: data || {} }
}

function fail(code) {
  return { ok: false, code, message: ERR_TEXT[code] || '操作失败' }
}

// 同一人对同一队伍的申请固定为一个文档，重复申请会被数据库直接挡住
function buildApplicationId(teamId, openid) {
  return `${teamId}__${openid}`
}

// doc().get() 在文档不存在时会抛错，这里统一转成 null
async function getDocOrNull(collection, id) {
  try {
    const res = await db.collection(collection).doc(id).get()
    return res.data || null
  } catch (err) {
    return null
  }
}

async function getUserByOpenid(openid) {
  const res = await db.collection(COLL.USERS).where({ _openid: openid }).limit(1).get()
  return res.data[0] || null
}

function isMemberOf(team, openid) {
  return (team.members || []).some((m) => m.openid === openid)
}

// ============ 申请加入 ============
async function handleApply(openid, event) {
  const { teamId, message } = event
  if (!teamId) throw new BizError('PARAM_MISSING')

  const team = await getDocOrNull(COLL.TEAMS, teamId)
  if (!team) throw new BizError('TEAM_NOT_FOUND')

  const members = team.members || []
  const maxSize = Number(team.maxSize) || 3

  if (team.creatorOpenid === openid || isMemberOf(team, openid)) {
    throw new BizError('ALREADY_MEMBER')
  }
  if (team.isFull || members.length >= maxSize) {
    throw new BizError('TEAM_FULL')
  }

  // 没有昵称和年级的申请对队长毫无信息量，直接拦在入口
  const user = await getUserByOpenid(openid)
  if (!user || !user.nickName || !user.grade) {
    throw new BizError('PROFILE_INCOMPLETE')
  }

  const applicationId = buildApplicationId(teamId, openid)
  const exist = await getDocOrNull(COLL.APPLICATIONS, applicationId)

  if (exist) {
    if (exist.status === STATUS.PENDING) throw new BizError('ALREADY_APPLIED')
    if (exist.status === STATUS.APPROVED) throw new BizError('ALREADY_MEMBER')
  }

  const payload = {
    teamId,
    eventId: team.eventId || '',
    teamName: team.teamName || '',
    teamLeaderOpenid: team.creatorOpenid || '',
    applicant: {
      openid,
      name: user.nickName,
      grade: user.grade,
      desc: user.bio || '',
      avatar: user.avatarUrl || '👤'
    },
    message: String(message || '').trim().slice(0, 80),
    status: STATUS.PENDING,
    createTime: new Date(),
    handleTime: null,
    handlerOpenid: ''
  }

  // 被拒绝过的人重新申请，复用同一条记录，避免无效数据堆积
  if (exist) {
    await db.collection(COLL.APPLICATIONS).doc(applicationId).update({ data: payload })
  } else {
    await db.collection(COLL.APPLICATIONS).add({ data: { _id: applicationId, ...payload } })
  }

  return { applicationId, status: STATUS.PENDING }
}

// ============ 申请人撤回 ============
async function handleCancel(openid, event) {
  const { teamId } = event
  if (!teamId) throw new BizError('PARAM_MISSING')

  const applicationId = buildApplicationId(teamId, openid)
  const exist = await getDocOrNull(COLL.APPLICATIONS, applicationId)
  if (!exist) throw new BizError('APPLICATION_NOT_FOUND')
  if (exist.status !== STATUS.PENDING) throw new BizError('APPLICATION_HANDLED')

  await db.collection(COLL.APPLICATIONS).doc(applicationId).update({
    data: { status: STATUS.CANCELLED, handleTime: new Date() }
  })

  return { status: STATUS.CANCELLED }
}

// ============ 队长同意 ============
// 整个「读申请 → 校验名额 → 加成员 → 改状态」放在一个事务里：
// 两个人同时被同意时，只有一个能通过名额校验，另一个会收到「队伍人数已满」。
async function handleApprove(openid, event) {
  const applicationId = event.applicationId
  if (!applicationId) throw new BizError('PARAM_MISSING')

  return await db.runTransaction(async (transaction) => {
    // 事务内读不到文档会直接抛错，这里转成业务错误，避免前端只看到「服务开小差」
    const application = await transaction
      .collection(COLL.APPLICATIONS)
      .doc(applicationId)
      .get()
      .then((res) => res.data)
      .catch(() => null)

    if (!application) throw new BizError('APPLICATION_NOT_FOUND')
    if (application.status !== STATUS.PENDING) throw new BizError('APPLICATION_HANDLED')

    const team = await transaction
      .collection(COLL.TEAMS)
      .doc(application.teamId)
      .get()
      .then((res) => res.data)
      .catch(() => null)

    if (!team) throw new BizError('TEAM_NOT_FOUND')
    if (team.creatorOpenid !== openid) throw new BizError('NOT_LEADER')

    const members = (team.members || []).slice()
    const maxSize = Number(team.maxSize) || 3

    if (isMemberOf(team, application.applicant.openid)) throw new BizError('ALREADY_MEMBER')
    if (members.length >= maxSize) throw new BizError('TEAM_FULL')

    members.push({
      openid: application.applicant.openid,
      name: application.applicant.name,
      grade: application.applicant.grade || '',
      avatar: application.applicant.avatar || '👤',
      role: '队员',
      isLeader: false,
      desc: application.message || application.applicant.desc || ''
    })

    const isFull = members.length >= maxSize

    await transaction.collection(COLL.TEAMS).doc(team._id).update({
      data: { members, isFull }
    })

    await transaction.collection(COLL.APPLICATIONS).doc(applicationId).update({
      data: {
        status: STATUS.APPROVED,
        handleTime: new Date(),
        handlerOpenid: openid
      }
    })

    return { teamId: team._id, memberCount: members.length, isFull }
  })
}

// ============ 队长拒绝 ============
async function handleReject(openid, event) {
  const applicationId = event.applicationId
  if (!applicationId) throw new BizError('PARAM_MISSING')

  const application = await getDocOrNull(COLL.APPLICATIONS, applicationId)
  if (!application) throw new BizError('APPLICATION_NOT_FOUND')
  if (application.status !== STATUS.PENDING) throw new BizError('APPLICATION_HANDLED')

  const team = await getDocOrNull(COLL.TEAMS, application.teamId)
  if (!team) throw new BizError('TEAM_NOT_FOUND')
  if (team.creatorOpenid !== openid) throw new BizError('NOT_LEADER')

  await db.collection(COLL.APPLICATIONS).doc(applicationId).update({
    data: {
      status: STATUS.REJECTED,
      handleTime: new Date(),
      handlerOpenid: openid
    }
  })

  return { status: STATUS.REJECTED }
}

// ============ 页面上下文 ============
// 一次调用返回：我是不是队长、我的申请状态、队长需要的待处理申请列表
async function handleContext(openid, event) {
  const { teamId } = event
  if (!teamId) throw new BizError('PARAM_MISSING')

  const team = await getDocOrNull(COLL.TEAMS, teamId)
  if (!team) throw new BizError('TEAM_NOT_FOUND')

  const isLeader = team.creatorOpenid === openid
  const myApplication = await getDocOrNull(
    COLL.APPLICATIONS,
    buildApplicationId(teamId, openid)
  )

  let applications = []
  if (isLeader) {
    // 只查待处理的，历史记录不占列表长度。
    // 不加 orderBy 是为了不依赖复合索引，排序放在内存里做（单队申请量很小）。
    const res = await db.collection(COLL.APPLICATIONS)
      .where({ teamId, status: STATUS.PENDING })
      .limit(50)
      .get()

    applications = res.data.sort(
      (a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime()
    )
  }

  return {
    isLeader,
    isMember: isMemberOf(team, openid),
    myStatus: myApplication ? myApplication.status : 'none',
    memberCount: (team.members || []).length,
    applications
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) return fail('NOT_LOGIN')

  const action = event && event.action

  try {
    let data
    switch (action) {
      case 'apply':
        data = await handleApply(openid, event)
        break
      case 'cancel':
        data = await handleCancel(openid, event)
        break
      case 'approve':
        data = await handleApprove(openid, event)
        break
      case 'reject':
        data = await handleReject(openid, event)
        break
      case 'context':
        data = await handleContext(openid, event)
        break
      default:
        throw new BizError('INVALID_ACTION')
    }
    return ok(data)
  } catch (err) {
    // 事务可能会把业务异常重新包装，这里按 code 判断而不是 instanceof
    if (err && err.code && ERR_TEXT[err.code]) {
      return fail(err.code)
    }
    console.error('[teamApply] 执行失败', action, err)
    return fail('DB_ERROR')
  }
}
