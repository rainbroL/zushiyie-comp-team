// cloudfunctions/initDb/index.js
// 一次性初始化：建集合 + 灌演示数据。
// 幂等设计：所有文档使用固定 _id，重复执行是覆盖而非堆积。
// 权限：仅 INIT_DB_OWNERS 环境变量里的 openid 可调用，其余一律 FORBIDDEN。
//      上线前应直接删除本云函数，演示数据也不该留在生产环境。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLL = {
  USERS: 'users',
  EVENTS: 'events',
  TEAMS: 'teams_event',
  APPS: 'applications',
  CONTACTS: 'team_contacts',
  MESSAGES: 'messages'
}

const MINE = 'seed_team_mine'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// doc(id).set() 的 data 里不能再带 _id，否则报 -501007「不能更新_id的值」
function withoutId(doc) {
  const { _id, ...rest } = doc
  return rest
}

function member(openid, name, grade, isLeader, desc) {
  return {
    openid,
    name,
    grade,
    avatar: '👤',
    role: isLeader ? '队长' : '成员',
    isLeader: !!isLeader,
    desc: desc || ''
  }
}

// 赛事：canTeamUp 决定详情页是否出现「去组队」按钮，漏了就会显示成「仅展示」
const EVENTS = [
  {
    _id: 'seed_event_design',
    title: '中国大学生计算机设计大赛',
    description: '按作品参赛，设软件应用与开发、数媒设计等赛道。3-5 人组队，需在 4 月前完成一个完整作品并提交演示视频。',
    imageUrl: '',
    maxTeamSize: 5,
    canTeamUp: true,
    createTime: new Date(Date.now() - 1 * DAY)
  },
  {
    _id: 'seed_event_lanqiao',
    title: '蓝桥杯全国软件和信息技术专业人才大赛',
    description: '省赛 4 月、国赛 6 月。个人赛为主，也设团队赛，适合练算法基础。校内组织报名。',
    imageUrl: '',
    maxTeamSize: 3,
    canTeamUp: true,
    createTime: new Date(Date.now() - 2 * DAY)
  },
  {
    _id: 'seed_event_math',
    title: '全国大学生数学建模竞赛',
    description: '三人一队，72 小时完成一篇建模论文。校内报名截止 9 月 20 日，答辩在 10 月初。',
    imageUrl: '',
    maxTeamSize: 3,
    canTeamUp: true,
    createTime: new Date(Date.now() - 3 * DAY)
  }
]

async function ensureCollections() {
  const out = []
  for (const name of Object.values(COLL)) {
    try {
      await db.createCollection(name)
      out.push(`${name}: 已创建`)
    } catch (err) {
      // -501001 / ResourceExist 都表示集合已存在，属正常情况
      out.push(`${name}: 已存在`)
    }
  }
  return out
}

async function seed(payload) {
  const { OPENID } = cloud.getWXContext()
  const ownerOpenid = OPENID || 'seed_owner_openid'
  const nickName = payload.nickName || '林见鹿'
  const grade = payload.grade || '2024级'
  const bio = payload.bio || '想找靠谱队友，一起把比赛做完。'
  const myTeamName = payload.teamName || '数模三人组'

  const collections = await ensureCollections()

  // ---------- 1. 赛事 ----------
  for (const item of EVENTS) {
    await db.collection(COLL.EVENTS).doc(item._id).set({ data: withoutId(item) })
  }

  // ---------- 2. 当前用户的资料（已存在则不覆盖） ----------
  const existUser = await db.collection(COLL.USERS)
    .where({ _openid: ownerOpenid })
    .limit(1)
    .get()

  if (existUser.data.length === 0) {
    const userData = {
      _openid: ownerOpenid,
      nickName,
      grade,
      bio,
      avatarUrl: '',
      createTime: new Date(Date.now() - 5 * DAY)
    }
    try {
      await db.collection(COLL.USERS).add({ data: userData })
    } catch (err) {
      // 个别环境不允许显式写入 _openid，退化为普通写入，资料由用户自己在「我的」里补
      delete userData._openid
      await db.collection(COLL.USERS).add({ data: userData })
    }
  }

  // ---------- 3. 队伍 ----------
  // 编号在每个赛事内独立递增，队伍列表按 teamNumber 升序
  const teams = [
    {
      _id: MINE,
      eventId: 'seed_event_math',
      teamNumber: 0,
      teamName: myTeamName,
      description: '已经有初步思路了，缺一个能写论文、愿意熬夜的。',
      contact: '微信：zushiyie_demo',
      maxSize: 3,
      isFull: false,
      members: [member(ownerOpenid, nickName, grade, true, bio)],
      creatorOpenid: ownerOpenid,
      createTime: new Date(Date.now() - 4 * DAY)
    },
    {
      _id: 'seed_team_a',
      eventId: 'seed_event_math',
      teamNumber: 1,
      teamName: '三人行',
      description: '去年省二，今年想冲省一。需要会写代码的同学。',
      contact: '微信：zhousiyuan_2023',
      maxSize: 3,
      isFull: false,
      members: [
        member('seed_openid_zhou', '周思远', '2023级', true, '负责建模，熟悉 LaTeX'),
        member('seed_openid_su', '苏念', '2024级', false, '负责数据处理')
      ],
      creatorOpenid: 'seed_openid_zhou',
      createTime: new Date(Date.now() - 3 * DAY)
    },
    {
      _id: 'seed_team_b',
      eventId: 'seed_event_math',
      teamNumber: 2,
      teamName: '建模小分队',
      description: '三人已齐，名额满了。想一起讨论的可以加群。',
      contact: '微信：he_mingzhe',
      maxSize: 3,
      isFull: true,
      members: [
        member('seed_openid_he', '何明哲', '2023级', true, '统筹与写作'),
        member('seed_openid_zheng', '郑雨桐', '2024级', false, '编程实现'),
        member('seed_openid_lu', '陆嘉禾', '2023级', false, '数据分析')
      ],
      creatorOpenid: 'seed_openid_he',
      createTime: new Date(Date.now() - 3 * DAY + 2 * HOUR)
    },
    {
      _id: 'seed_team_c',
      eventId: 'seed_event_math',
      teamNumber: 3,
      teamName: '夜猫子',
      description: '习惯晚上干活，缺两个人。基础一般但愿意学也行。',
      contact: '微信：shenzhiwei',
      maxSize: 3,
      isFull: false,
      members: [member('seed_openid_shen', '沈知微', '2024级', true, '第一次参赛，想认真准备')],
      creatorOpenid: 'seed_openid_shen',
      createTime: new Date(Date.now() - 2 * DAY)
    },
    {
      _id: 'seed_team_d',
      eventId: 'seed_event_math',
      teamNumber: 4,
      teamName: '城南旧事',
      description: '两人组，缺一个会 MATLAB 的。已经看完两篇往年优秀论文。',
      contact: '微信：guqingshan',
      maxSize: 3,
      isFull: false,
      members: [
        member('seed_openid_gu', '顾青山', '2023级', true, '擅长写作与排版'),
        member('seed_openid_wen', '温言', '2024级', false, '负责数据预处理')
      ],
      creatorOpenid: 'seed_openid_gu',
      createTime: new Date(Date.now() - 1 * DAY)
    },
    {
      _id: 'seed_team_e',
      eventId: 'seed_event_lanqiao',
      teamNumber: 0,
      teamName: '蓝桥备赛组',
      description: '每周两次集体刷题，缺一个人凑齐队伍赛。',
      contact: '微信：lanqiao_group',
      maxSize: 3,
      isFull: false,
      members: [
        member('seed_openid_liu', '刘一鸣', '2023级', true, '主攻动态规划'),
        member('seed_openid_xu', '许知意', '2024级', false, '主攻图论')
      ],
      creatorOpenid: 'seed_openid_liu',
      createTime: new Date(Date.now() - 2 * DAY)
    },
    {
      _id: 'seed_team_f',
      eventId: 'seed_event_lanqiao',
      teamNumber: 1,
      teamName: '代码补全计划',
      description: '已满员，正在准备省赛。',
      contact: '微信：code_plan',
      maxSize: 3,
      isFull: true,
      members: [
        member('seed_openid_tan', '谭斯予', '2022级', true, '带队参加过两届'),
        member('seed_openid_mo', '莫离', '2023级', false, '算法基础扎实'),
        member('seed_openid_fan', '樊小雨', '2024级', false, '负责调试与测试')
      ],
      creatorOpenid: 'seed_openid_tan',
      createTime: new Date(Date.now() - 1 * DAY)
    },
    {
      _id: 'seed_team_g',
      eventId: 'seed_event_design',
      teamNumber: 0,
      teamName: '像素工坊',
      description: '做一款校园二手交易小程序参赛，需要一名会做视觉设计的同学。',
      contact: '微信：pixel_workshop',
      maxSize: 5,
      isFull: false,
      members: [
        member('seed_openid_ye', '叶知秋', '2023级', true, '负责前端开发'),
        member('seed_openid_qin', '秦朗', '2024级', false, '负责后端与数据')
      ],
      creatorOpenid: 'seed_openid_ye',
      createTime: new Date(Date.now() - 1 * DAY)
    }
  ]

  for (const item of teams) {
    // 联系方式与队伍拆开写：teams_event 是「所有用户可读」，contact 留在里面
    // 就等于把队长微信号公开给任何人。
    const { contact, ...teamBody } = item
    await db.collection(COLL.TEAMS).doc(item._id).set({ data: withoutId(teamBody) })
    if (contact) {
      await db.collection(COLL.CONTACTS).doc(item._id).set({
        data: {
          teamId: item._id,
          contact,
          creatorOpenid: item.creatorOpenid || '',
          createTime: item.createTime || new Date()
        }
      })
    }
  }

  // ---------- 4. 指向「我的队」的待处理申请 ----------
  // _id 必须符合 ${teamId}__${openid}，云函数 approve 阶段会按这个格式回写
  const applications = [
    {
      _id: `${MINE}__seed_applicant_1`,
      teamId: MINE,
      eventId: 'seed_event_math',
      teamName: myTeamName,
      teamLeaderOpenid: ownerOpenid,
      applicant: {
        openid: 'seed_applicant_1',
        name: '林晓',
        grade: '2024级',
        desc: '做过两届国赛，负责建模与求解',
        avatar: '👤'
      },
      message: '看到你们队还缺人，我负责过建模部分，可以聊聊分工吗？',
      status: 'pending',
      createTime: new Date(Date.now() - 2 * HOUR),
      handleTime: null,
      handlerOpenid: ''
    },
    {
      _id: `${MINE}__seed_applicant_2`,
      teamId: MINE,
      eventId: 'seed_event_math',
      teamName: myTeamName,
      teamLeaderOpenid: ownerOpenid,
      applicant: {
        openid: 'seed_applicant_2',
        name: '陈子航',
        grade: '2023级',
        desc: '会 Python 和 MATLAB，想跟着做一次完整的比赛',
        avatar: '👤'
      },
      message: '我时间比较充裕，晚上和周末都能配合，愿意做数据预处理这块。',
      status: 'pending',
      createTime: new Date(Date.now() - 40 * 60 * 1000),
      handleTime: null,
      handlerOpenid: ''
    }
  ]

  for (const item of applications) {
    await db.collection(COLL.APPS).doc(item._id).set({ data: withoutId(item) })
  }

  // ---------- 5. 统计 ----------
  const counts = {}
  for (const name of Object.values(COLL)) {
    const res = await db.collection(name).count()
    counts[name] = res.total
  }

  return {
    ok: true,
    collections,
    counts,
    ownerOpenid,
    myTeamId: MINE,
    tip: '现在去小程序里：进「数学建模」赛事看队伍列表，进「数模三人组」看审核列表'
  }
}

// ---------- 联系方式迁移 ----------
// 早期版本把 contact 存在 teams_event 里，而该集合是「所有用户可读」，
// 等于把队长微信号公开。这个动作把 contact 搬到 team_contacts 并从队伍文档删除。
// 幂等：只处理还带 contact 字段的队伍，重复执行会直接返回 moved: 0。
async function migrateContacts() {
  const _ = db.command
  // team_contacts 可能是新建的，先确保存在（已存在会被忽略）
  const collections = await ensureCollections()
  let moved = 0

  // 每轮把匹配到的搬走，下一轮查询自然只剩没搬的，不依赖 offset 翻页
  for (let round = 0; round < 50; round++) {
    const res = await db.collection(COLL.TEAMS)
      .where({ contact: _.exists(true) })
      .limit(100)
      .get()

    if (!res.data.length) break

    for (const team of res.data) {
      const contact = String(team.contact || '').trim()
      if (contact) {
        await db.collection(COLL.CONTACTS).doc(team._id).set({
          data: {
            teamId: team._id,
            contact,
            creatorOpenid: team.creatorOpenid || '',
            createTime: team.createTime || new Date()
          }
        })
        moved++
      }
      await db.collection(COLL.TEAMS).doc(team._id).update({
        data: { contact: _.remove() }
      })
    }

    if (res.data.length < 100) break
  }

  const total = await db.collection(COLL.CONTACTS).count()
  return {
    ok: true,
    action: 'migrateContacts',
    collections,
    moved,
    contactDocs: total.total,
    tip: moved
      ? `已迁移 ${moved} 条联系方式到 team_contacts 并清理原字段`
      : '没有需要迁移的队伍（contact 字段已全部清除或本来就没有）'
  }
}

// 允许执行 seed / status 的 openid 白名单，取自云函数环境变量 INIT_DB_OWNERS。
// 放进环境变量而不是写死在这里，是为了让仓库里不出现任何真实身份信息。
function allowedOwners() {
  return (process.env.INIT_DB_OWNERS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

exports.main = async (event = {}) => {
  const action = event.action || 'seed'
  const { OPENID } = cloud.getWXContext()

  // whoami 不鉴权：调用者只能拿到自己的 openid，没有越权问题。
  // 用途是首次部署后查出自己的 openid，填进 INIT_DB_OWNERS。
  if (action === 'whoami') {
    return {
      ok: true,
      action,
      openid: OPENID || '',
      tip: '把 openid 填进云函数的 INIT_DB_OWNERS 环境变量，之后才能执行 seed'
    }
  }

  // 核心闸门：initDb 会覆盖演示数据，绝不能允许任意小程序用户调用
  const owners = allowedOwners()
  if (!owners.includes(OPENID)) {
    console.warn('[initDb] 拒绝未授权调用', { action, openid: OPENID || '(空)' })
    return {
      ok: false,
      action,
      code: 'FORBIDDEN',
      message: owners.length
        ? 'initDb 仅限管理员调用，当前 openid 不在 INIT_DB_OWNERS 白名单内'
        : '尚未配置白名单：请先在云函数环境变量里设置 INIT_DB_OWNERS',
      openid: OPENID || '(空，说明不是在模拟器/真机里调用，取不到 OPENID)'
    }
  }

  try {
    if (action === 'status') {
      const counts = {}
      for (const name of Object.values(COLL)) {
        try {
          const res = await db.collection(name).count()
          counts[name] = res.total
        } catch (err) {
          counts[name] = '集合不存在'
        }
      }
      return { ok: true, counts }
    }

    if (action === 'migrateContacts') {
      return await migrateContacts()
    }

    return await seed(event)
  } catch (err) {
    console.error('[initDb] 失败', action, err)
    return {
      ok: false,
      action,
      error: err.message || String(err),
      hint: '若提示集合不存在或权限错误，请先在云开发控制台手动建好五个集合'
    }
  }
}
