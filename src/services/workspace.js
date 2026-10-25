import { reactive, watch } from 'vue'
import { disableLocalCache, hydrateStore, store } from '../stores/collector'
import { apiRequest } from './api'
import { authState, canWrite } from './auth'

export const workspaceState = reactive({
  ready: false,
  loading: false,
  saving: false,
  error: '',
  lastSavedAt: '',
})

let stopWatch = null
let saveTimer = null
let saving = false
let pendingSave = false
let revision = 0
let savedRevision = 0

function snapshot() {
  return JSON.parse(JSON.stringify(store))
}

async function saveNow() {
  if (!canWrite() || !workspaceState.ready) return
  if (revision <= savedRevision) return
  if (saving) {
    pendingSave = true
    return
  }
  saving = true
  workspaceState.saving = true
  const savingRevision = revision
  try {
    const payload = await apiRequest('/api/workspace', {
      method: 'PUT',
      body: { data: snapshot() },
    })
    savedRevision = savingRevision
    workspaceState.lastSavedAt = payload.updatedAt || new Date().toISOString()
    workspaceState.error = ''
  } catch (error) {
    workspaceState.error = error?.message || '工作区保存失败'
  } finally {
    saving = false
    workspaceState.saving = false
    if (pendingSave || revision > savedRevision) {
      pendingSave = false
      await saveNow()
    }
  }
}

export function scheduleWorkspaceSave(delay = 600) {
  if (!workspaceState.ready || !canWrite()) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveNow()
  }, delay)
}

export function startWorkspaceSync() {
  if (stopWatch) return
  stopWatch = watch(
    store,
    () => {
      if (!workspaceState.ready) return
      revision += 1
      scheduleWorkspaceSave()
    },
    { deep: true },
  )
}

export function stopWorkspaceSync() {
  if (stopWatch) {
    stopWatch()
    stopWatch = null
  }
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

export async function loadWorkspace() {
  if (!authState.user) return
  workspaceState.loading = true
  workspaceState.error = ''
  stopWorkspaceSync()
  try {
    const payload = await apiRequest('/api/workspace')
    if (payload.data) {
      hydrateStore(payload.data)
    } else {
      // First login: migrate the browser workspace to the server.
      await apiRequest('/api/workspace', {
        method: 'PUT',
        body: { data: snapshot() },
      })
    }
    disableLocalCache()
    workspaceState.ready = true
    workspaceState.lastSavedAt = payload.updatedAt || new Date().toISOString()
    revision = 0
    savedRevision = 0
    startWorkspaceSync()
  } catch (error) {
    workspaceState.error = error?.message || '工作区加载失败'
    workspaceState.ready = false
    throw error
  } finally {
    workspaceState.loading = false
  }
}

export async function flushWorkspace() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await saveNow()
}

export function installUnloadFlush() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeunload', () => {
    if (!workspaceState.ready || !canWrite() || revision <= savedRevision) return
    try {
      const body = JSON.stringify({ data: snapshot() })
      navigator.sendBeacon?.(
        '/api/workspace',
        new Blob([body], { type: 'application/json' }),
      )
    } catch {
      // ignore
    }
  })
}
