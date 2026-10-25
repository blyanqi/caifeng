<script setup>
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, Monitor, Moon, Sunny, User } from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import { authState } from '../services/auth'
import {
  preferencesState,
  resetPreferences,
  updatePreferences,
} from '../services/preferences'
import { t } from '../i18n'
import { fromNow } from '../utils/format'
import { workspaceState } from '../services/workspace'

const themes = computed(() => [
  { value: 'light', label: t('settings.light', '浅色'), icon: Sunny },
  { value: 'dark', label: t('settings.dark', '深色'), icon: Moon },
  { value: 'system', label: t('settings.system', '跟随系统'), icon: Monitor },
])

const accents = [
  { value: 'indigo', color: '#4f46e5', label: 'Indigo' },
  { value: 'blue', color: '#2563eb', label: 'Blue' },
  { value: 'teal', color: '#0d9488', label: 'Teal' },
  { value: 'rose', color: '#db4b72', label: 'Rose' },
  { value: 'amber', color: '#c48414', label: 'Amber' },
]

const roleLabel = computed(
  () =>
    ({
      admin: t('role.admin', '管理员'),
      operator: t('role.operator', '操作员'),
      viewer: t('role.viewer', '只读成员'),
    })[authState.user?.role] || t('role.member', '成员'),
)

async function setTheme(theme) {
  const ok = await updatePreferences({ theme })
  if (!ok) ElMessage.error(preferencesState.error)
}

async function setAccent(accent) {
  const ok = await updatePreferences({ accent })
  if (!ok) ElMessage.error(preferencesState.error)
}

async function setLanguage(language) {
  const ok = await updatePreferences({ language })
  if (!ok) ElMessage.error(preferencesState.error)
  else ElMessage.success(t('settings.saved', '偏好已保存'))
}

async function setDensity(density) {
  const ok = await updatePreferences({ density })
  if (!ok) ElMessage.error(preferencesState.error)
}

async function reset() {
  const ok = await resetPreferences()
  if (ok) ElMessage.success(t('settings.saved', '偏好已保存'))
  else ElMessage.error(preferencesState.error)
}
</script>

<template>
  <div class="settings-page">
    <PageHeader
      :eyebrow="t('settings.eyebrow', 'PREFERENCES')"
      :title="t('settings.title', '系统设置')"
      :description="t('settings.description', '管理当前账号的外观、语言和工作区偏好。')"
    >
      <template #actions>
        <el-button :loading="preferencesState.saving" @click="reset">
          {{ t('settings.reset', '恢复默认') }}
        </el-button>
      </template>
    </PageHeader>

    <section class="data-card settings-section">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>{{ t('settings.appearance', '外观') }}</h2>
          <p>{{ t('settings.appearanceHint', '选择浅色、深色或跟随系统。') }}</p>
        </div>
      </div>
      <div class="theme-grid">
        <button
          v-for="theme in themes"
          :key="theme.value"
          class="theme-card"
          :class="{ 'is-active': preferencesState.theme === theme.value }"
          type="button"
          @click="setTheme(theme.value)"
        >
          <span class="theme-preview" :class="`is-${theme.value}`">
            <i class="theme-preview-sidebar" />
            <i class="theme-preview-topbar" />
            <i class="theme-preview-card theme-preview-card-a" />
            <i class="theme-preview-card theme-preview-card-b" />
          </span>
          <span class="theme-card-label">
            <el-icon><component :is="theme.icon" /></el-icon>
            {{ theme.label }}
          </span>
          <span v-if="preferencesState.theme === theme.value" class="theme-check">
            <el-icon><Check /></el-icon>
          </span>
        </button>
      </div>

      <div class="settings-row">
        <div class="settings-row-copy">
          <strong>{{ t('settings.accent', '主题色') }}</strong>
          <span>{{ t('settings.accentHint', '用于导航、按钮和强调元素。') }}</span>
        </div>
        <div class="accent-list">
          <button
            v-for="accent in accents"
            :key="accent.value"
            class="accent-swatch"
            :class="{ 'is-active': preferencesState.accent === accent.value }"
            :style="{ '--swatch': accent.color }"
            :title="accent.label"
            type="button"
            @click="setAccent(accent.value)"
          >
            <span />
          </button>
        </div>
      </div>

      <div class="settings-row">
        <div class="settings-row-copy">
          <strong>{{ t('settings.density', '界面密度') }}</strong>
          <span>{{ t('settings.densityHint', '紧凑模式会缩小列表和表单间距。') }}</span>
        </div>
        <el-radio-group :model-value="preferencesState.density" @change="setDensity">
          <el-radio-button value="comfortable">{{ t('settings.comfortable', '舒适') }}</el-radio-button>
          <el-radio-button value="compact">{{ t('settings.compact', '紧凑') }}</el-radio-button>
        </el-radio-group>
      </div>
    </section>

    <section class="data-card settings-section">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>{{ t('settings.language', '语言') }}</h2>
          <p>{{ t('settings.languageHint', '切换界面语言，立即生效。') }}</p>
        </div>
      </div>
      <div class="language-grid">
        <button
          class="language-card"
          :class="{ 'is-active': preferencesState.language === 'zh' }"
          type="button"
          @click="setLanguage('zh')"
        >
          <span class="language-code">中</span>
          <span>
            <strong>{{ t('settings.chinese', '简体中文') }}</strong>
            <small>Chinese (Simplified)</small>
          </span>
          <el-icon v-if="preferencesState.language === 'zh'" class="language-check"><Check /></el-icon>
        </button>
        <button
          class="language-card"
          :class="{ 'is-active': preferencesState.language === 'en' }"
          type="button"
          @click="setLanguage('en')"
        >
          <span class="language-code">EN</span>
          <span>
            <strong>{{ t('settings.english', 'English') }}</strong>
            <small>English</small>
          </span>
          <el-icon v-if="preferencesState.language === 'en'" class="language-check"><Check /></el-icon>
        </button>
      </div>
    </section>

    <div class="settings-grid">
      <section class="data-card">
        <div class="card-toolbar">
          <div class="toolbar-title">
            <h2>{{ t('settings.account', '账号') }}</h2>
            <p>{{ authState.user?.username }}</p>
          </div>
          <span class="card-mini-icon"><el-icon><User /></el-icon></span>
        </div>
        <div class="settings-facts">
          <div><span>{{ t('settings.role', '角色') }}</span><strong>{{ roleLabel }}</strong></div>
          <div><span>{{ t('settings.username', '用户名') }}</span><strong>{{ authState.user?.username }}</strong></div>
          <div><span>{{ t('settings.lastLogin', '最近登录') }}</span><strong>{{ fromNow(authState.user?.lastLoginAt) }}</strong></div>
        </div>
      </section>

      <section class="data-card">
        <div class="card-toolbar">
          <div class="toolbar-title">
            <h2>{{ t('settings.workspace', '工作区') }}</h2>
            <p>{{ t('common.serverWorkspace', '服务端工作区') }}</p>
          </div>
          <span class="card-mini-icon"><el-icon><Monitor /></el-icon></span>
        </div>
        <div class="settings-facts">
          <div><span>{{ t('settings.lastSaved', '最近保存') }}</span><strong>{{ workspaceState.lastSavedAt ? fromNow(workspaceState.lastSavedAt) : '—' }}</strong></div>
          <div><span>SQLite</span><strong>{{ workspaceState.ready ? 'ONLINE' : 'OFFLINE' }}</strong></div>
          <div><span>{{ t('common.serverSynced', '服务端已同步') }}</span><strong>{{ preferencesState.saving ? t('common.saving', '保存中') : 'OK' }}</strong></div>
        </div>
      </section>
    </div>
  </div>
</template>
