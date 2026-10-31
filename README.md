# 组师爺 · 校园竞赛组队平台

一个用**微信小程序 + 云开发**做的校园组队工具，把「群里喊人凑队」这件事变成有赛事、有编号、有申请审核的结构化流程。

数学建模、程序设计、机器人大赛……组队信息通常散落在几十个微信群聊记录里，找不到、问不清、还容易被刷过去。这个小程序把每场赛事做成一个独立入口，队伍有固定编号可以检索，想加入就提申请，队长同意后自动进队。

---

## 功能一览

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 首页导航 | ✅ | 四个入口，赛事已开放，拼车 / 运动 / 游戏为占位 |
| 赛事列表 | ✅ | 按创建时间倒序展示 |
| 赛事详情 | ✅ | 云存储 `cloud://` 图片自动换取临时链接 |
| 队伍列表 | ✅ | 招募中 / 全部筛选、分页加载、`#编号` 搜索定位 |
| 创建队伍 | ✅ | 人数上限自动跟随赛事限制，队长信息自动写入 |
| 队伍详情 | ✅ | 成员列表、队长标识、空位提示 |
| **申请加入** | ✅ | 留言申请、状态回显、重复申请拦截 |
| **申请撤回** | ✅ | 提交后可撤回，撤回后可重新申请 |
| **队长审核** | ✅ | 待处理申请列表、同意 / 拒绝、事务保证不超员 |
| **我的队伍** | ✅ | 聚合我发起的、我加入的队伍 |
| 个人信息 | ✅ | 昵称、年级、简介，申请前强制补全 |
| 消息通知 | 🚧 | 见 Roadmap |

## 技术栈

- 微信小程序原生框架（WXML / WXSS / JavaScript），无第三方 UI 库
- 云开发：云数据库（文档型）、云函数、云存储
- 基础库 `2.20.1`

## 目录结构

```
program/
├── cloudfunctions/
│   ├── teamApply/              # 入队申请与审核（核心业务云函数）
│   └── getUserOpenId/          # 获取当前用户 openid
├── miniprogram/
│   ├── pages/
│   │   ├── index/              # 首页导航
│   │   ├── event-list/         # 赛事列表（分页）
│   │   ├── event-detail/       # 赛事详情
│   │   ├── team-detail/        # 某赛事下的队伍列表 + 筛选 + 分页
│   │   ├── team-create/        # 创建队伍
│   │   ├── team-detail-view/   # 队伍详情 / 申请加入 / 队长审核
│   │   ├── my-teams/           # 我的队伍
│   │   └── profile/            # 个人信息
│   ├── utils/
│   │   └── auth.js             # 统一获取并缓存 openid
│   └── app.js                  # 云开发环境初始化
├── .gitignore
└── project.config.json
```

## 数据模型

### `users` — 用户资料

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_openid` | string | 微信自动写入，用户唯一标识 |
| `nickName` | string | 昵称 |
| `grade` | string | 年级（大一 ~ 研究生及以上） |
| `bio` | string | 个人简介，申请时会一并展示给队长 |
| `avatarUrl` | string | 头像 |
| `createdAt` / `updatedAt` | Date | |

### `events` — 赛事

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 赛事名称 |
| `description` | string | 赛事说明 |
| `imageUrl` | string | 云存储 fileID（`cloud://` 开头） |
| `maxTeamSize` | number | 每队人数上限，创建队伍时强校验 |
| `canTeamUp` | boolean | 是否开放组队。为 `false` 时赛事详情页不显示「去组队」按钮 |
| `createTime` | Date | 列表排序依据 |

### `teams_event` — 参赛队伍

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `eventId` | string | 所属赛事 |
| `teamNumber` | number | 队伍编号，列表里用 `#编号` 搜索 |
| `teamName` | string | 队伍名称 |
| `description` | string | 队伍描述 |
| `contact` | string | 队长联系方式 |
| `maxSize` | number | 人数上限 |
| `isFull` | boolean | 是否满员 |
| `members` | array | 成员数组，元素见下 |
| `creatorOpenid` | string | 队长 openid，**所有权限校验的依据** |
| `createTime` | Date | |

`members[]` 元素结构：

```json
{
  "openid": "oXXXX",
  "name": "陈同学",
  "grade": "大二",
  "avatar": "👤",
  "role": "队长",
  "isLeader": true,
  "desc": "擅长 Python 与可视化"
}
```

### `applications` — 入队申请

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 固定为 `${teamId}__${openid}`，天然去重 |
| `teamId` / `eventId` / `teamName` | string | 冗余字段，便于列表直接展示 |
| `teamLeaderOpenid` | string | 队长 openid（冗余字段，便于后续按队长维度查询） |
| `applicant` | object | 申请人信息快照 `{ openid, name, grade, desc, avatar }` |
| `message` | string | 申请留言，上限 80 字 |
| `status` | string | `pending` / `approved` / `rejected` / `cancelled` |
| `createTime` / `handleTime` | Date | |
| `handlerOpenid` | string | 处理人 openid |

状态流转：

```
none ──申请──> pending ──同意──> approved（写入 members，占一个名额）
                  │
                  ├──拒绝──> rejected ──重新申请──> pending
                  └──撤回──> cancelled ──重新申请──> pending
```

## 快速开始

### 1. 导入项目

微信开发者工具 → 导入项目 → 选择本目录。

### 2. 配置云开发环境

`miniprogram/app.js` 里把 `env` 换成你自己的云环境 ID（云开发控制台首页可查）：

```js
globalData: {
  env: 'your-env-id',
  userInfo: null
}
```

同时把自己的 `appid` 写进 `project.config.json`。

### 3. 创建集合

在云开发控制台 → 数据库中新建 4 个集合：

```
users
events
teams_event
applications
```

### 4. 设置集合权限

| 集合 | 权限 | 原因 |
| --- | --- | --- |
| `users` | 所有用户可读，仅创建者可读写 | 需要展示队友信息 |
| `events` | 所有用户可读 | 内容由管理端维护 |
| `teams_event` | 所有用户可读，仅创建者可读写 | 创建队伍目前由前端直接写入 |
| `applications` | **所有用户不可读写** | 只允许云函数访问，杜绝越权读申请 |

> `applications` 选「所有用户不可读写」很关键——云函数用的是管理员权限，不受此限制，但客户端就再也拿不到别人的申请记录了。

### 5. 部署云函数

在 `cloudfunctions/teamApply` 目录右键 → **上传并部署：云端安装依赖**。

### 6. 灌入几条赛事数据

在 `events` 集合里手动添加文档，字段参考上面「数据模型」，注意 `createTime` 要选**日期**类型：

```json
{
  "title": "全国大学生数学建模竞赛",
  "description": "三人一队，72 小时完成一篇建模论文。校内报名截止 9 月 20 日。",
  "imageUrl": "",
  "maxTeamSize": 3,
  "canTeamUp": true,
  "createTime": "2026-09-01T00:00:00.000Z"
}
```

### 7. 编译运行

先在「个人信息」页填好昵称和年级，再去赛事 → 队伍 → 申请加入，全流程即可跑通。

## 安全设计

这个项目的写操作分两类，处理方式不同：

**1. 身份只来自服务端**

云函数通过 `cloud.getWXContext()` 拿 `OPENID`，前端传什么身份参数都不采信。申请记录里的 `applicant` 是服务端从 `users` 集合查出来写入的快照，客户端无法伪造成别人。

**2. 权限判断集中在云函数**

「是不是队长」由 `team.creatorOpenid === openid` 判定，判定逻辑不在前端。即使有人改前端代码把「同意」按钮点出来，云函数也会返回 `NOT_LEADER`。

**3. 确定性 `_id` 做去重**

申请记录的 `_id` 固定为 `${teamId}__${openid}`，同一人对同一队伍只能存在一条文档。不需要额外写「查询是否已申请」的防重逻辑，数据库层面就不会产生重复。被拒绝过的人重新申请时覆盖同一条记录，不会堆积无效数据。

**4. 同意入队走事务**

`handleApprove` 把「读申请 → 校验名额 → 加成员 → 改状态」包在 `db.runTransaction` 里。两个人同时抢最后一个名额时，只有一个能提交成功，另一个会收到「队伍人数已满」，不会出现 4 人挤进 3 人队的情况。

**5. 业务错误统一返回**

云函数返回 `{ ok, code, message }`，前端按 `code` 分流：`PROFILE_INCOMPLETE` 引导去完善资料，`ALREADY_APPLIED` 刷新状态，其余直接提示。前端不需要自己猜错误原因。

## 已知限制

- **创建队伍仍在前端直连写库**，理论上 `maxSize`、`isFull` 可被客户端篡改（入队环节有服务端二次校验兜底，不会被绕过成超员）
- **联系方式明文存储**，目前对所有能打开该队伍详情页的人可见，未做「仅成员可见」的限制
- **队伍编号自增**采用「查最大值 + 1」，高并发下可能重号
- 赛事数据依赖控制台手工维护，没有后台管理界面
- 没有消息通知，申请与审核结果需要用户自己回页面查看

## Roadmap

- [ ] 创建队伍迁移到云函数，统一收口写操作
- [ ] 联系方式仅对已通过审核的成员可见
- [ ] 订阅消息：有人申请、申请通过时推送通知
- [ ] 队伍编号改用独立计数器集合，避免并发重号
- [ ] 赛事分区（院级 / 校级 / 省级）与搜索

## License

[MIT](./LICENSE)

---

> 如果你 fork 了这份代码想跑起来，需要自己的小程序 appid 和云开发环境，不能直接用仓库里的配置。
