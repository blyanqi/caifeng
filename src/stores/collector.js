import { reactive, watch } from 'vue'
import { createSeedState } from '../data/seed'
import { localDateTime, uid } from '../utils/format'
import { normalizeParamRows, normalizeParamValueForStorage } from '../utils/params'

const STORAGE_KEY = 'caifeng.collector.v2'
const LEGACY_STORAGE_KEYS = ['caifeng.collector.v1']

function loadState() {
  try {
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key))
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createSeedState()
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== 2) {
      localStorage.removeItem(STORAGE_KEY)
      return createSeedState()
    }
    const fallback = createSeedState()
    const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : fallback.tasks).map((task) =>
      task.status === 'running'
        ? {
            ...task,
            status: 'error',
            lastError: '上次采集因页面刷新或关闭而中断，请重新运行',
          }
        : task,
    )
    return {
      ...fallback,
      ...parsed,
      sites: Array.isArray(parsed.sites) ? parsed.sites : fallback.sites,
      configs: Array.isArray(parsed.configs) ? parsed.configs : fallback.configs,
      headers: Array.isArray(parsed.headers) ? parsed.headers : fallback.headers,
      params: Array.isArray(parsed.params)
        ? parsed.params.map((param) => ({
            ...param,
            rows: normalizeParamRows(param.rows),
          }))
        : fallback.params,
      storages: Array.isArray(parsed.storages) ? parsed.storages : fallback.storages,
      proxies: Array.isArray(parsed.proxies) ? parsed.proxies : fallback.proxies,
      tasks,
      runs: Array.isArray(parsed.runs) ? parsed.runs : fallback.runs,
      collected: parsed.collected && typeof parsed.collected === 'object' ? parsed.collected : {},
      meta: { ...fallback.meta, ...(parsed.meta || {}) },
    }
  } catch (error) {
    console.warn('[collector] 本地数据读取失败，已使用空工作区。', error)
    return createSeedState()
  }
}

export const store = reactive(loadState())

let saveTimer = null
let localCacheEnabled = true

export function disableLocalCache() {
  localCacheEnabled = false
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function persistNow() {
  store.meta.lastSavedAt = localDateTime()
  if (!localCacheEnabled) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch (error) {
    console.warn('[collector] 本地数据保存失败。', error)
  }
}

export function schedulePersist() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistNow()
  }, 120)
}

watch(store, schedulePersist, { deep: true })

export function findById(collection, id) {
  return (store[collection] || []).find((item) => item.id === id) || null
}

export function taskRelations(task) {
  if (!task) return {}
  return {
    site: findById('sites', task.siteId),
    config: findById('configs', task.configId),
    header: findById('headers', task.headerId),
    param: findById('params', task.paramId),
    storage: findById('storages', task.storageId),
  }
}

export function usageCount(entity, id) {
  const field = {
    sites: 'siteId',
    configs: 'configId',
    headers: 'headerId',
    params: 'paramId',
    storages: 'storageId',
  }[entity]
  if (!field) return 0
  return store.tasks.filter((task) => task[field] === id).length
}

export function createSite(payload) {
  const now = localDateTime()
  const site = {
    id: uid('site'),
    ...payload,
    enabled: payload.enabled !== false,
    createdAt: now,
    updatedAt: now,
  }
  store.sites.unshift(site)
  return site
}

export function updateSite(id, payload) {
  const target = findById('sites', id)
  if (!target) return null
  Object.assign(target, payload, { updatedAt: localDateTime() })
  return target
}

export function removeSite(id) {
  const index = store.sites.findIndex((item) => item.id === id)
  if (index >= 0) store.sites.splice(index, 1)
}

export function createConfig(payload) {
  const now = localDateTime()
  const config = {
    id: uid('config'),
    ...payload,
    createdAt: now,
    updatedAt: now,
  }
  store.configs.unshift(config)
  return config
}

export function updateConfig(id, payload) {
  const target = findById('configs', id)
  if (!target) return null
  Object.assign(target, payload, { updatedAt: localDateTime() })
  return target
}

export function removeConfig(id) {
  const index = store.configs.findIndex((item) => item.id === id)
  if (index >= 0) store.configs.splice(index, 1)
}

export function createHeader(payload) {
  const now = localDateTime()
  const header = {
    id: uid('header'),
    ...payload,
    rows: (payload.rows || []).map((row) => ({ ...row, id: row.id || uid('row') })),
    createdAt: now,
    updatedAt: now,
  }
  store.headers.unshift(header)
  return header
}

export function updateHeader(id, payload) {
  const target = findById('headers', id)
  if (!target) return null
  Object.assign(target, payload, {
    rows: (payload.rows || []).map((row) => ({ ...row, id: row.id || uid('row') })),
    updatedAt: localDateTime(),
  })
  return target
}

export function removeHeader(id) {
  const index = store.headers.findIndex((item) => item.id === id)
  if (index >= 0) store.headers.splice(index, 1)
}

export function createParam(payload) {
  const now = localDateTime()
  const param = {
    id: uid('param'),
    ...payload,
    rows: normalizeParamRows(
      (payload.rows || []).map((row) => ({ ...row, id: row.id || uid('row') })),
    ).map(normalizeParamValueForStorage),
    createdAt: now,
    updatedAt: now,
  }
  store.params.unshift(param)
  return param
}

export function updateParam(id, payload) {
  const target = findById('params', id)
  if (!target) return null
  Object.assign(target, payload, {
    rows: normalizeParamRows(
      (payload.rows || []).map((row) => ({ ...row, id: row.id || uid('row') })),
    ).map(normalizeParamValueForStorage),
    updatedAt: localDateTime(),
  })
  return target
}

export function removeParam(id) {
  const index = store.params.findIndex((item) => item.id === id)
  if (index >= 0) store.params.splice(index, 1)
}

export function createStorage(payload) {
  const now = localDateTime()
  const storage = {
    id: uid('storage'),
    ...payload,
    createdAt: now,
    updatedAt: now,
  }
  store.storages.unshift(storage)
  return storage
}

export function updateStorage(id, payload) {
  const target = findById('storages', id)
  if (!target) return null
  Object.assign(target, payload, { updatedAt: localDateTime() })
  return target
}

export function removeStorage(id) {
  const index = store.storages.findIndex((item) => item.id === id)
  if (index >= 0) store.storages.splice(index, 1)
  delete store.collected[id]
}

export function createProxy(payload) {
  const now = localDateTime()
  const proxy = {
    id: uid('proxy'),
    ...payload,
    enabled: payload.enabled !== false,
    createdAt: now,
    updatedAt: now,
  }
  store.proxies.unshift(proxy)
  return proxy
}

export function updateProxy(id, payload) {
  const target = findById('proxies', id)
  if (!target) return null
  Object.assign(target, payload, { updatedAt: localDateTime() })
  return target
}

export function removeProxy(id) {
  const index = store.proxies.findIndex((item) => item.id === id)
  if (index >= 0) store.proxies.splice(index, 1)
}

export function createTask(payload) {
  const now = localDateTime()
  const task = {
    id: uid('task'),
    ...payload,
    status: 'ready',
    lastRunAt: '',
    lastDuration: 0,
    lastCount: 0,
    totalCollected: 0,
    lastError: '',
    createdAt: now,
    updatedAt: now,
  }
  store.tasks.unshift(task)
  return task
}

export function updateTask(id, payload) {
  const target = findById('tasks', id)
  if (!target) return null
  const status =
    payload.status || (target.status === 'running' ? 'running' : target.status)
  Object.assign(target, payload, { status, updatedAt: localDateTime() })
  return target
}

export function removeTask(id) {
  const index = store.tasks.findIndex((item) => item.id === id)
  if (index >= 0) store.tasks.splice(index, 1)
  store.runs = store.runs.filter((run) => run.taskId !== id)
}

export function appendRun(run) {
  store.runs.unshift({
    id: uid('run'),
    ...run,
    preview: (run.preview || []).slice(0, 3),
    logs: Array.isArray(run.logs) ? run.logs.slice(-80) : [],
  })
  store.runs = store.runs.slice(0, 50)
}

export function archiveRecords(storageId, records) {
  if (!storageId || !Array.isArray(records)) return
  const now = localDateTime()
  const previous = store.collected[storageId] || { total: 0, records: [], updatedAt: '' }
  const safeRecords = records.slice(0, 30).map((record) => {
    if (record && typeof record === 'object') {
      const copy = {}
      Object.entries(record)
        .slice(0, 24)
        .forEach(([key, value]) => {
          copy[key] = typeof value === 'string' ? value.slice(0, 600) : value
        })
      return copy
    }
    return record
  })
  store.collected[storageId] = {
    total: Number(previous.total || 0) + records.length,
    updatedAt: now,
    records: [...safeRecords, ...(previous.records || [])].slice(0, 80),
  }
}

export function hydrateStore(data) {
  const fresh = createSeedState()
  const source = data && typeof data === 'object' ? data : {}
  Object.keys(store).forEach((key) => {
    if (!(key in fresh)) delete store[key]
  })
  Object.assign(store, fresh, source)
  store.sites = Array.isArray(source.sites) ? source.sites : fresh.sites
  store.configs = Array.isArray(source.configs) ? source.configs : fresh.configs
  store.headers = Array.isArray(source.headers) ? source.headers : fresh.headers
  store.params = Array.isArray(source.params)
    ? source.params.map((param) => ({
        ...param,
        rows: normalizeParamRows(param.rows),
      }))
    : fresh.params
  store.storages = Array.isArray(source.storages) ? source.storages : fresh.storages
  store.proxies = Array.isArray(source.proxies) ? source.proxies : fresh.proxies
  store.tasks = Array.isArray(source.tasks)
    ? source.tasks.map((task) =>
        task.status === 'running'
          ? {
              ...task,
              status: 'error',
              lastError: '上次采集因服务重启或页面刷新而中断，请重新运行',
            }
          : task,
      )
    : fresh.tasks
  store.runs = Array.isArray(source.runs) ? source.runs : fresh.runs
  store.collected =
    source.collected && typeof source.collected === 'object' ? source.collected : {}
  store.meta = { ...fresh.meta, ...(source.meta || {}) }
}

export function clearWorkspaceData() {
  const fresh = createSeedState()
  Object.keys(store).forEach((key) => {
    if (!(key in fresh)) delete store[key]
  })
  Object.assign(store, fresh)
  persistNow()
}
