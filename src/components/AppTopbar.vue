<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowRight,
  Bell,
  CircleCheckFilled,
  MagicStick,
  Menu,
  WarningFilled,
} from '@element-plus/icons-vue'
import { clearWorkspaceData, store } from '../stores/collector'
import { fromNow } from '../utils/format'
import { authState, canWrite, isAdmin, logout } from '../services/auth'
import { workspaceState } from '../services/workspace'
import { t } from '../i18n'
import CurlImportDialog from './CurlImportDialog.vue'

defineEmits(['toggle-nav'])

const route = useRoute()
const router = useRouter()
const notifyVisible = ref(false)
const importVisible = ref(false)

const recentRuns = computed(() => store.runs.slice(0, 4))
const errorCount = computed(() => store.runs.filter((run) => run.status === 'error').length)
const roleLabel = computed(() => {
  const key = { admin: 'role.admin', operator: 'role.operator', viewer: 'role.viewer' }[
    authState.user?.role
  ]
  const fallback = { admin: '管理员', operator: '操作员', viewer: '只读成员' }[
    authState.user?.role
  ]
  return t(key || 'role.member', fallback || '成员')
})
const userInitial = computed(
  () => (authState.user?.username || 'U').trim().slice(0, 1).toUpperCase(),
)
const syncLabel = computed(() => {
  if (workspaceState.error) return t('common.syncFailed', '同步失败')
  if (workspaceState.saving) return t('common.saving', '保存中')
  return t('common.serverSynced', '服务端已同步')
})

function openCollections() {
  notifyVisible.value = false
  router.push('/collections')
}

async function handleCommand(command) {
  if (command === 'clear') {
    try {
      await ElMessageBox.confirm(
        '将清空服务端工作区中的站点、配置、任务、代理、存储与采集记录，此操作不可撤销。',
        '清空工作区数据',
        {
          confirmButtonText: '确认清空',
          cancelButtonText: '取消',
          type: 'warning',
        },
      )
      clearWorkspaceData()
      ElMessage.success('工作区数据已清空')
    } catch {
      // 用户取消
    }
  }
  if (command === 'about') {
    await ElMessageBox.alert(
      '采风 Collect Studio 使用 Vue 3 + Vite + Element Plus，后端为 Node + SQLite。工作区、账号、站点会话、打码配置与 API 客户端保存在服务端数据库，采集请求经服务端代理转发。',
      '关于采风',
      { confirmButtonText: '知道了' },
    )
  }
  if (command === 'security') router.push('/security')
  if (command === 'sessions') router.push('/security')
  if (command === 'users') router.push('/users')
  if (command === 'audit') router.push('/audit')
  if (command === 'settings') router.push('/settings')
  if (command === 'logout') {
    try {
      await ElMessageBox.confirm('确认退出当前账号？未保存的修改会在退出前丢失。', '退出登录', {
        confirmButtonText: '退出',
        cancelButtonText: '取消',
        type: 'warning',
      })
      await logout()
      router.replace('/login')
      ElMessage.success('已退出登录')
    } catch {
      // 用户取消
    }
  }
}
</script>

<template>
  <header class="app-topbar">
    <div class="topbar-left">
      <button
        class="icon-button mobile-menu"
        type="button"
        aria-label="打开导航"
        @click="$emit('toggle-nav')"
      >
        <el-icon><Menu /></el-icon>
      </button>
      <div class="breadcrumb">
        <span>工作台</span>
        <el-icon><ArrowRight /></el-icon>
        <strong>{{ route.meta.title || '采集列表' }}</strong>
      </div>
    </div>

    <div class="topbar-right">
      <button
        class="ai-parse-button"
        type="button"
        title="粘贴 cURL，一键解析并创建采集配置"
        @click="importVisible = true"
      >
        <el-icon><MagicStick /></el-icon>
        <span>{{ t('common.quickImport', '一键解析') }}</span>
        <em>AI</em>
      </button>
      <div class="sync-pill" :class="{ 'is-error': workspaceState.error }">
        <span class="live-dot" />
        {{ syncLabel }}
      </div>

      <el-popover
        v-model:visible="notifyVisible"
        placement="bottom-end"
        :width="340"
        trigger="click"
        popper-class="notification-popper"
      >
        <template #reference>
          <button class="icon-button notify-trigger" type="button" aria-label="采集通知">
            <el-icon><Bell /></el-icon>
            <span v-if="errorCount" class="notify-badge">{{ errorCount > 9 ? '9+' : errorCount }}</span>
          </button>
        </template>
        <div class="notification-popover">
          <div class="notification-head">
            <div>
              <strong>采集动态</strong>
              <span>最近 {{ recentRuns.length }} 次运行记录</span>
            </div>
            <span class="type-dot">LIVE</span>
          </div>
          <div v-if="recentRuns.length" class="notification-list">
            <div v-for="run in recentRuns" :key="run.id" class="notification-item">
              <span class="notif-icon" :class="run.status === 'success' ? 'is-success' : 'is-error'">
                <el-icon>
                  <CircleCheckFilled v-if="run.status === 'success'" />
                  <WarningFilled v-else />
                </el-icon>
              </span>
              <div class="notif-copy">
                <strong>{{ run.taskName }}</strong>
                <p>{{ run.status === 'success' ? `采集 ${run.count} 条 · ${run.duration}ms` : run.message }}</p>
              </div>
              <span class="notif-time">{{ fromNow(run.startedAt) }}</span>
            </div>
          </div>
          <div v-else class="notification-item">
            <div class="notif-copy">
              <strong>还没有采集记录</strong>
              <p>运行第一个任务后，动态会出现在这里。</p>
            </div>
          </div>
          <div class="notification-footer">
            <button type="button" @click="openCollections">前往采集列表 →</button>
          </div>
        </div>
      </el-popover>

      <div class="topbar-divider" />

      <el-dropdown trigger="click" popper-class="user-dropdown-popper" @command="handleCommand">
        <button class="user-chip" type="button" aria-label="账户菜单">
          <span class="user-avatar">{{ userInitial }}</span>
          <span class="user-copy">
            <strong>{{ authState.user?.username || '未登录' }}</strong>
            <span>{{ roleLabel }}</span>
          </span>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="settings">{{ t('nav.settings', '系统设置') }}</el-dropdown-item>
            <el-dropdown-item command="security">{{ t('common.security', '账号与安全') }}</el-dropdown-item>
            <el-dropdown-item command="sessions">{{ t('common.sessions', '登录会话') }}</el-dropdown-item>
            <el-dropdown-item v-if="isAdmin()" command="users">{{ t('nav.users', '账号与权限') }}</el-dropdown-item>
            <el-dropdown-item v-if="isAdmin()" command="audit">{{ t('nav.audit', '操作审计') }}</el-dropdown-item>
            <el-dropdown-item command="about" divided>{{ t('common.about', '关于采风') }}</el-dropdown-item>
            <el-dropdown-item v-if="canWrite()" command="clear" divided>
              {{ t('common.clear', '清空工作区数据') }}
            </el-dropdown-item>
            <el-dropdown-item command="logout" divided>{{ t('common.logout', '退出登录') }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </header>

  <CurlImportDialog v-model="importVisible" />
</template>
