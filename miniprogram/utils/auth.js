// utils/auth.js
// 当前用户 openid 只从云函数获取，并在模块内缓存，避免每个页面重复调用。
// 拿不到时返回空字符串，由调用方决定是中止操作还是提示用户。

let cachedOpenid = ''

async function getOpenid() {
  if (cachedOpenid) return cachedOpenid

  try {
    const res = await wx.cloud.callFunction({ name: 'getUserOpenId' })
    const openid = res && res.result && res.result.openid

    if (!openid) {
      console.error('getUserOpenId 未返回 openid，请确认该云函数已部署')
      return ''
    }

    cachedOpenid = openid
    return openid
  } catch (err) {
    console.error('获取 openid 失败，请确认 getUserOpenId 云函数已部署:', err)
    return ''
  }
}

module.exports = { getOpenid }
