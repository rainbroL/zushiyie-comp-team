// pages/event-detail/event-detail.js
Page({
  data: {
    event: null,
    eventId: ''
  },

  onLoad(options) {
    const id = options.id
    if (id) {
      this.setData({ eventId: id })
      this.loadEventDetail(id)
    }
  },

  async loadEventDetail(id) {
    const db = wx.cloud.database()
    try {
      // 1. 先获取赛事数据
      const res = await db.collection('events').doc(id).get()
      const eventData = res.data
      console.log('赛事数据:', eventData) 
      // 2. 如果赛事有 imageUrl 字段（且是 fileID 格式），就转换为临时链接
      if (eventData.imageUrl && eventData.imageUrl.startsWith('cloud://')) {
        const tempRes = await wx.cloud.getTempFileURL({
          fileList: [eventData.imageUrl]
        })
        console.log('完整 tempRes:', tempRes)
        console.log('fileList[0]:', tempRes.fileList[0])
        // 3. 将返回的临时链接替换掉原来的 fileID
        if (tempRes.fileList && tempRes.fileList.length > 0) {
          eventData.imageUrl = tempRes.fileList[0].tempFileURL
          console.log('转换后的临时链接:', eventData.imageUrl)
        }
      }
      
      // 4. 更新页面数据
      this.setData({ event: eventData })
    } catch (err) {
      console.error('加载赛事详情失败', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // 去组队（先保留原有方法，无改动）
  goToTeamDetail() {
    const eventId = this.data.eventId || this.data.event?._id
    console.log('跳转到队伍详情，eventId:', eventId)  // 加这行调试日志
    wx.navigateTo({
      url: `/pages/team-detail/team-detail?eventId=${eventId}`
    })
  },

  // 预览图片（可选）
  previewImage() {
    const event = this.data.event
    if (event && event.imageUrl) {
      wx.previewImage({
        urls: [event.imageUrl]
      })
    }
  }
})