// pages/my-teams/my-teams.js
// 我的队伍：把我们发起的、加入的队伍聚在一起，
// 否则队长建完队只能从赛事列表一层层翻回去找。
const { getOpenid } = require('../../utils/auth')

const PAGE_SIZE = 20

Page({
  data: {
    loading: true,
    leading: [], // 我当队长的队伍
    joined: [], // 我作为队员加入的队伍
    hasAny: false
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
      const openid = await getOpenid()
      if (!openid) {
        this.setData({ loading: false })
        wx.showToast({ title: '身份获取失败，请重试', icon: 'none' })
        return
      }

      const db = wx.cloud.database()
      const _ = db.command

      // 不加 orderBy 是为了不依赖复合索引，排序放到内存里做（每人队伍数远小于 20）
      const [ledRes, joinedRes] = await Promise.all([
        db.collection('teams_event')
          .where({ creatorOpenid: openid })
          .limit(PAGE_SIZE)
          .get(),
        db.collection('teams_event')
          .where({ members: _.elemMatch({ openid: openid }) })
          .limit(PAGE_SIZE)
          .get()
      ])

      const sortByTime = (a, b) =>
        new Date(b.createTime).getTime() - new Date(a.createTime).getTime()

      const leading = ledRes.data.sort(sortByTime)
      const leadingIds = leading.map((t) => t._id)
      // 自己带的队也算「成员」，这里排掉避免重复展示
      const joined = joinedRes.data
        .filter((t) => leadingIds.indexOf(t._id) === -1)
        .sort(sortByTime)

      this.setData({
        leading,
        joined,
        hasAny: leading.length + joined.length > 0,
        loading: false
      })
    } catch (err) {
      console.error('加载我的队伍失败', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败，请下拉重试', icon: 'none' })
    }
  },

  goToTeam(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/team-detail-view/team-detail-view?id=${id}`
    })
  },

  goToEvents() {
    wx.navigateTo({ url: '/pages/event-list/event-list' })
  }
})
