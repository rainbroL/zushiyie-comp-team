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

## 界面预览

| 首页 | 队伍列表 |
| :---: | :---: |
| <img src="docs/screenshots/01-home.jpg" width="320" /> | <img src="docs/screenshots/02-team-list.jpg" width="320" /> |
| **首页**：赛事入口与「我的队伍」聚合 | **队伍列表**：`#编号` 检索、满员筛选、队伍卡成员预览 |

| 队伍详情（已提交申请） | 队长审核 |
| :---: | :---: |
| <img src="docs/screenshots/03-team-detail.jpg" width="320" /> | <img src="docs/screenshots/04-audit.jpg" width="320" /> |
| **队伍详情**：申请后按钮变为「审核中」，可撤回 | **队长审核**：名额进度、申请人留言、同意 / 拒绝 |

四张图连起来是一条完整路径：**发现赛事 → 筛选队伍 → 提交申请 → 队长处理**。

## 技术栈

- 微信小程序原生框架（WXML / WXSS / JavaScript），无第三方 UI 库
- 云开发：云数据库（文档型）、云函数、云存储
- 基础库 `3.16.2`

## 目录结构

```
zushiyie-comp-team/
├── cloudfunctions/
│   ├── teamApply/              # 入队申请与审核（核心业务云函数）
│   ├── getUserOpenId/          # 获取当前用户 openid
│   └── initDb/                 # 一次性初始化：建集合 + 灌演示数据
├── docs/
│   └── screenshots/            # 界面预览截图
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
├── LICENSE
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
  env: 'your-env-id'
}
```

同时把自己的 `appid` 写进 `project.config.json`。

### 3. 部署云函数

三个云函数都要部署：`teamApply`、`getUserOpenId`、`initDb`。在 `cloudfunctions/` 下对应的三个目录分别右键 → **上传并部署：云端安装依赖**。

也可以用命令行一次部署一个（需先在「设置 → 安全设置」里开启服务端口）：

```bash
cli cloud functions deploy --env <环境ID> --paths ./cloudfunctions/teamApply --appid <appid> --remote-npm-install
```

> 函数刚创建时会处于 `Creating` 状态，此时上传代码会报「当前函数处于 Creating 状态」，等十几秒重试即可。

### 4. 一键初始化数据库

`initDb` 会自动建好 4 个集合，并写入 3 个赛事、8 支队伍、2 条待审核申请，省掉手工建表和造数据。

在开发者工具主窗口的 **调试器 → Console** 里执行：

```js
wx.cloud.callFunction({ name: 'initDb' })
  .then(r => console.log(JSON.stringify(r.result, null, 2)))
```

返回 `ok: true` 和四个集合的条数即为成功：

```json
{ "ok": true, "counts": { "users": 1, "events": 3, "teams_event": 8, "applications": 2 } }
```

脚本用固定 `_id` 写入，重复执行是覆盖而非堆积，随时可以再跑一次。

> **必须在 Console 里调用。** 云函数面板的「测试」没有小程序上下文，`OPENID` 为空，演示队伍会被挂到一个占位身份上，「队长审核」那套权限就用不了。

不想用演示数据的话，也可以在控制台手动建这四个集合，跳过这一步。

### 5. 设置集合权限

| 集合 | 权限 | 原因 |
| --- | --- | --- |
| `events` | 所有用户可读，仅创建者可读写 | 所有用户都要能看到赛事，写入只由 `initDb`（管理员权限）完成 |
| `teams_event` | 所有用户可读，仅创建者可读写 | 创建队伍目前由前端直接写入，靠 `_openid` 判定创建者 |
| `applications` | **所有用户不可读写** | 只允许云函数访问，杜绝越权读申请 |
| `users` | 仅创建者可读写（默认） | 前端只读自己的资料；队友信息是快照存在队伍文档的 `members` 里，不依赖读他人的 `users` |

> `applications` 选「所有用户不可读写」很关键——云函数用的是管理员权限，不受此限制，但客户端就再也拿不到别人的申请记录了。

> **两个高频坑：**
>
> 1. `events`、`teams_event` 必须**同时**包含「所有用户可读」。只选「仅创建者可读写」的话，读他人数据会被**静默过滤成空数组、而且不报错**——页面显示「暂无赛事」，控制台里数据却好好的。
> 2. 权限改完不立即生效，需要**清缓存重新编译**（或重启开发者工具）。客户端会缓存环境信息。

### 6. 编译运行

编译后先在「个人信息」填好昵称和年级，再从赛事 → 队伍 → 申请加入走一遍完整流程。队长审核要换一个微信号（或在开发者工具的「多账号调试」里开第二个模拟器）才能看到真实申请。

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
- `initDb` 会写入演示数据（虚构姓名与微信号），只适用于开发环境，上线前需清空集合
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
