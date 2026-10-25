import { store } from '../stores/collector'
import { runScheduledTask } from './autoRunner'
import { localDateTime, parseDate } from './format'
import {
  computeInitialNextRun,
  computeNextInterval,
  normalizeSchedule,
} from './schedule'

let timer = null
let initialTimer = null
let ticking = false
const runningConfigs = new Set()

function finishSchedule(config, schedule, now) {
  config.schedule = {
    ...schedule,
    enabled: false,
    nextRunAt: '',
    completedAt: localDateTime(now),
  }
}

async function runConfigSchedule(config, schedule, now) {
  const tasks = store.tasks.filter((task) => task.configId === config.id)
  const base = {
    ...schedule,
    lastRunAt: localDateTime(now),
  }

  if (!tasks.length) {
    config.schedule = {
      ...base,
      lastResult: 'error',
      lastMessage: '未关联采集任务',
    }
    if (schedule.mode === 'once') {
      finishSchedule(config, config.schedule, now)
    } else {
      const nextRunAt = computeNextInterval(config.schedule, now)
      if (!nextRunAt) {
        finishSchedule(config, config.schedule, now)
      } else {
        config.schedule.nextRunAt = nextRunAt
      }
    }
    return
  }

  let success = 0
  let failed = 0
  let skipped = 0
  let lastError = ''

  for (const task of tasks) {
    if (task.status === 'running') {
      skipped += 1
      continue
    }
    const result = await runScheduledTask(task, {
      config,
      triggerLabel:
        schedule.mode === 'once'
          ? '单次定时采集'
          : `间隔采集 · 每 ${schedule.intervalSeconds} 秒`,
    })
    if (result.success) {
      success += 1
    } else if (result.skipped) {
      skipped += 1
    } else {
      failed += 1
      lastError = result.error || lastError
    }
  }

  const resultState = failed ? (success ? 'partial' : 'error') : 'success'
  const messageParts = [`成功 ${success}`]
  if (failed) messageParts.push(`失败 ${failed}`)
  if (skipped) messageParts.push(`跳过 ${skipped}`)
  if (lastError) messageParts.push(lastError.slice(0, 80))

  const nextSchedule = {
    ...base,
    lastResult: resultState,
    lastMessage: messageParts.join(' · '),
  }

  if (schedule.mode === 'once') {
    config.schedule = {
      ...nextSchedule,
      enabled: false,
      nextRunAt: '',
      completedAt: localDateTime(now),
    }
    return
  }

  const nextRunAt = computeNextInterval(nextSchedule, now)
  if (!nextRunAt) {
    config.schedule = {
      ...nextSchedule,
      enabled: false,
      nextRunAt: '',
      completedAt: localDateTime(now),
      lastMessage: `${nextSchedule.lastMessage} · 时间段结束`,
    }
    return
  }
  config.schedule = {
    ...nextSchedule,
    nextRunAt,
  }
}

async function tick() {
  if (ticking) return
  ticking = true
  try {
    const now = new Date()
    for (const config of [...store.configs]) {
      if (runningConfigs.has(config.id)) continue
      const schedule = normalizeSchedule(config)
      if (!schedule.enabled) continue
      if (schedule.completedAt) {
        config.schedule = { ...schedule, enabled: false, nextRunAt: '' }
        continue
      }

      if (!schedule.nextRunAt) {
        const initial = computeInitialNextRun(schedule, now)
        if (!initial) {
          finishSchedule(config, schedule, now)
          continue
        }
        config.schedule = { ...schedule, nextRunAt: initial }
        continue
      }

      const nextAt = parseDate(schedule.nextRunAt)
      if (!nextAt) {
        config.schedule = { ...schedule, nextRunAt: computeInitialNextRun(schedule, now) }
        continue
      }
      if (now.getTime() < nextAt.getTime()) continue

      const endAt = parseDate(schedule.endAt)
      if (schedule.mode === 'interval' && endAt && now.getTime() > endAt.getTime()) {
        finishSchedule(config, schedule, now)
        continue
      }

      const linkedTasks = store.tasks.filter((task) => task.configId === config.id)
      if (linkedTasks.some((task) => task.status === 'running')) continue

      runningConfigs.add(config.id)
      try {
        await runConfigSchedule(config, schedule, now)
      } catch (error) {
        config.schedule = {
          ...normalizeSchedule(config),
          lastRunAt: localDateTime(now),
          lastResult: 'error',
          lastMessage: error?.message || '自动采集调度失败',
        }
      } finally {
        runningConfigs.delete(config.id)
      }
    }
  } finally {
    ticking = false
  }
}

export function startAutoScheduler() {
  if (timer) return () => stopAutoScheduler()
  initialTimer = setTimeout(tick, 600)
  timer = setInterval(tick, 1000)
  return () => stopAutoScheduler()
}

export function stopAutoScheduler() {
  if (initialTimer) {
    clearTimeout(initialTimer)
    initialTimer = null
  }
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  runningConfigs.clear()
}
