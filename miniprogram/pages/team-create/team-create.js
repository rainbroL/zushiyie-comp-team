// pages/team-create/team-create.js
const { getOpenid } = require('../../utils/auth')

Page({
  data: {
    eventId: '',
    eventName: '',
    teamName: '',
    sizeOptions: ['2', '3', '4', '5', '6', '7', '8', '9', '10'],
    sizeIndex: -1,
    maxSize: 3,
    maxSizeHint: '',
    description: '',
    contact: '',
    userDesc: '',
    isSubmitting: false
  },

  onLoad(options) {
    const eventId = options.eventId
    if (eventId) {
      this.setData({ eventId })
      this.loadEventInfo(eventId)
    }
  },

  async loadEventInfo(eventId) {
    const db = wx.cloud.database()
    try {
      const res = await db.collection('events').doc(eventId).get()
      const event = res.data
      const maxSize = event.maxTeamSize || 3
      this.setData({
        eventName: event.title,
        maxSize: maxSize,
        maxSizeHint: `每队最多 ${maxSize} 人`
      })
    } catch (err) {
      console.error('加载赛事信息失败', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onTeamNameInput(e) {
    this.setData({ teamName: e.detail.value })
  },

  onSizeChange(e) {
    const index = e.detail.value
    const size = parseInt(this.data.sizeOptions[index])
    const maxSize = this.data.maxSize || 3
    if (size > maxSize) {
      wx.showToast({
        title: `本赛事最多 ${maxSize} 人`,
        icon: 'none'
      })
      const maxIndex = this.data.sizeOptions.indexOf(String(maxSize))
      this.setData({ sizeIndex: maxIndex })
      return
    }
    this.setData({ sizeIndex: index })
  },

  onDescriptionInput(e) {
    this.setData({ description: e.detail.value })
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value })
  },

  onUserDescInput(e) {
    this.setData({ userDesc: e.detail.value })
  },

  async onSubmit() {
    if (this.data.isSubmitting) return

    const {
      eventId,
      teamName,
      sizeIndex,
      sizeOptions,
      description,
      contact,
      userDesc
    } = this.data

    if (!teamName.trim()) {
      wx.showToast({ title: '请输入队伍名称', icon: 'none' })
      return
    }
    if (sizeIndex === -1) {
      wx.showToast({ title: '请选择人数上限', icon: 'none' })
      return
    }
    if (!description.trim()) {
      wx.showToast({ title: '请输入队伍描述', icon: 'none' })
      return
    }
    if (!contact.trim()) {
      wx.showToast({ title: '请填写联系方式', icon: 'none' })
      return
    }
    if (!userDesc.trim()) {
      wx.showToast({ title: '请输入个人描述', icon: 'none' })
      return
    }

    this.setData({ isSubmitting: true })

    try {
      // 身份只能由云函数给出。拿不到就中止，绝不写入伪造的 openid——
      // 否则这条队伍的 creatorOpenid 对不上任何人，队长本人都无法再管理它。
      const openid = await getOpenid()
      if (!openid) {
        this.setData({ isSubmitting: false })
        wx.showModal({
          title: '身份获取失败',
          content: '没能获取到你的微信身份，请检查网络后重试。',
          showCancel: false
        })
        return
      }

      const userInfo = await this.getUserProfile(openid)
      if (!userInfo) {
        this.setData({ isSubmitting: false })
        wx.showModal({
          title: '提示',
          content: '请先完善个人信息（昵称、年级）后再创建队伍',
          confirmText: '去填写',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({
                url: '/pages/profile/profile'
              })
            }
          }
        })
        return
      }

      wx.showLoading({ title: '创建中...' })
      const maxTeamSize = parseInt(sizeOptions[sizeIndex])
      const nextNumber = await this.getNextTeamNumber(eventId)

      const db = wx.cloud.database()
      const teamData = {
        eventId: eventId,
        teamNumber: nextNumber,
        teamName: teamName.trim(),
        description: description.trim(),
        contact: contact.trim(),
        maxSize: maxTeamSize,
        isFull: false,
        members: [{
          openid: openid,
          name: userInfo.nickName,
          grade: userInfo.grade || '',
          avatar: userInfo.avatarUrl || '👤',
          role: '队长',
          isLeader: true,
          desc: userDesc.trim() || ''
        }],
        creatorOpenid: openid,
        createTime: new Date()
      }

      await db.collection('teams_event').add({ data: teamData })

      wx.hideLoading()
      wx.showToast({ title: '创建成功！', icon: 'success' })

      setTimeout(() => {
        wx.navigateBack()
      }, 1500)

    } catch (err) {
      console.error('创建队伍失败:', err)
      wx.hideLoading()
      wx.showToast({ title: '创建失败，请重试', icon: 'none' })
    } finally {
      this.setData({ isSubmitting: false })
    }
  },

  // 资料不完整时返回 null，由调用方引导去完善
  async getUserProfile(openid) {
    try {
      const db = wx.cloud.database()
      const result = await db.collection('users').where({
        _openid: openid
      }).get()

      if (result.data.length === 0) return null

      const user = result.data[0]
      if (!user.nickName || !user.grade) return null

      return {
        nickName: user.nickName,
        grade: user.grade,
        bio: user.bio || '',
        avatarUrl: user.avatarUrl || ''
      }
    } catch (err) {
      console.error('获取用户信息失败:', err)
      return null
    }
  },

  async getNextTeamNumber(eventId) {
    const db = wx.cloud.database()
    try {
      const res = await db.collection('teams_event')
        .where({ eventId: eventId })
        .orderBy('teamNumber', 'desc')
        .limit(1)
        .get()
      return res.data.length === 0 ? 0 : res.data[0].teamNumber + 1
    } catch (err) {
      console.error('获取队伍编号失败:', err)
      return 0
    }
  }
})