// 审核规则自测脚本（本地运行，不会上传到小程序或云函数）
//
// 用途：
//   1. 校验 moderation.js 的三份副本是否完全一致 —— 它们分别是
//      teamCreate / teamApply / userSave，云函数之间无法共享代码，只能复制。
//      改漏一份的症状是「建队被拦、但申请能过」，线上很难发现。
//   2. 用文件里的真实正则跑一遍样本，确认该拦的拦住、该放行的没误伤。
//
// 用法（在仓库根目录）：
//   node scripts/test-moderation.js
//
// 改规则时先在这里跑通，再部署。规则只有经过这组样本才算验证过。

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..')
const OWNERS = ['teamCreate', 'teamApply', 'userSave']

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex')

function loadRules(srcPath) {
  const src = fs.readFileSync(srcPath, 'utf8')
  const rules = []
  let pendingKey = null

  for (const raw of src.split('\n')) {
    const line = raw.trim()
    const keyMatch = line.match(/^key:\s*'(\w+)'/)
    if (keyMatch) pendingKey = keyMatch[1]

    const reMatch = line.match(/^re:\s*(\/.+\/[a-z]*),?$/)
    if (reMatch && pendingKey) {
      // eslint-disable-next-line no-eval
      rules.push({ key: pendingKey, re: eval(reMatch[1]) })
      pendingKey = null
    }
  }
  return rules
}

// ---- 1. 三份副本一致性 ----
const paths = OWNERS.map((name) => path.join(ROOT, 'cloudfunctions', name, 'moderation.js'))
const hashes = paths.map((p) => {
  if (!fs.existsSync(p)) {
    console.error(`找不到文件：${p}`)
    process.exit(1)
  }
  return md5(fs.readFileSync(p))
})

if (new Set(hashes).size !== 1) {
  console.error('三份 moderation.js 不一致，请先同步：')
  OWNERS.forEach((name, i) => console.error(`  ${name}  ${hashes[i]}`))
  console.error('\n同步方法：改完 teamCreate 那份后，复制到另外两个目录。')
  process.exit(1)
}
console.log(`三份 moderation.js 一致 (${hashes[0]})`)

// ---- 2. 提取规则 ----
const rules = loadRules(paths[0])

// 前 5 条属于 SHAPE_RULES，其余属于 PITCH_RULES（与文件中定义顺序一致）
const SHAPE = rules.slice(0, 5).map((r) => r.key)
const PITCH = rules.slice(5).map((r) => r.key)
const EXPECTED_SHAPE = ['URL', 'DOMAIN', 'PHONE', 'ACCOUNT', 'DIGITS']
const EXPECTED_PITCH = ['QR_CODE', 'OFFSITE', 'AD']

// 规则被增删时这里会报出来，提醒同步更新下面的用例集
if (SHAPE.join() !== EXPECTED_SHAPE.join() || PITCH.join() !== EXPECTED_PITCH.join()) {
  console.error('规则清单与预期不符，请检查后再扩充用例：')
  console.error(`  SHAPE = [${SHAPE}]  期望 [${EXPECTED_SHAPE}]`)
  console.error(`  PITCH = [${PITCH}]  期望 [${EXPECTED_PITCH}]`)
  process.exit(1)
}

function hit(value, mode) {
  const usable = mode === 'contact' ? rules.filter((r) => PITCH.includes(r.key)) : rules
  for (const r of usable) {
    if (r.re.test(value)) return r.key
  }
  return null
}

// ---- 3. 用例集 ----
// 每条：[文本, 字段模式, 期望命中的规则 key（null 表示应当放行）]
const CASES = [
  // 描述类，必须拦
  ['微信号：1234567890', 'shape', 'ACCOUNT'],
  ['微信 abc12345', 'shape', 'ACCOUNT'],
  ['VX：abc12345', 'shape', 'ACCOUNT'],
  ['加我微信 abc12345', 'shape', 'ACCOUNT'],
  ['QQ 123456789', 'shape', 'ACCOUNT'],
  ['微信 号 12345', 'shape', 'ACCOUNT'],
  ['微 信：1234567890', 'shape', 'ACCOUNT'],
  ['13812345678', 'shape', 'PHONE'],
  ['1234567890', 'shape', 'DIGITS'],
  ['扫码进群领资料', 'shape', 'QR_CODE'],
  ['代写数模包过', 'shape', 'AD'],
  ['https://t.cn/xxx', 'shape', 'URL'],
  ['tj.example.com', 'shape', 'DOMAIN'],

  // 描述类，必须放行（误伤检查，这几条最容易被打回）
  ['已经有初步思路，缺一个能写论文的同学', 'shape', null],
  ['三人行 · 数模 2025', 'shape', null],
  ['MATLAB 2023b', 'shape', null],
  ['我们队 3 人，2025 年比赛', 'shape', null],
  ['加我一个', 'shape', null],
  ['求一个会 Python 的队友', 'shape', null],
  ['20251012 报名截止', 'shape', null],
  ['Team Phoenix 2024', 'shape', null],
  ['负责建模与论文撰写，有省赛经验', 'shape', null],

  // contact 字段：本来就该填联系方式，只受话术规则约束
  ['12345', 'contact', null],
  ['微信：demo_test', 'contact', null],
  ['扫码加我', 'contact', 'QR_CODE']
]

let failed = 0
for (const [text, mode, expect] of CASES) {
  const got = hit(text, mode)
  const pass = got === expect
  if (!pass) failed++
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  [${mode.padEnd(7)}] ${JSON.stringify(text)}` +
      `  => ${got || '放行'}${pass ? '' : `   (期望 ${expect || '放行'})`}`
  )
}

console.log('')
console.log(`共 ${CASES.length} 条，规则 ${rules.length} 条`)
if (failed === 0) {
  console.log('全部通过')
} else {
  console.log(`${failed} 条不符合预期`)
}
process.exit(failed === 0 ? 0 : 1)
