// pages/profile/profile.js
const { getOpenid } = require('../../utils/auth')

Page({
  data: {
    nickName: '',
    gradeIndex: -1,
    gradeOptions: ['大一', '大二', '大三', '大四', '研究生及以上'],
    bio: '',
    isSaving: false
  },

  onLoad() {
    this.loadUserInfo()
  },

  async loadUserInfo() {
    try {
      const openid = await getOpenid()
      if (!openid) return

      const db = wx.cloud.database()
      const result = await db.collection('users').where({
        _openid: openid
      }).get()

      if (result.data.length > 0) {
        const user = result.data[0]
        const gradeIndex = this.data.gradeOptions.indexOf(user.grade)
        this.setData({
          nickName: user.nickName || '',
          gradeIndex: gradeIndex !== -1 ? gradeIndex : -1,
          bio: user.bio || ''
        })
      }
    } catch (err) {
      console.error('加载用户信息失败:', err)
    }
  },

  // ===== 表单输入事件 =====
  onNickNameInput(e) {
    this.setData({ nickName: e.detail.value })
  },

  onGradeChange(e) {
    this.setData({ gradeIndex: e.detail.value })
  },

  onBioInput(e) {
    this.setData({ bio: e.detail.value })
  },

  // ===== 保存信息 =====
  async onSave() {
    const { nickName, gradeIndex, gradeOptions, bio } = this.data

    // 校验
    if (!nickName.trim()) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }
    if (gradeIndex === -1) {
      wx.showToast({ title: '请选择年级', icon: 'none' })
      return
    }

    this.setData({ isSaving: true })
    wx.showLoading({ title: '保存中...' })

    try {
      const openid = await getOpenid()
      if (!openid) {
        wx.hideLoading()
        this.setData({ isSaving: false })
        wx.showToast({ title: '身份获取失败，请重试', icon: 'none' })
        return
      }

      const db = wx.cloud.database()
      const userData = {
        nickName: nickName.trim(),
        grade: gradeOptions[gradeIndex],
        bio: bio.trim(),
        updatedAt: new Date()
      }

      // 检查用户是否已存在
      const existResult = await db.collection('users').where({
        _openid: openid
      }).get()

      if (existResult.data.length > 0) {
        // 更新
        await db.collection('users').doc(existResult.data[0]._id).update({
          data: userData
        })
      } else {
        // 新增
        userData.createdAt = new Date()
        await db.collection('users').add({
          data: userData
        })
      }

      wx.hideLoading()
      wx.showToast({ title: '保存成功', icon: 'success' })

      // 返回上一页
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)

    } catch (err) {
      console.error('保存用户信息失败:', err)
      wx.hideLoading()
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ isSaving: false })
    }
  }
})