<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  Collection,
  Close,
  Connection,
  Document,
  Files,
  Key,
  Link,
  Lock,
  Operation,
  Promotion,
  SetUp,
  Setting,
  User,
} from '@element-plus/icons-vue'
import { store } from '../stores/collector'
import { authState, isAdmin } from '../services/auth'
import { t, translateText } from '../i18n'
import { fromNow } from '../utils/format'

defineProps({
  mobileOpen: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['close'])

const route = useRoute()

const navItems = [
  { to: '/collections', label: '采集列表', icon: Collection, key: 'tasks' },
  { to: '/sites', label: '采集站点', icon: Link, key: 'sites' },
  { to: '/configs', label: '采集配置管理', icon: SetUp, key: 'configs' },
  { to: '/headers', label: '采集Header管理', icon: Document, key: 'headers' },
  { to: '/params', label: '采集参数项管理', icon: Operation, key: 'params' },
  { to: '/proxies', label: '代理管理', icon: Connection, key: 'proxies' },
  { to: '/storages', label: '存储管理', icon: Files, key: 'storages' },
]

const integrationItems = [
  { to: '/sessions', label: '会话管理', icon: Lock },
  { to: '/captcha', label: '打码管理', icon: Key },
  { to: '/risk', label: '风控管理', icon: Lock },
  { to: '/api-management', label: 'API 管理', icon: Promotion },
]

const systemItems = computed(() => [
  { to: '/settings', label: '系统设置', icon: Setting },
  { to: '/users', label: '账号与权限', icon: User, adminOnly: true },
  { to: '/audit', label: '操作审计', icon: Document, adminOnly: true },
].filter((item) => !item.adminOnly || isAdmin()))

const roleLabel = computed(() => {
  const key = { admin: 'role.admin', operator: 'role.operator', viewer: 'role.viewer' }[
    authState.user?.role
  ]
  const fallback = { admin: '管理员', operator: '操作员', viewer: '只读成员' }[
    authState.user?.role
  ]
  return t(key || 'role.member', fallback || '成员')
})

const profileInitial = computed(
  () => (authState.user?.username || 'U').trim().slice(0, 1).toUpperCase(),
)

const counts = computed(() => ({
  tasks: store.tasks.length,
  sites: store.sites.length,
  configs: store.configs.length,
  headers: store.headers.length,
  params: store.params.length,
  proxies: store.proxies.length,
  storages: store.storages.length,
}))

const lastSyncLabel = computed(() => {
  const latest = store.runs[0]
  return latest ? fromNow(latest.startedAt) : '尚未运行'
})

const barHeights = [42, 68, 51, 82, 57, 91, 64, 76, 55, 88]
</script>

<template>
  <aside class="app-sidebar" :class="{ 'is-open': mobileOpen }">
    <div class="sidebar-brand">
      <div class="brand-mark" aria-hidden="true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 17.5c2.6 0 3.1-8 6.4-8 3.2 0 2.7 5.2 5.1 5.2 1.1 0 1.8-.8 2.5-2"
            stroke="currentColor"
            stroke-width="2.1"
            stroke-linecap="round"
          />
          <circle cx="5" cy="17.5" r="1.6" fill="currentColor" />
          <circle cx="19" cy="12.7" r="1.6" fill="currentColor" />
        </svg>
      </div>
      <div class="brand-copy">
        <strong>采风</strong>
        <span>COLLECT STUDIO</span>
      </div>
      <button class="sidebar-close" type="button" aria-label="关闭菜单" @click="$emit('close')">
        <el-icon><Close /></el-icon>
      </button>
    </div>

    <div class="workspace-switcher">
      <div class="workspace-avatar">CF</div>
      <div class="workspace-copy">
        <span>{{ t('common.currentWorkspace', '当前工作区') }}</span>
        <strong>{{ t('common.workspaceName', '采风数据工坊') }}</strong>
      </div>
      <span class="workspace-tag">SQLite</span>
    </div>

    <nav class="sidebar-nav" aria-label="主导航">
      <p class="nav-caption">{{ t('nav.workspace', '采集工作台') }}</p>
      <RouterLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        :class="{ 'is-active': route.path === item.to }"
        @click="$emit('close')"
      >
        <span class="nav-icon">
          <el-icon><component :is="item.icon" /></el-icon>
        </span>
        <span class="nav-label">{{ translateText(item.label) }}</span>
        <span v-if="item.key" class="nav-count">{{ counts[item.key] }}</span>
      </RouterLink>

      <p class="nav-caption">{{ t('nav.integrations', '集成与安全') }}</p>
      <RouterLink
        v-for="item in integrationItems"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        :class="{ 'is-active': route.path === item.to }"
        @click="$emit('close')"
      >
        <span class="nav-icon">
          <el-icon><component :is="item.icon" /></el-icon>
        </span>
        <span class="nav-label">{{ translateText(item.label) }}</span>
      </RouterLink>

      <template v-if="systemItems.length">
        <p class="nav-caption">{{ t('nav.system', '系统管理') }}</p>
        <RouterLink
          v-for="item in systemItems"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ 'is-active': route.path === item.to }"
          @click="$emit('close')"
        >
          <span class="nav-icon">
            <el-icon><component :is="item.icon" /></el-icon>
          </span>
          <span class="nav-label">{{ translateText(item.label) }}</span>
        </RouterLink>
      </template>
    </nav>

    <div class="sidebar-spacer" />

    <div class="engine-card">
      <div class="engine-head">
        <span class="engine-dot" />
        {{ t('common.connected', '服务端已连接') }}
      </div>
      <p>SQLite · {{ t('common.lastRun', '最近运行') }} {{ translateText(lastSyncLabel) }}</p>
      <div class="engine-bars" aria-hidden="true">
        <i v-for="(height, index) in barHeights" :key="index" :style="{ height: `${height}%` }" />
      </div>
    </div>

    <div class="sidebar-profile">
      <div class="profile-avatar">{{ profileInitial }}</div>
      <div class="profile-copy">
        <strong>{{ authState.user?.username || '未登录' }}</strong>
        <span>{{ roleLabel }} · {{ t('common.serverWorkspace', '服务端工作区') }}</span>
      </div>
      <span class="profile-status" title="在线" />
    </div>
  </aside>
</template>
