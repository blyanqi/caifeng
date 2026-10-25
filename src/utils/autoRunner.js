import { appendRun, archiveRecords, taskRelations } from '../stores/collector'
import { collectTaskWithRetry } from './collectRetry'
import { resolveEndpoint } from './collector'
import { formatTime, localDateTime } from './format'
import { iterationInfoOf, resolveParamRows } from './params'
import { normalizeExecution, normalizeHeaderRotation } from './schedule'
import {
  storageSupportsFile,
  writeHtmlFolder,
  writeMediaFolder,
  writeStorageFile,
} from './storageFiles'

function pushLog(logs, text, type = 'info') {
  logs.push({ time: formatTime(new Date()), text, type })
}

function finishFailure(task, startedAt, method, requestUrl, message, logs, iteration) {
  task.status = 'error'
  task.updatedAt = localDateTime()
  task.lastRunAt = localDateTime()
  task.lastDuration = 0
  task.lastCount = 0
  task.lastError = message
  pushLog(logs, message, 'error')
  appendRun({
    taskId: task.id,
    taskName: task.name,
    startedAt,
    status: 'error',
    count: 0,
    duration: 0,
    storageId: task.storageId,
    message,
    preview: [],
    method,
    requestUrl,
    httpStatus: '',
    pageCount: 0,
    iteration,
    trigger: 'auto',
    error: message,
    logs: logs.map((log) => ({ ...log })),
  })
}

export async function runScheduledTask(task, options = {}) {
  if (!task) return { success: false, skipped: true, error: '任务不存在' }
  if (task.status === 'running') {
    return { success: false, skipped: true, error: '任务正在运行' }
  }

  const config = options.config || taskRelations(task).config
  const startedAt = localDateTime()
  const runNow = new Date()
  const logs = []
  const relations = taskRelations(task)
  const method = (relations.config?.method || 'GET').toUpperCase()
  const execution = normalizeExecution(config)

  if (!relations.site || !relations.config || !relations.storage) {
    const message = '任务关联资源不完整，自动采集已跳过'
    finishFailure(task, startedAt, method, '', message, logs, null)
    return { success: false, error: message }
  }
  if (relations.site.enabled === false) {
    const message = '关联站点已停用，自动采集已跳过'
    finishFailure(task, startedAt, method, '', message, logs, null)
    return { success: false, error: message }
  }

  let iteration = null
  if (task.iteration?.enabled) {
    const info = iterationInfoOf(task, relations.param)
    if (info?.invalid) {
      const message = '遍历参数不存在或已被删除'
      finishFailure(task, startedAt, method, '', message, logs, null)
      return { success: false, error: message }
    }
    if (!info?.total) {
      const message = '遍历列表为空'
      finishFailure(task, startedAt, method, '', message, logs, null)
      return { success: false, error: message }
    }
    if (info.completed) {
      return { success: false, skipped: true, error: '列表已遍历完成' }
    }
    iteration = {
      rowId: info.rowId,
      rowKey: info.rowKey,
      index: info.cursor,
      total: info.total,
      value: info.currentValue,
    }
  }

  let requestUrl = ''
  try {
    requestUrl = resolveEndpoint(relations.site.baseUrl, relations.config.path)
    const url = new URL(requestUrl)
    resolveParamRows(relations.param, {
      now: runNow,
      iterationRowId: iteration?.rowId,
      iterationIndex: iteration?.index,
    }).forEach((row) => url.searchParams.set(row.key, row.value ?? ''))
    requestUrl = url.toString()
  } catch {
    requestUrl = ''
  }

  task.status = 'running'
  task.updatedAt = startedAt
  task.lastError = ''

  pushLog(logs, `自动采集触发 · ${options.triggerLabel || '定时计划'}`, 'step')
  pushLog(
    logs,
    `站点 ${relations.site.name} · 配置 ${relations.config.name} · 存储 ${relations.storage.name}`,
  )
  const headerRotation = normalizeHeaderRotation(relations.config)
  pushLog(
    logs,
    headerRotation.enabled && headerRotation.headerIds.length
      ? `Header 轮换 · ${headerRotation.headerIds.length} 个模板 · ${headerRotation.strategy === 'random' ? '随机' : '顺序'}`
      : `Header ${relations.header?.name || '无'} · 参数 ${relations.param?.name || '无'}`,
  )
  pushLog(
    logs,
    `执行策略 超时 ${execution.timeoutSeconds}s · 失败重试 ${execution.retryCount} 次 · 并发 ${execution.concurrency}`,
  )
  if (iteration) {
    pushLog(
      logs,
      `遍历参数 ${iteration.rowKey} · 第 ${iteration.index + 1}/${iteration.total} 项 · 当前值 ${iteration.value}`,
      'step',
    )
  }
  pushLog(logs, `构建请求 ${method} ${requestUrl || relations.config.path}`)
  pushLog(logs, '服务端代理转发请求，等待目标站点响应…', 'step')

  try {
    const result = await collectTaskWithRetry(
      task,
      {
        iteration,
        now: runNow,
        timeout: execution.timeoutSeconds * 1000,
      },
      {
        retryCount: execution.retryCount,
        onRetry: (attempt, total, error) => {
          pushLog(
            logs,
            `请求失败：${error?.message || '未知错误'} · 第 ${attempt}/${total} 次重试`,
            'error',
          )
        },
      },
    )

    pushLog(logs, `响应成功 · HTTP ${result.status} · ${result.duration}ms`, 'success')
    const responseType = relations.config.responseType
    const parseMessage =
      responseType === 'html'
        ? `解析页面规则 ${relations.site.pageRule?.itemSelector || ''} · ${result.pageCount || 1} 页 · 共 ${result.records.length} 条`
        : responseType === 'web'
          ? `提取网页片段 ${relations.config.fragmentRule?.fields?.length || 0} 个字段 · 共 ${result.records.length} 条`
          : ['image', 'video'].includes(responseType)
            ? `提取${responseType === 'image' ? '图片' : '视频'}地址 · 共 ${result.records.length} 条`
            : responseType === 'link'
              ? `提取链接 ${relations.config.linkRule?.selector || 'a[href]'} · ${result.pageCount || 1} 页 · 共 ${result.records.length} 条`
              : responseType === 'xhr'
                ? `解析 XHR 响应${relations.config.dataPath ? ` ${relations.config.dataPath}` : ''} · 共 ${result.records.length} 条`
                : `解析${relations.config.dataPath ? `数据路径 ${relations.config.dataPath}` : '完整响应'} · 共 ${result.records.length} 条`
    pushLog(logs, parseMessage, 'success')

    archiveRecords(task.storageId, result.records)

    let storageFilePath = ''
    if (storageSupportsFile(relations.storage.type)) {
      try {
        const file = await writeStorageFile(
          relations.storage,
          result.records,
          result.pages || [],
        )
        storageFilePath = file?.path || ''
        if (storageFilePath) pushLog(logs, `已写入本地文件 ${storageFilePath}`, 'success')
      } catch (fileError) {
        pushLog(logs, `本地文件写入失败：${fileError?.message || '未知错误'}`, 'info')
      }
    }

    if (relations.storage.type === 'html_folder') {
      if (['html', 'web', 'link'].includes(relations.config.responseType)) {
        try {
          const saved = await writeHtmlFolder(relations.storage, result.pages || [])
          storageFilePath = saved?.manifest || storageFilePath
          pushLog(
            logs,
            `已保存 ${saved?.files?.length || 0} 个 HTML 页面到 ${saved?.folder || relations.storage.target}`,
            'success',
          )
        } catch (folderError) {
          pushLog(logs, `HTML 文件夹写入失败：${folderError?.message || '未知错误'}`, 'info')
        }
      } else {
        pushLog(logs, 'HTML 文件夹存储需要 HTML、网页片段或链接采集配置，本次未写入文件', 'info')
      }
    }

    if (['image_folder', 'video_folder'].includes(relations.storage.type)) {
      const expectedType =
        relations.storage.type === 'image_folder' ? 'image' : 'video'
      if (
        relations.config.responseType === expectedType &&
        relations.config.media?.collectResource === false
      ) {
        pushLog(logs, '配置已关闭资源采集，本次仅保存媒体地址，不下载文件', 'info')
      } else if (relations.config.responseType === expectedType) {
        try {
          const saved = await writeMediaFolder(
            relations.storage,
            result.records,
            execution.concurrency,
          )
          storageFilePath = saved?.manifest || storageFilePath
          pushLog(
            logs,
            `已下载 ${saved?.files?.length || 0} 个${expectedType === 'image' ? '图片' : '视频'}到 ${saved?.folder || relations.storage.target}`,
            'success',
          )
          if (saved?.errors?.length) {
            pushLog(logs, `另有 ${saved.errors.length} 个媒体文件下载失败`, 'info')
          }
          if (saved?.limited) pushLog(logs, '媒体下载已限制为前 50 个文件', 'info')
        } catch (folderError) {
          pushLog(logs, `媒体文件夹写入失败：${folderError?.message || '未知错误'}`, 'info')
        }
      } else {
        pushLog(
          logs,
          `${relations.storage.type === 'image_folder' ? '图片' : '视频'}文件夹需要对应的媒体采集配置，本次未写入文件`,
          'info',
        )
      }
    }

    task.status = 'success'
    task.updatedAt = localDateTime()
    task.lastRunAt = localDateTime()
    task.lastDuration = result.duration
    task.lastCount = result.records.length
    task.totalCollected = Number(task.totalCollected || 0) + result.records.length
    task.lastError = ''
    pushLog(logs, `已归档到 ${relations.storage.name}`, 'success')

    if (iteration && task.iteration) {
      task.iteration.cursor = Math.min(iteration.index + 1, iteration.total)
      pushLog(
        logs,
        task.iteration.cursor >= iteration.total
          ? `列表遍历已完成 · ${iteration.total}/${iteration.total}`
          : `遍历进度推进至 ${task.iteration.cursor}/${iteration.total}`,
        'success',
      )
    }

    appendRun({
      taskId: task.id,
      taskName: task.name,
      startedAt,
      status: 'success',
      count: result.records.length,
      duration: result.duration,
      storageId: task.storageId,
      message: '自动采集完成',
      preview: result.records.slice(0, 3),
      method,
      requestUrl,
      httpStatus: String(result.status),
      pageCount: result.pageCount || 1,
      iteration,
      filePath: storageFilePath,
      trigger: 'auto',
      error: '',
      logs: logs.map((log) => ({ ...log })),
    })

    return {
      success: true,
      count: result.records.length,
      duration: result.duration,
      startedAt,
      iteration,
      taskId: task.id,
    }
  } catch (error) {
    const message = error?.message || '自动采集失败'
    task.status = 'error'
    task.updatedAt = localDateTime()
    task.lastRunAt = localDateTime()
    task.lastDuration = 0
    task.lastCount = 0
    task.lastError = message
    pushLog(logs, message, 'error')
    appendRun({
      taskId: task.id,
      taskName: task.name,
      startedAt,
      status: 'error',
      count: 0,
      duration: 0,
      storageId: task.storageId,
      message,
      preview: [],
      method,
      requestUrl,
      httpStatus: '',
      pageCount: 0,
      iteration,
      trigger: 'auto',
      error: message,
      logs: logs.map((log) => ({ ...log })),
    })
    return { success: false, error: message, taskId: task.id }
  }
}
