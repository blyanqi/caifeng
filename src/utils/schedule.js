import { formatDateTime, localDateTime, parseDate } from './format'

export const DEFAULT_EXECUTION = {
  retryCount: 0,
  timeoutSeconds: 30,
  concurrency: 1,
}

export const DEFAULT_HEADER_ROTATION = {
  enabled: false,
  strategy: 'round-robin',
  headerIds: [],
  cursor: 0,
}

export const DEFAULT_SCHEDULE = {
  enabled: false,
  mode: 'interval',
  startAt: '',
  endAt: '',
  intervalSeconds: 60,
  onceAt: '',
  nextRunAt: '',
  lastRunAt: '',
  lastResult: '',
  lastMessage: '',
  completedAt: '',
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(number, min), max)
}

export function normalizeExecution(config) {
  const source = config?.execution || {}
  return {
    retryCount: clampNumber(source.retryCount, 0, 10, DEFAULT_EXECUTION.retryCount),
    timeoutSeconds: clampNumber(
      source.timeoutSeconds,
      1,
      60,
      DEFAULT_EXECUTION.timeoutSeconds,
    ),
    concurrency: clampNumber(source.concurrency, 1, 10, DEFAULT_EXECUTION.concurrency),
  }
}

export function normalizeHeaderRotation(config) {
  const source = config?.headerRotation || {}
  return {
    enabled: source.enabled === true,
    strategy: source.strategy === 'random' ? 'random' : 'round-robin',
    headerIds: Array.isArray(source.headerIds) ? source.headerIds.filter(Boolean) : [],
    cursor: Math.max(Number(source.cursor) || 0, 0),
  }
}

export function buildHeaderRotation(input, previous) {
  const rotation = normalizeHeaderRotation({ headerRotation: input })
  const before = normalizeHeaderRotation({ headerRotation: previous })
  const changed =
    rotation.strategy !== before.strategy ||
    rotation.headerIds.join(',') !== before.headerIds.join(',')
  rotation.cursor = changed ? 0 : before.cursor
  return rotation
}

export function normalizeSchedule(config) {
  const source = config?.schedule || {}
  return {
    ...DEFAULT_SCHEDULE,
    ...source,
    enabled: source.enabled === true,
    mode: source.mode === 'once' ? 'once' : 'interval',
    intervalSeconds: clampNumber(source.intervalSeconds, 5, 86400, 60),
  }
}

export function executionLabel(config) {
  const execution = normalizeExecution(config)
  return `重试 ${execution.retryCount} 次 · 超时 ${execution.timeoutSeconds}s · 并发 ${execution.concurrency}`
}

export function scheduleSummary(config) {
  const schedule = normalizeSchedule(config)
  if (!schedule.enabled) {
    if (schedule.completedAt) {
      return schedule.mode === 'once' ? '单次定时已完成' : '时间段已结束'
    }
    return '仅手动触发'
  }
  if (schedule.mode === 'once') {
    return `单次 · ${formatDateTime(schedule.onceAt, { withSeconds: true })}`
  }
  return `每 ${schedule.intervalSeconds} 秒 · ${formatDateTime(schedule.startAt, { withSeconds: true })} 至 ${formatDateTime(schedule.endAt, { withSeconds: true })}`
}

export function nextRunLabel(schedule) {
  if (!schedule?.enabled || !schedule.nextRunAt) return ''
  return `下次 ${formatDateTime(schedule.nextRunAt, { withSeconds: true })}`
}

export function computeInitialNextRun(input, now = new Date()) {
  const schedule = normalizeSchedule({ schedule: input })
  if (schedule.mode === 'once') {
    const onceAt = parseDate(schedule.onceAt)
    if (!onceAt) return ''
    return localDateTime(onceAt.getTime() > now.getTime() ? onceAt : now)
  }

  const startAt = parseDate(schedule.startAt)
  const endAt = parseDate(schedule.endAt)
  if (!startAt) return ''
  if (endAt && endAt.getTime() < now.getTime()) return ''
  return localDateTime(startAt.getTime() > now.getTime() ? startAt : now)
}

export function computeNextInterval(input, from = new Date()) {
  const schedule = normalizeSchedule({ schedule: input })
  const endAt = parseDate(schedule.endAt)
  const next = new Date(from.getTime() + schedule.intervalSeconds * 1000)
  if (endAt && next.getTime() > endAt.getTime()) return ''
  return localDateTime(next)
}

export function buildSchedule(input, previous) {
  const schedule = normalizeSchedule({ schedule: input })
  const before = normalizeSchedule({ schedule: previous })
  const changed =
    schedule.mode !== before.mode ||
    (schedule.mode === 'once'
      ? schedule.onceAt !== before.onceAt
      : schedule.startAt !== before.startAt ||
        schedule.endAt !== before.endAt ||
        Number(schedule.intervalSeconds) !== Number(before.intervalSeconds))
  schedule.lastRunAt = before.lastRunAt
  schedule.lastResult = before.lastResult
  schedule.lastMessage = before.lastMessage

  if (!schedule.enabled) {
    schedule.nextRunAt = ''
    schedule.completedAt = before.completedAt
    return schedule
  }

  if (!before.enabled || changed) {
    schedule.nextRunAt = computeInitialNextRun(schedule)
    schedule.completedAt = ''
  } else {
    schedule.nextRunAt = before.nextRunAt || computeInitialNextRun(schedule)
    schedule.completedAt = before.completedAt
  }
  return schedule
}

export function buildDefaultScheduleInput() {
  const now = new Date()
  const end = new Date(now.getTime() + 60 * 60 * 1000)
  const once = new Date(now.getTime() + 5 * 60 * 1000)
  return {
    startAt: localDateTime(now),
    endAt: localDateTime(end),
    onceAt: localDateTime(once),
    intervalSeconds: 60,
  }
}
