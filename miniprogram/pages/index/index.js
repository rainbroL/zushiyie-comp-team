// pages/index/index.js
Page({
  data: {},

  goToEvents() {
    wx.navigateTo({ url: '/pages/event-list/event-list' })
  },

  goToMyTeams() {
    wx.navigateTo({ url: '/pages/my-teams/my-teams' })
  },

  goToProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  }
})
