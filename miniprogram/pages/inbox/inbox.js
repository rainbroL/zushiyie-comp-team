// pages/inbox/inbox.js
// 站内消息中心
//
// 消息只由云函数写入，前端不直接读 messages 集合（该集合对客户端完全关闭）。
// 页面不认识 kind 的具体含义，只照着 target 跳转——
// 以后加拼车、游戏、运动的组队页，后端换 target 就行，这里一行都不用改。
//
// 列表分两段：未读在上、已读在「更早」区，两段各自按时间倒序（新的靠上）。
// 分组在前端做而不是后端：切 tab、标已读时要立刻重排，走一趟云函数太慢。

const KIND_ICON = {
  apply_approved: '✅',
  apply_rejected: '❌',
  member_quit: '👋',
  team_kicked: '🚪',
  team_dissolved: '💥',
  notice: '📢'
}

// target: { page: '/pages/xxx/xxx', query: { id: '...' } } → 拼成真实 url
function buildUrl(target) {
  if (!target || !target.page) return ''
  const query = target.query || {}
  const qs = Object.keys(query)
    .filter((k) => query[k] !== '' && query[k] != null)
    .map((k) => `${k}=${encodeURIComponent(query[k])}`)
    .join('&')
  return qs ? `${target.page}?${qs}` : target.page
}

function dayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// 时间显示：刚刚 / Nmin前 / Nh前 / N天前
function relativeTime(value) {
  if (!value) return ''
  const d = new Date(value)
  const t = d.getTime()
  if (!t) return ''

  const ms = Math.max(0, Date.now() - t)
  if (ms < MIN) return '刚刚'
  if (ms < HOUR) return `${Math.floor(ms / MIN)}min前`
  // 不满一天一律按小时，跨零点也一样（凌晨看昨晚 11 点的消息显示「2h前」更直观）
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h前`

  // 超过一天按自然日算，避免「昨天 23:50」被四舍五入成 0 天
  const days = Math.max(1, Math.round((dayStart(new Date()) - dayStart(d)) / DAY))
  return `${days}天前`
}

// 后端返回的消息 → 页面用的条目。
// ts 单独存一份用于排序：createTime 可能是 ISODate 字符串，每次比较都 new Date 太浪费
function toItem(m) {
  const ts = m.createTime ? new Date(m.createTime).getTime() || 0 : 0
  return {
    id: m.id,
    kind: m.kind,
    icon: KIND_ICON[m.kind] || '🔔',
    title: m.title || '通知',
    desc: m.desc || '',
    read: !!m.read,
    url: buildUrl(m.target),
    timeText: relativeTime(m.createTime),
    ts
  }
}

function byTimeDesc(a, b) {
  return b.ts - a.ts
}

Page({
  data: {
    loading: true,
    unreadItems: [],
    readItems: [],
    unreadTotal: 0,
    failed: false
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  async load() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'messageCenter',
        data: { action: 'list' }
      })
      const result = (res && res.result) || {}

      if (result.code === 'NOT_LOGIN') {
        this.setData({ loading: false })
        wx.showToast({ title: '身份获取失败，请重试', icon: 'none' })
        return
      }

      const list = (result.data && result.data.items) || []
      const items = list.map(toItem).sort(byTimeDesc)

      const unreadItems = items.filter((m) => !m.read)
      const readItems = items.filter((m) => m.read)

      this.setData({
        unreadItems,
        readItems,
        // 用列表里实际未读条数，跟界面显示保持一致（后端 unreadTotal 是全量 count）
        unreadTotal: unreadItems.length,
        loading: false,
        failed: !result.ok
      })
    } catch (err) {
      console.error('加载消息失败', err)
      this.setData({ loading: false, failed: true })
    }
  },

  // 按 id 查找：分组后下标不再对应原始数组，data-index 会取错条目
  findItem(id) {
    const unread = this.data.unreadItems.find((m) => m.id === id)
    if (unread) return unread
    return this.data.readItems.find((m) => m.id === id) || null
  },

  onTapItem(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return

    const item = this.findItem(id)
    if (!item) return

    if (!item.read) this.markRead(item)

    if (!item.url) {
      wx.showToast({ title: '该消息没有可跳转的页面', icon: 'none' })
      return
    }

    wx.navigateTo({
      url: item.url,
      fail: () => {
        wx.showToast({ title: '目标页面打不开，可能已被删除', icon: 'none' })
      }
    })
  },

  // 先更新界面再发请求：点开就算已读，不该等网络返回才有反馈。
  // 界面上的动作是「从未读区移到更早区」，不是简单改个颜色
  markRead(item) {
    const unreadItems = this.data.unreadItems.filter((m) => m.id !== item.id)
    const readItems = this.data.readItems
      .concat([{ ...item, read: true }])
      .sort(byTimeDesc)

    this.setData({ unreadItems, readItems, unreadTotal: unreadItems.length })

    wx.cloud
      .callFunction({ name: 'messageCenter', data: { action: 'markRead', id: item.id } })
      .catch((err) => console.warn('标记已读失败', err))
  },

  onMarkAll() {
    const unread = this.data.unreadItems
    if (!unread.length) return

    wx.cloud
      .callFunction({ name: 'messageCenter', data: { action: 'markAll' } })
      .then(() => {
        const readItems = this.data.readItems
          .concat(unread.map((m) => ({ ...m, read: true })))
          .sort(byTimeDesc)
        this.setData({ unreadItems: [], readItems, unreadTotal: 0 })
        wx.showToast({ title: '已全部标为已读', icon: 'success' })
      })
      .catch(() => {
        wx.showToast({ title: '操作失败，请重试', icon: 'none' })
      })
  }
})
