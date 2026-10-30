// pages/team-detail/team-detail.js
// 某场赛事下的队伍列表：筛选 + 分页 + #编号定位
const PAGE_SIZE = 20

Page({
  data: {
    eventId: '',
    eventName: '',
    teamList: [],
    filter: 'recruiting', // recruiting = 只看招募中，all = 全部（含已满）
    searchValue: '',
    hasMore: true,
    loading: false,
    loaded: false
  },

  onLoad(options) {
    const eventId = options.eventId
    if (!eventId) {
      wx.showToast({ title: '缺少赛事参数', icon: 'none' })
      return
    }
    this.setData({ eventId })
    this.loadEventInfo(eventId)
    this.refreshList()
  },

  onReachBottom() {
    this.loadPage()
  },

  onPullDownRefresh() {
    this.refreshList().then(() => wx.stopPullDownRefresh())
  },

  async loadEventInfo(eventId) {
    try {
      const res = await wx.cloud.database().collection('events').doc(eventId).get()
      this.setData({ eventName: res.data.title })
    } catch (err) {
      console.error('加载赛事信息失败', err)
    }
  },

  // 切换筛选时列表要清空重拉，否则 skip 会算错
  onFilterTap(e) {
    const filter = e.currentTarget.dataset.filter
    if (filter === this.data.filter) return
    this.setData({ filter })
    this.refreshList()
  },

  async refreshList() {
    this.setData({ teamList: [], hasMore: true, loaded: false })
    await this.loadPage()
  },

  buildQuery() {
    const db = wx.cloud.database()
    const where = { eventId: this.data.eventId }
    if (this.data.filter === 'recruiting') {
      where.isFull = false
    }
    return db.collection('teams_event').where(where)
  },

  async loadPage() {
    if (this.data.loading || !this.data.hasMore) return

    this.setData({ loading: true })

    try {
      const res = await this.buildQuery()
        .orderBy('teamNumber', 'asc')
        .skip(this.data.teamList.length)
        .limit(PAGE_SIZE)
        .get()

      this.setData({
        teamList: this.data.teamList.concat(res.data),
        hasMore: res.data.length === PAGE_SIZE,
        loading: false,
        loaded: true
      })
    } catch (err) {
      console.error('加载队伍列表失败', err)
      this.setData({ loading: false, loaded: true })
      wx.showToast({ title: '加载失败，请下拉重试', icon: 'none' })
    }
  },

  loadMore() {
    this.loadPage()
  },

  onSearchInput(e) {
    this.setData({ searchValue: e.detail.value })
  },

  // 用 pageScrollTo 的 selector 能力直接定位，
  // 不再自己算 top——boundingClientRect 给的是视口坐标，和 pageScrollTo 的页面坐标对不上
  doSearch() {
    const value = this.data.searchValue.trim()
    if (!value) return

    const match = value.match(/^#?(\d+)$/)
    if (!match) {
      wx.showToast({ title: '请输入 #编号 格式', icon: 'none' })
      return
    }

    const number = parseInt(match[1], 10)
    const exists = this.data.teamList.some((t) => t.teamNumber === number)

    if (!exists) {
      // 没找到要先区分「还没加载到」和「筛选条件挡掉了」，否则提示会误导
      let tip = '没有这个编号的队伍'
      if (this.data.hasMore) {
        tip = '还没加载到这个编号，上拉加载更多试试'
      } else if (this.data.filter === 'recruiting') {
        tip = '该编号可能是已满队伍，切到「全部」看看'
      }
      wx.showToast({ title: tip, icon: 'none' })
      return
    }

    wx.pageScrollTo({
      selector: `#team-${number}`,
      offsetTop: -20,
      duration: 300,
      fail: () => wx.showToast({ title: '定位失败，请手动滑动', icon: 'none' })
    })
  },

  goToTeamDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/team-detail-view/team-detail-view?id=${id}`
    })
  },

  goToCreateTeam() {
    wx.navigateTo({
      url: `/pages/team-create/team-create?eventId=${this.data.eventId}`
    })
  }
})
