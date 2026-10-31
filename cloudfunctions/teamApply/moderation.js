// 内容审核模块
// 云函数之间无法共享代码，所以这个文件在每个需要审核的云函数目录下各放一份：
// teamCreate / teamApply / userSave。改动时三处必须同步。
//
// 两层分工：
//   本地规则   —— 抓联系方式、链接、引流话术。实测官方接口把「加微信 abc12345 领资料」
//                 判为正常，所以广告只能自己拦。
//   msgSecCheck —— 兜辱骂、低俗、违法这些语义风险，这是官方接口唯一的强项。
//
// 判定不通过时会写一条 moderation_logs，用来事后看出有没有人在试探规则。

const cloud = require('wx-server-sdk')

const LOG_COLLECTION = 'moderation_logs'

// 联系方式形态：不看用户说哪种语言，只看有没有出现「像账号/链接」的字符串
const SHAPE_RULES = [
  {
    key: 'URL',
    re: /(https?:\/\/|www\.)[^\s]+/i,
    hint: '请勿填写外部链接'
  },
  {
    key: 'DOMAIN',
    re: /\b[\w-]{2,}\.(com|cn|net|org|top|xyz|cc|me|io|vip|shop|site|link|club)\b/i,
    hint: '请勿填写外部链接'
  },
  {
    key: 'PHONE',
    re: /(?<!\d)1[3-9]\d{9}(?!\d)/,
    hint: '请把联系方式填到「联系方式」一栏'
  },
  {
    key: 'ACCOUNT',
    // 「微信号」「微信 号」「微信号码」都是常见写法，中间那个「号」必须用 (?:号|号码)? 吃掉，
    // 否则「微信号：xxx」会整个漏过去。「微\s*信」是为了容忍中间插入空格。
    re: /(微\s*信|vx|wx|V信|威信|薇信|QQ|扣扣|wechat|weixin|绿泡泡|📮)\s*(?:号|号码)?\s*[:：]?\s*[a-zA-Z0-9_-]{4,}/i,
    hint: '描述里请勿填写微信号或 QQ，请填到「联系方式」一栏'
  },
  {
    key: 'DIGITS',
    // 兜住不带引导词的纯号码。9 位以上连续数字在队伍描述里几乎没有正当用途
    // （手机号 11 位、QQ 号 5~11 位、学号 8~12 位），而 8 位以内的年份、日期不会被误伤。
    re: /(?<!\d)\d{9,}(?!\d)/,
    hint: '描述里请勿填写长数字账号（手机号、QQ、学号），请填到「联系方式」一栏'
  }
]

// 引导站外联系与广告话术
// 注意：绝对不要加「加我」二字——中文里「加我一个」是「带上我」的意思，误伤率极高
const PITCH_RULES = [
  {
    key: 'QR_CODE',
    re: /(扫码|扫一扫|二维码|扫我|长按识别)/,
    hint: '请勿发布二维码或扫码引导'
  },
  {
    key: 'OFFSITE',
    re: /(加群|进群|私聊|私我|加我微信|加我好友|加个好友)/,
    hint: '请勿引导到站外联系，请使用申请功能'
  },
  {
    key: 'AD',
    re: /(代做|代写|代考|包过|日结|刷单|兼职招聘|领资料|免费领)/,
    hint: '请勿发布兼职、代做类信息'
  }
]

// 字段策略：
//   shape   —— 只跑本地规则，短文本调官方接口不划算
//   full    —— 本地规则 + msgSecCheck，长文本是广告和违规的主要载体
//   contact —— 只跑话术规则，这个字段本来就该填联系方式
function rulesFor(mode) {
  return mode === 'contact' ? PITCH_RULES : SHAPE_RULES.concat(PITCH_RULES)
}

let logCollectionReady = false

async function writeLog(db, payload) {
  try {
    if (!logCollectionReady) {
      try {
        await db.createCollection(LOG_COLLECTION)
      } catch (err) {
        // 已存在，正常情况
      }
      logCollectionReady = true
    }
    await db.collection(LOG_COLLECTION).add({
      data: { ...payload, createTime: new Date() }
    })
  } catch (err) {
    // 日志写不进去不能影响主流程
    console.warn('[moderation] 写日志失败', err && err.errMsg)
  }
}

/**
 * @param {Object} options
 * @param {Array<{field:string, value:string, mode:string}>} options.texts
 * @param {string} options.openid 调用者 openid，msgSecCheck 的 scene 2 要求必填
 * @param {number} [options.scene] 0 资料 / 1 评论 / 2 论坛社交
 * @returns {Promise<{ok:boolean, field?:string, hint?:string}>}
 */
async function moderateText({ texts, openid, scene = 2 }) {
  const db = cloud.database()

  // 第一层：本地规则。能定位到具体字段，提示也比官方接口的「内容违规」有用得多
  for (const item of texts) {
    const value = String(item.value || '')
    if (!value) continue

    for (const rule of rulesFor(item.mode)) {
      if (rule.re.test(value)) {
        await writeLog(db, {
          openid,
          field: item.field,
          rule: rule.key,
          stage: 'local',
          value: value.slice(0, 200)
        })
        return { ok: false, field: item.field, hint: rule.hint }
      }
    }
  }

  // 第二层：官方接口，只覆盖需要语义判断的长文本
  const longTexts = texts.filter((t) => t.mode === 'full' && String(t.value || '').trim())

  for (const item of longTexts) {
    const content = String(item.value).slice(0, 2500) // 接口单次上限 2500 字节
    try {
      const res = await cloud.openapi.security.msgSecCheck({
        content,
        version: 2,
        scene,
        openid
      })

      const result = res.result || {}
      if (result.suggest === 'risky') {
        await writeLog(db, {
          openid,
          field: item.field,
          rule: `msgSecCheck:${result.label || ''}`,
          stage: 'openapi',
          value: content.slice(0, 200)
        })
        return { ok: false, field: item.field, hint: '内容可能违规，请修改后再试' }
      }

      // review 表示机器判定存疑。校园场景先放行，靠事后举报兜底，
      // 否则正常内容被误拦的代价远大于放过一条可疑内容。
    } catch (err) {
      // fail-open：审核服务异常时放行，不然全站都没法建队和申请
      console.warn('[moderation] msgSecCheck 调用失败，放行', err && (err.errMsg || err.message))
    }
  }

  return { ok: true }
}

module.exports = { moderateText }
