// pages/index/index.js
Page({
  data: {
    unreadTotal: 0
  },

  // 每次回到首页都刷一次未读数，保证从消息页或队伍页返回时角标是最新的
  onShow() {
    this.loadUnread()
  },

  async loadUnread() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'messageCenter',
        data: { action: 'unreadCount' }
      })
      const result = (res && res.result) || {}
      if (result.ok) {
        this.setData({ unreadTotal: (result.data && result.data.unreadTotal) || 0 })
      }
    } catch (err) {
      // 未读数拿不到不影响首页其它内容，静默处理
      console.warn('未读数获取失败', err)
    }
  },

  goToEvents() {
    wx.navigateTo({ url: '/pages/event-list/event-list' })
  },

  goToMyTeams() {
    wx.navigateTo({ url: '/pages/my-teams/my-teams' })
  },

  goToInbox() {
    wx.navigateTo({ url: '/pages/inbox/inbox' })
  },

  goToProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  }
})
