// 云函数：checkOpenapi
// 探路用：验证当前云环境能否真正调通微信内容安全接口。
// 只做一次最小调用，不读写任何业务数据，测完可随时删除。
//
// 调用方式（开发者工具 Console）：
//   wx.cloud.callFunction({ name: 'checkOpenapi' }).then(r => console.log(r.result))
// 也可以传自定义文本试探判定结果：
//   wx.cloud.callFunction({ name: 'checkOpenapi', data: { content: '加微信 abc12345 领资料' } })

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const content = String(event.content || '今天下午去图书馆自习，有一起的吗')

  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content,
      version: 2,
      scene: 2,          // 0 资料 / 1 评论 / 2 论坛社交
      openid: OPENID     // scene 为 1/2/3 时必填，云调用不会自动带
    })

    return {
      ok: true,
      sent: content,
      suggest: res.result && res.result.suggest,  // pass / review / risky
      label: res.result && res.result.label,      // 100 正常，其余为违规类型
      detail: res.result && res.result.detail,
      tip: '能返回 suggest 就说明接口链路是通的'
    }
  } catch (err) {
    return {
      ok: false,
      sent: content,
      errCode: err.errCode !== undefined ? err.errCode : null,
      errMsg: err.errMsg || err.message || String(err),
      tip: '报 permissions / openapi 相关错误说明该环境调不了微信接口'
    }
  }
}
