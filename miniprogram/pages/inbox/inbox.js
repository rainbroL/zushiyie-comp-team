// pages/inbox/inbox.js
// 站内消息中心
//
// 消息只由云函数写入，前端不直接读 messages 集合（该集合对客户端完全关闭）。
// 页面不认识 kind 的具体含义，只照着 target 跳转——
// 以后加拼车、游戏、运动的组队页，后端换 target 就行，这里一行都不用改。

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

function relativeTime(value) {
  if (!value) return ''
  const d = new Date(value)
  const t = d.getTime()
  if (!t) return ''

  const now = new Date()
  const diff = now.getTime() - t
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 24 * 60 * 60 * 1000 && dayStart(now) === dayStart(d)) {
    return `${Math.floor(diff / 3600000)} 小时前`
  }

  const days = Math.round((dayStart(now) - dayStart(d)) / 86400000)
  if (days === 1) return '昨天'
  if (days === 2) return '前天'
  if (days > 2 && days < 7) return `${days} 天前`

  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`
}

Page({
  data: {
    loading: true,
    items: [],
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
      const items = list.map((m) => ({
        id: m.id,
        kind: m.kind,
        icon: KIND_ICON[m.kind] || '🔔',
        title: m.title || '通知',
        desc: m.desc || '',
        read: !!m.read,
        url: buildUrl(m.target),
        timeText: relativeTime(m.createTime)
      }))

      this.setData({
        items,
        unreadTotal: (result.data && result.data.unreadTotal) || 0,
        loading: false,
        failed: !result.ok
      })
    } catch (err) {
      console.error('加载消息失败', err)
      this.setData({ loading: false, failed: true })
    }
  },

  onTapItem(e) {
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.items[index]
    if (!item) return

    if (!item.read) this.markRead(index, item.id)

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

  // 先更新界面再发请求：点开就算已读，不该等网络返回才有反馈
  markRead(index, id) {
    const items = this.data.items.slice()
    if (!items[index] || items[index].read) return
    items[index].read = true
    this.setData({
      items,
      unreadTotal: Math.max(0, this.data.unreadTotal - 1)
    })

    wx.cloud
      .callFunction({ name: 'messageCenter', data: { action: 'markRead', id } })
      .catch((err) => console.warn('标记已读失败', err))
  },

  onMarkAll() {
    const unread = this.data.unreadTotal
    if (!unread) return

    wx.cloud
      .callFunction({ name: 'messageCenter', data: { action: 'markAll' } })
      .then(() => {
        const items = this.data.items.map((m) => ({ ...m, read: true }))
        this.setData({ items, unreadTotal: 0 })
        wx.showToast({ title: '已全部标为已读', icon: 'success' })
      })
      .catch(() => {
        wx.showToast({ title: '操作失败，请重试', icon: 'none' })
      })
  }
})
