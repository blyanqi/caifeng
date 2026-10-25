import { collectTask } from './collector'

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function collectTaskWithRetry(task, options = {}, config = {}) {
  const retryCount = Math.min(Math.max(Number(config.retryCount) || 0, 0), 10)
  let attempt = 0
  while (true) {
    try {
      return await collectTask(task, options)
    } catch (error) {
      if (attempt >= retryCount) throw error
      attempt += 1
      config.onRetry?.(attempt, retryCount, error)
      await wait(600 * attempt)
    }
  }
}
