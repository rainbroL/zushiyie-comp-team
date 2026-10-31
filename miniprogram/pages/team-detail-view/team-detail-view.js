// pages/team-detail-view/team-detail-view.js
// 队伍详情 + 申请加入 + 队长审核
//
// 前端不直接读写 applications 集合，身份与权限判断全部交给 teamApply 云函数，
// 页面只负责展示和把用户操作转成一次 action 调用。

const BTN_TEXT = {
  none: '申请组队',
  pending: '审核中，等待队长回复',
  approved: '已加入该队伍',
  rejected: '申请未通过',
  cancelled: '重新申请'
}

const STATUS_TIP = {
  pending: '已提交申请，队长同意后你就能出现在成员列表里',
  approved: '你已是该队伍成员，可以联系队长约时间了',
  rejected: '队长未通过本次申请，可以联系队长了解具体原因',
  cancelled: '申请已撤回，如需加入请重新提交'
}

Page({
  data: {
    teamId: '',
    team: null,
    leader: null,
    memberCount: 0,
    hasTeamNumber: false,

    isLeader: false,
    myStatus: 'none',
    statusTip: '',
    applications: [],

    btnText: BTN_TEXT.none,
    btnDisabled: false,

    applying: false,
    handlingId: ''
  },

  onLoad(options) {
    const teamId = options.id
    if (!teamId) {
      wx.showToast({ title: '缺少队伍参数', icon: 'none' })
      return
    }
    this.setData({ teamId })
  },

  // onShow 而非 onLoad 里拉数据：从个人信息页返回时昵称可能刚补全，需要重新判定
  onShow() {
    if (this.data.teamId) this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    await this.loadTeamDetail()
    await this.loadContext()
  },

  // 队伍本身的信息仍走数据库直读（只读，无越权风险）
  async loadTeamDetail() {
    try {
      const res = await wx.cloud
        .database()
        .collection('teams_event')
        .doc(this.data.teamId)
        .get()

      const team = res.data
      const members = team.members || []

      this.setData({
        team,
        leader: members.find((m) => m.isLeader) || null,
        memberCount: members.length,
        // 编号可能是 0，不能用真假值判断
        hasTeamNumber: typeof team.teamNumber === 'number'
      })
    } catch (err) {
      console.error('加载队伍详情失败', err)
      wx.showToast({ title: '队伍不存在或已删除', icon: 'none' })
    }
  },

  // 身份相关状态统一由云函数判定，前端拿不到也就不可能伪造
  async loadContext() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamApply',
        data: { action: 'context', teamId: this.data.teamId }
      })
      const result = res.result || {}

      if (!result.ok) {
        this.updateButton()
        return
      }

      const { isLeader, myStatus, applications } = result.data

      this.setData({
        isLeader: !!isLeader,
        myStatus: myStatus || 'none',
        statusTip: STATUS_TIP[myStatus] || '',
        applications: applications || []
      })

      this.updateButton()
    } catch (err) {
      console.error('加载申请状态失败', err)
      this.updateButton()
    }
  },

  updateButton() {
    const { isLeader, myStatus, team } = this.data
    let btnText = BTN_TEXT[myStatus] || BTN_TEXT.none
    let btnDisabled = false

    if (isLeader) {
      btnText = '你是本队队长'
      btnDisabled = true
    } else if (myStatus === 'pending' || myStatus === 'approved' || myStatus === 'rejected') {
      // 这三种状态下按钮只做状态展示
      btnDisabled = true
    } else if (team && team.isFull) {
      btnText = '队伍已满'
      btnDisabled = true
    }
    // 剩余的 none / cancelled 且未满员：可点，cancelled 时文案是「重新申请」

    this.setData({ btnText, btnDisabled })
  },

  // ============ 申请加入 ============
  onApply() {
    if (this.data.btnDisabled || this.data.applying || !this.data.team) return

    wx.showModal({
      title: '申请加入',
      editable: true,
      placeholderText: '一句话说说你的优势，帮队长快速决定（选填）',
      confirmText: '提交申请',
      success: (res) => {
        if (res.confirm) this.submitApply((res.content || '').trim())
      }
    })
  },

  async submitApply(message) {
    this.setData({ applying: true })
    wx.showLoading({ title: '提交中...' })

    try {
      const res = await wx.cloud.callFunction({
        name: 'teamApply',
        data: { action: 'apply', teamId: this.data.teamId, message }
      })
      wx.hideLoading()

      const result = res.result || {}
      if (result.ok) {
        this.setData({ myStatus: 'pending', statusTip: STATUS_TIP.pending })
        this.updateButton()
        wx.showToast({ title: '申请已提交', icon: 'success' })
        return
      }

      this.handleBizError(result)
    } catch (err) {
      wx.hideLoading()
      console.error('提交申请失败', err)
      wx.showToast({ title: '提交失败，请重试', icon: 'none' })
    } finally {
      this.setData({ applying: false })
    }
  },

  // 云函数返回的业务错误统一在这里翻译成人话
  handleBizError(result) {
    const { code, message } = result

    if (code === 'PROFILE_INCOMPLETE') {
      wx.showModal({
        title: '先完善个人信息',
        content: '队长需要知道你是谁、几年级，补全后就能提交申请了。',
        confirmText: '去完善',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/profile/profile' })
          }
        }
      })
      return
    }

    // 留言被内容审核拦下时，message 里是具体建议，弹窗展示更清楚
    if (code === 'CONTENT_REJECTED') {
      wx.showModal({
        title: '内容不合规',
        content: message || '请修改后再试',
        showCancel: false
      })
      return
    }

    if (code === 'ALREADY_APPLIED' || code === 'ALREADY_MEMBER' || code === 'TEAM_FULL') {
      this.loadTeamDetail()
      this.loadContext()
    }

    wx.showToast({ title: message || '操作失败', icon: 'none' })
  },

  // 提交后反悔：撤回申请，队长那边同时从待处理列表消失
  onCancelApply() {
    wx.showModal({
      title: '撤回申请',
      content: '撤回后队长将看不到你的申请，之后可以重新提交。',
      success: (res) => {
        if (res.confirm) this.cancelApply()
      }
    })
  },

  async cancelApply() {
    wx.showLoading({ title: '撤回中...' })

    try {
      const res = await wx.cloud.callFunction({
        name: 'teamApply',
        data: { action: 'cancel', teamId: this.data.teamId }
      })
      wx.hideLoading()

      const result = res.result || {}
      if (!result.ok) {
        wx.showToast({ title: result.message || '撤回失败', icon: 'none' })
        this.loadContext()
        return
      }

      this.setData({ myStatus: 'cancelled', statusTip: STATUS_TIP.cancelled })
      this.updateButton()
      wx.showToast({ title: '已撤回', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      console.error('撤回申请失败', err)
      wx.showToast({ title: '撤回失败，请重试', icon: 'none' })
    }
  },

  // ============ 队长审核 ============
  onApprove(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.applications.find((a) => a._id === id)
    const name = item ? item.applicant.name : '该同学'

    wx.showModal({
      title: '同意加入',
      content: `确认让「${name}」加入队伍？同意后对方立即成为队员，占用一个名额。`,
      success: (res) => {
        if (res.confirm) this.handleApplication(id, 'approve')
      }
    })
  },

  onReject(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.applications.find((a) => a._id === id)
    const name = item ? item.applicant.name : '该同学'

    wx.showModal({
      title: '拒绝申请',
      content: `确认拒绝「${name}」的申请？对方会在队伍详情页看到未通过的状态。`,
      confirmColor: '#e17055',
      success: (res) => {
        if (res.confirm) this.handleApplication(id, 'reject')
      }
    })
  },

  async handleApplication(applicationId, action) {
    if (this.data.handlingId) return
    this.setData({ handlingId: applicationId })
    wx.showLoading({ title: '处理中...' })

    try {
      const res = await wx.cloud.callFunction({
        name: 'teamApply',
        data: { action, applicationId }
      })
      wx.hideLoading()

      const result = res.result || {}
      if (!result.ok) {
        wx.showToast({ title: result.message || '操作失败', icon: 'none' })
        this.loadContext()
        return
      }

      wx.showToast({
        title: action === 'approve' ? '已同意' : '已拒绝',
        icon: 'success'
      })

      // 先从本地列表摘掉，避免等刷新期间重复点同一个申请
      this.setData({
        applications: this.data.applications.filter((a) => a._id !== applicationId)
      })

      await this.refresh()
    } catch (err) {
      wx.hideLoading()
      console.error('处理申请失败', err)
      wx.showToast({ title: '处理失败，请重试', icon: 'none' })
    } finally {
      this.setData({ handlingId: '' })
    }
  },

  onCopyContact() {
    const { team } = this.data
    if (!team || !team.contact) return
    wx.setClipboardData({ data: team.contact })
  }
})
