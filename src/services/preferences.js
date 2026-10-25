import { reactive } from 'vue'
import { apiRequest } from './api'
import { localeState, setLocale } from '../i18n'

const STORAGE_KEY = 'caifeng.preferences.v1'
const DEFAULTS = {
  theme: 'system',
  accent: 'indigo',
  language: 'zh',
  density: 'comfortable',
}

export const preferencesState = reactive({
  ...DEFAULTS,
  resolvedTheme: 'light',
  loading: false,
  saving: false,
  error: '',
})

let mediaQuery = null

function cachedPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function resolvedTheme(theme) {
  if (theme === 'dark') return 'dark'
  if (theme === 'light') return 'light'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyPreferences(preferences = preferencesState) {
  const theme = ['light', 'dark', 'system'].includes(preferences.theme)
    ? preferences.theme
    : 'system'
  const accent = preferences.accent || 'indigo'
  const density = preferences.density === 'compact' ? 'compact' : 'comfortable'
  const language = preferences.language === 'en' ? 'en' : 'zh'
  const resolved = resolvedTheme(theme)
  preferencesState.theme = theme
  preferencesState.accent = accent
  preferencesState.density = density
  preferencesState.language = language
  preferencesState.resolvedTheme = resolved
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.accent = accent
  document.documentElement.dataset.density = density
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  if (localeState.locale !== language) setLocale(language)
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ theme, accent, language, density }),
  )
}

export function applyCachedPreferences() {
  const cached = cachedPreferences()
  if (cached) applyPreferences(cached)
  else applyPreferences(DEFAULTS)
}

function watchSystemTheme() {
  if (!mediaQuery) {
    mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)')
    mediaQuery?.addEventListener?.('change', () => {
      if (preferencesState.theme === 'system') applyPreferences(preferencesState)
    })
  }
}

export async function loadPreferences() {
  preferencesState.loading = true
  preferencesState.error = ''
  try {
    const payload = await apiRequest('/api/preferences')
    applyPreferences({ ...DEFAULTS, ...(payload.preferences || {}) })
    watchSystemTheme()
  } catch (error) {
    preferencesState.error = error?.message || '加载偏好失败'
    applyCachedPreferences()
  } finally {
    preferencesState.loading = false
  }
}

export async function updatePreferences(partial) {
  const next = { ...preferencesState, ...partial }
  applyPreferences(next)
  preferencesState.saving = true
  preferencesState.error = ''
  try {
    const payload = await apiRequest('/api/preferences', {
      method: 'PUT',
      body: {
        theme: next.theme,
        accent: next.accent,
        language: next.language,
        density: next.density,
      },
    })
    applyPreferences({ ...DEFAULTS, ...(payload.preferences || {}) })
    return true
  } catch (error) {
    preferencesState.error = error?.message || '保存偏好失败'
    return false
  } finally {
    preferencesState.saving = false
  }
}

export function resetPreferences() {
  return updatePreferences(DEFAULTS)
}
