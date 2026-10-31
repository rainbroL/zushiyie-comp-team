// 云函数：userSave
// 组师爺 · 保存个人资料
//
// 为什么必须迁到服务端：昵称和个人简介会展示给队长和队友，
// 原来由前端直连写库，任何审核都能被绕过——改一行前端代码直接 add 一条广告昵称即可。
// 现在昵称和简介统一在这里过完内容审核再落库。

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { moderateText } = require('./moderation')

const db = cloud.database()

const COLL_USERS = 'users'

const LIMIT = {
  nickName: 20,
  bio: 120
}

const ERR_TEXT = {
  NOT_LOGIN: '未获取到用户身份，请在微信中打开',
  NICKNAME_REQUIRED: '请填写昵称',
  GRADE_REQUIRED: '请选择年级',
  CONTENT_REJECTED: '内容不合规，请修改后再试',
  SAVE_FAILED: '保存失败，请稍后重试'
}

class BizError extends Error {
  constructor(code, message) {
    super(message || ERR_TEXT[code] || code)
    this.code = code
    this.customMessage = message || ''
  }
}

function ok(data) {
  return { ok: true, data: data || {} }
}

function fail(code, message) {
  return { ok: false, code, message: message || ERR_TEXT[code] || '操作失败' }
}

function clean(value, max) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

async function handleSave(openid, event) {
  const nickName = clean(event.nickName, LIMIT.nickName)
  const grade = clean(event.grade, 20)
  const bio = clean(event.bio, LIMIT.bio)

  if (!nickName) throw new BizError('NICKNAME_REQUIRED')
  if (!grade) throw new BizError('GRADE_REQUIRED')

  // 昵称短，只跑本地规则；简介长且会展示给队长，额外过官方接口
  const review = await moderateText({
    texts: [
      { field: 'nickName', value: nickName, mode: 'shape' },
      { field: 'bio', value: bio, mode: 'full' }
    ],
    openid
  })
  if (!review.ok) throw new BizError('CONTENT_REJECTED', review.hint)

  const payload = {
    nickName,
    grade,
    bio,
    updatedAt: new Date()
  }

  const exist = await db.collection(COLL_USERS).where({ _openid: openid }).limit(1).get()

  if (exist.data.length) {
    await db.collection(COLL_USERS).doc(exist.data[0]._id).update({ data: payload })
    return { created: false }
  }

  // 云函数写入不会自动补 _openid，显式写上才能和「仅创建者可读写」的规则对齐。
  // 少数环境不允许显式写 _openid，被拒时去掉重试一次。
  try {
    await db.collection(COLL_USERS).add({
      data: { ...payload, _openid: openid, createdAt: new Date() }
    })
  } catch (err) {
    console.warn('[userSave] 显式写 _openid 被拒，降级重试', err && err.errMsg)
    await db.collection(COLL_USERS).add({
      data: { ...payload, createdAt: new Date() }
    })
  }

  return { created: true }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('NOT_LOGIN')

  try {
    const data = await handleSave(OPENID, event)
    return ok(data)
  } catch (err) {
    if (err && err.code && ERR_TEXT[err.code]) return fail(err.code, err.customMessage)
    console.error('[userSave] 执行失败', err)
    return fail('SAVE_FAILED')
  }
}
