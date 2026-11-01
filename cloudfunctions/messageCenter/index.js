// 云函数：messageCenter
// 组师爺 · 站内消息中心（只读 + 已读标记，消息只由其他云函数写入）
//
// 设计原则：
// 1. 所有查询强制带 toOpenid = 当前 OPENID，前端传别人的 id 也读不到；
// 2. messages 集合对客户端完全关闭，页面只能通过这里拿数据；
// 3. 不用 orderBy 而是取回内存排序，避免额外依赖复合索引（消息量在百条以内）。

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COLL_MESSAGES = 'messages'
const PAGE_LIMIT = 100

const ERR_TEXT = {
  INVALID_ACTION: '未知的操作类型',
  PARAM_MISSING: '参数不完整',
  NOT_LOGIN: '未获取到用户身份，请在微信中打开',
  DB_ERROR: '服务开小差了，请稍后重试'
}

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

async function ensureCollection() {
  try {
    await db.createCollection(COLL_MESSAGES)
  } catch (err) {
    // 已存在属正常，其它错误交给上层决定
  }
}

// 只把页面需要的字段送出去，避免把内部字段（fromOpenid 等）暴露给客户端
function shape(doc) {
  return {
    id: doc._id,
    kind: doc.kind,
    title: doc.title,
    desc: doc.desc,
    bizType: doc.bizType || 'competition',
    target: doc.target || null,
    read: !!doc.read,
    createTime: doc.createTime || null
  }
}

// ============ 列表 ============
async function handleList(openid) {
  let res
  try {
    res = await db.collection(COLL_MESSAGES)
      .where({ toOpenid: openid })
      .limit(PAGE_LIMIT)
      .get()
  } catch (err) {
    // 集合还没建（一条消息都没产生过）时，直接当成空列表
    await ensureCollection()
    return { items: [], unreadTotal: 0, total: 0 }
  }

  const items = res.data.sort(
    (a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime()
  )

  const unreadTotal = items.filter((m) => !m.read).length

  return {
    items: items.map(shape),
    unreadTotal,
    total: items.length
  }
}

// ============ 未读数（首页角标用，尽量轻） ============
async function handleUnreadCount(openid) {
  try {
    const res = await db.collection(COLL_MESSAGES)
      .where({ toOpenid: openid, read: false })
      .count()
    return { unreadTotal: res.total }
  } catch (err) {
    return { unreadTotal: 0 }
  }
}

// ============ 标记已读 ============
async function handleMarkRead(openid, event) {
  const id = event.id
  if (!id) throw new BizError('PARAM_MISSING')

  // 带 toOpenid 条件，别人拿到 id 也改不了你的消息
  const res = await db.collection(COLL_MESSAGES)
    .where({ _id: id, toOpenid: openid })
    .update({ data: { read: true } })

  return { updated: res.stats.updated }
}

async function handleMarkAll(openid) {
  const res = await db.collection(COLL_MESSAGES)
    .where({ toOpenid: openid, read: false })
    .update({ data: { read: true } })

  return { updated: res.stats.updated }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('NOT_LOGIN')

  const action = event.action || 'list'

  try {
    switch (action) {
      case 'list':
        return ok(await handleList(OPENID))
      case 'unreadCount':
        return ok(await handleUnreadCount(OPENID))
      case 'markRead':
        return ok(await handleMarkRead(OPENID, event))
      case 'markAll':
        return ok(await handleMarkAll(OPENID))
      default:
        return fail('INVALID_ACTION')
    }
  } catch (err) {
    if (err && err.code && ERR_TEXT[err.code]) return fail(err.code)
    console.error('[messageCenter] 执行失败', action, err)
    return fail('DB_ERROR')
  }
}
