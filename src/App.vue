<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import AppSidebar from './components/AppSidebar.vue'
import AppTopbar from './components/AppTopbar.vue'
import { authState } from './services/auth'
import { loadPreferences, preferencesState } from './services/preferences'
import { installDomTranslator, t } from './i18n'
import {
  installUnloadFlush,
  loadWorkspace,
  stopWorkspaceSync,
  workspaceState,
} from './services/workspace'
import { startAutoScheduler } from './utils/autoScheduler'

const route = useRoute()
const mobileOpen = ref(false)
const elLocale = computed(() => (preferencesState.language === 'en' ? en : zhCn))
let stopScheduler = null

watch(
  () => route.fullPath,
  () => {
    mobileOpen.value = false
  },
)

watch(mobileOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

watch(
  () => authState.user?.id,
  async (userId) => {
    if (!userId) {
      stopWorkspaceSync()
      workspaceState.ready = false
      return
    }
    await loadPreferences()
    try {
      await loadWorkspace()
    } catch {
      // error is exposed through workspaceState
    }
  },
  { immediate: true },
)

function syncScheduler() {
  const canRun =
    workspaceState.ready && ['admin', 'operator'].includes(authState.user?.role)
  if (canRun && !stopScheduler) {
    stopScheduler = startAutoScheduler()
  } else if (!canRun && stopScheduler) {
    stopScheduler()
    stopScheduler = null
  }
}

watch(
  [() => workspaceState.ready, () => authState.user?.role],
  syncScheduler,
  { immediate: true },
)

onMounted(() => {
  installUnloadFlush()
  installDomTranslator()
})

onBeforeUnmount(() => {
  stopWorkspaceSync()
  stopScheduler?.()
  stopScheduler = null
  document.body.style.overflow = ''
})

async function retryWorkspace() {
  try {
    await loadWorkspace()
  } catch {
    // error is exposed through workspaceState
  }
}
</script>

<template>
  <el-config-provider :locale="elLocale">
    <RouterView v-if="route.meta.public" />

  <div v-else class="app-shell">
    <AppSidebar :mobile-open="mobileOpen" @close="mobileOpen = false" />
    <div
      class="nav-scrim"
      :class="{ 'is-visible': mobileOpen }"
      aria-hidden="true"
      @click="mobileOpen = false"
    />
    <div class="app-body">
      <AppTopbar @toggle-nav="mobileOpen = !mobileOpen" />
      <div v-if="authState.user?.role === 'viewer'" class="readonly-banner">
        {{ t('common.readonly', '当前为只读成员，可查看工作区，但不能修改配置、运行采集或管理集成。') }}
      </div>
      <main class="app-main">
        <RouterView v-slot="{ Component }">
          <Transition name="fade-slide" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
    </div>

    <div v-if="!workspaceState.ready" class="workspace-loading">
      <div class="workspace-loading-card">
        <span class="workspace-loading-mark">CF</span>
        <template v-if="workspaceState.error">
          <strong>{{ t('common.loadFailed', '工作区加载失败') }}</strong>
          <p>{{ workspaceState.error }}</p>
          <el-button type="primary" @click="retryWorkspace">{{ t('common.retry', '重试') }}</el-button>
        </template>
        <template v-else>
          <strong>{{ t('common.loading', '正在加载服务端工作区') }}</strong>
          <p>{{ t('common.loadingHint', '从 SQLite 同步采集资源与任务配置…') }}</p>
          <span class="workspace-loading-bar"><i /></span>
        </template>
      </div>
    </div>
  </div>
  </el-config-provider>
</template>
