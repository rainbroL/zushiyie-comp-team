// app.js
App({
  globalData: {
    // 云开发环境 ID，换环境时只改这一处
    env: 'cloud1-d5gmo9hjqac778817'
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }

    wx.cloud.init({
      env: this.globalData.env,
      traceUser: true
    })
  }
})
