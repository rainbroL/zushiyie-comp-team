// 站内消息写入模块
//
// 设计约定（改之前先看这三条）：
// 1. 只写不读。所有读取都走 messageCenter 云函数，页面永远拿不到别人的消息；
// 2. 写消息失败绝不阻断主流程——审核已经成功却因为通知写不进去而报错，代价更大；
// 3. target 用「页面路径 + 查询参数」描述跳转，前端不认识 kind，只照着跳。
//    这样以后加拼车、游戏、运动的组队页，后端换 target 就够了，页面代码不用改。
//
// 与 moderation.js 一样，云函数之间不能共享代码，需要时复制到对应函数目录。

const COLL_MESSAGES = 'messages'

const KIND = {
  APPLY_APPROVED: 'apply_approved',
  APPLY_REJECTED: 'apply_rejected',
  MEMBER_QUIT: 'member_quit',
  // 以下预留：等踢人 / 解散功能做出来直接复用，不用改表结构
  TEAM_KICKED: 'team_kicked',
  TEAM_DISSOLVED: 'team_dissolved',
  NOTICE: 'notice'
}

function trim(str, max) {
  return String(str == null ? '' : str).trim().slice(0, max)
}

async function addOnce(db, data) {
  try {
    await db.collection(COLL_MESSAGES).add({ data })
    return true
  } catch (err) {
    // 集合不存在时首次写入会失败，建一次再重试
    try {
      await db.createCollection(COLL_MESSAGES)
    } catch (e) {
      // 已存在或无权限，忽略
    }
    try {
      await db.collection(COLL_MESSAGES).add({ data })
      return true
    } catch (e2) {
      console.warn('[notify] 消息写入失败（不影响主流程）', e2 && e2.errMsg)
      return false
    }
  }
}

async function pushMessage(db, options) {
  const {
    toOpenid,
    kind,
    title,
    desc,
    bizType = 'competition',
    target = {},
    fromOpenid = '',
    refId = ''
  } = options || {}

  if (!toOpenid || !kind) return false

  const data = {
    toOpenid,
    kind,
    title: trim(title, 30),
    desc: trim(desc, 60),
    bizType, // competition / carpool / sports / game，为后续业务线预留
    target, // { page: '/pages/xxx/xxx', query: { id: '...' } }
    read: false,
    createTime: new Date(),
    fromOpenid,
    refId // 关联业务 id，便于追溯和去重
  }

  return addOnce(db, data)
}

module.exports = { pushMessage, KIND }
