// pages/event-list/event-list.js
// 赛事列表：分页加载。小程序端单次查询最多 20 条，
// 不分页的话第 21 个赛事之后会永远看不到。
const PAGE_SIZE = 20

Page({
  data: {
    eventList: [],
    total: 0,
    hasMore: true,
    loading: false,
    loaded: false
  },

  onLoad() {
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadPage()
  },

  async refresh() {
    // 先清空再拉第一页，this.data 是同步更新的，loadPage 里读到的 skip 才是 0
    this.setData({ eventList: [], hasMore: true, loaded: false })
    await Promise.all([this.loadTotal(), this.loadPage()])
  },

  // 总数单独取，避免「共 N 个」只统计到已加载的部分
  async loadTotal() {
    try {
      const res = await wx.cloud.database().collection('events').count()
      this.setData({ total: res.total })
    } catch (err) {
      console.error('统计赛事数量失败:', err)
    }
  },

  async loadPage() {
    if (this.data.loading || !this.data.hasMore) return

    this.setData({ loading: true })

    try {
      const res = await wx.cloud
        .database()
        .collection('events')
        .orderBy('createTime', 'desc')
        .skip(this.data.eventList.length)
        .limit(PAGE_SIZE)
        .get()

      this.setData({
        eventList: this.data.eventList.concat(res.data),
        hasMore: res.data.length === PAGE_SIZE,
        loading: false,
        loaded: true
      })
    } catch (err) {
      console.error('加载赛事失败', err)
      this.setData({ loading: false, loaded: true })
      wx.showToast({ title: '加载失败，请下拉重试', icon: 'none' })
    }
  },

  loadMore() {
    this.loadPage()
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/event-detail/event-detail?id=${id}`
    })
  }
})
