// pages/team-create/team-create.js
// 建队的所有写操作都在云函数 teamCreate 里完成：编号自增、人数上限、队长快照
// 全部由服务端计算，前端只负责收集用户填写的文本。
// 下面的本地校验只为即时反馈，云端会再校验一遍。
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
    try {
      const res = await wx.cloud.database().collection('events').doc(eventId).get()
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

    if (!eventId) {
      wx.showToast({ title: '缺少赛事参数', icon: 'none' })
      return
    }
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
    wx.showLoading({ title: '创建中...', mask: true })

    try {
      // 不再需要前端取 openid、查用户资料、算下一个编号：
      // 这些都交给云函数，客户端也没法再篡改名额或冒用队长身份。
      const res = await wx.cloud.callFunction({
        name: 'teamCreate',
        data: {
          action: 'create',
          eventId: eventId,
          teamName: teamName.trim(),
          maxSize: parseInt(sizeOptions[sizeIndex]),
          description: description.trim(),
          contact: contact.trim(),
          userDesc: userDesc.trim()
        }
      })

      const result = (res && res.result) || {}
      wx.hideLoading()

      if (!result.ok) {
        this.handleFail(result)
        return
      }

      wx.showToast({ title: '创建成功！', icon: 'success' })
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
    } catch (err) {
      console.error('创建队伍失败:', err)
      wx.hideLoading()
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
    } finally {
      this.setData({ isSubmitting: false })
    }
  },

  handleFail(result) {
    // 内容审核不通过时，message 里是具体的修改建议，用弹窗展示才看得全
    if (result.code === 'CONTENT_REJECTED') {
      wx.showModal({
        title: '内容不合规',
        content: result.message || '请修改后再试',
        showCancel: false
      })
      return
    }

    // 资料不全由云端判定，这里负责把用户送到填写页面
    if (result.code === 'PROFILE_INCOMPLETE') {
      wx.showModal({
        title: '提示',
        content: result.message || '请先完善个人信息（昵称、年级）后再创建队伍',
        confirmText: '去填写',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/profile/profile' })
          }
        }
      })
      return
    }
    wx.showToast({ title: result.message || '创建失败，请重试', icon: 'none' })
  }
})
