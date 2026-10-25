<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCheck,
  Collection,
  DataAnalysis,
  Delete,
  Document,
  EditPen,
  Files,
  Link,
  MoreFilled,
  Operation,
  Plus,
  Refresh,
  RefreshLeft,
  Search,
  SetUp,
  VideoPlay,
} from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import StatCard from '../components/StatCard.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import TaskDialog from '../components/TaskDialog.vue'
import TaskRunDrawer from '../components/TaskRunDrawer.vue'
import TaskLogDrawer from '../components/TaskLogDrawer.vue'
import BatchRunDrawer from '../components/BatchRunDrawer.vue'
import {
  appendRun,
  archiveRecords,
  removeTask,
  store,
  taskRelations,
} from '../stores/collector'
import { resolveEndpoint } from '../utils/collector'
import { collectTaskWithRetry } from '../utils/collectRetry'
import { iterationInfoOf, resolveParamRows } from '../utils/params'
import { normalizeExecution, normalizeHeaderRotation } from '../utils/schedule'
import {
  storageSupportsFile,
  writeHtmlFolder,
  writeMediaFolder,
  writeStorageFile,
} from '../utils/storageFiles'
import {
  formatDateTime,
  formatNumber,
  formatTime,
  fromNow,
  hostOf,
  localDateTime,
} from '../utils/format'

const TASK_STATUS = {
  ready: { label: '待采集', tone: 'ready' },
  running: { label: '采集中', tone: 'running' },
  success: { label: '已完成', tone: 'success' },
  error: { label: '失败', tone: 'error' },
}

const AVATAR_TONES = [
  'avatar-indigo',
  'avatar-teal',
  'avatar-amber',
  'avatar-rose',
  'avatar-slate',
  'avatar-cyan',
]
const activeTab = ref('all')
const keyword = ref('')
const siteFilter = ref('')
const page = ref(1)
const pageSize = ref(6)
const selectedRows = ref([])
const tableRef = ref(null)

const taskDialogVisible = ref(false)
const editingTask = ref(null)
const logDrawerVisible = ref(false)
const logTask = ref(null)

const runVisible = ref(false)
const runState = reactive({
  status: 'running',
  task: null,
  logs: [],
  records: [],
  error: '',
  duration: 0,
  httpStatus: '',
  startedAt: '',
  storage: null,
  storageTotal: 0,
  requestUrl: '',
  method: 'GET',
  iteration: null,
})

const batchVisible = ref(false)
const batchState = reactive({
  status: 'idle',
  task: null,
  total: 0,
  startIndex: 0,
  cursor: 0,
  successCount: 0,
  failedCount: 0,
  currentIndex: 0,
  currentValue: '',
  items: [],
  error: '',
  startedAt: '',
  finishedAt: '',
})
let batchCancelled = false
const batchRunning = computed(() => batchState.status === 'running')

const tabs = computed(() => [
  { key: 'all', label: '全部', count: store.tasks.length },
  { key: 'ready', label: '待采集', count: store.tasks.filter((task) => task.status === 'ready').length },
  {
    key: 'running',
    label: '采集中',
    count: store.tasks.filter((task) => task.status === 'running').length,
  },
  {
    key: 'success',
    label: '已完成',
    count: store.tasks.filter((task) => task.status === 'success').length,
  },
  { key: 'error', label: '失败', count: store.tasks.filter((task) => task.status === 'error').length },
])

const activeSites = computed(() => store.sites.filter((site) => site.enabled !== false).length)
const readyCount = computed(() => store.tasks.filter((task) => task.status === 'ready').length)
const runningCount = computed(() => store.tasks.filter((task) => task.status === 'running').length)
const hasRunningTask = computed(() => runningCount.value > 0)
const totalCollected = computed(() =>
  store.tasks.reduce((sum, task) => sum + Number(task.totalCollected || 0), 0),
)
const usedStorageCount = computed(() => {
  const ids = new Set(store.tasks.map((task) => task.storageId).filter(Boolean))
  return ids.size
})
const completedRuns = computed(() => store.runs.filter((run) => run.status !== 'running'))
const successRate = computed(() => {
  if (!completedRuns.value.length) return 0
  const success = completedRuns.value.filter((run) => run.status === 'success').length
  const rate = (success / completedRuns.value.length) * 100
  return Number.isInteger(rate) ? rate : Number(rate.toFixed(1))
})
const recentCollected = computed(() =>
  store.runs
    .filter((run) => run.status === 'success')
    .slice(0, 5)
    .reduce((sum, run) => sum + Number(run.count || 0), 0),
)
const newTaskCount = computed(() => {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  return store.tasks.filter((task) => {
    const created = new Date(String(task.createdAt).replace(' ', 'T')).getTime()
    return created >= cutoff
  }).length
})

const filteredTasks = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return store.tasks.filter((task) => {
    if (activeTab.value !== 'all' && task.status !== activeTab.value) return false
    if (siteFilter.value && task.siteId !== siteFilter.value) return false
    if (!query) return true
    const relations = taskRelations(task)
    return [task.name, task.description, relations.site?.name, relations.config?.name, relations.storage?.name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  })
})

const pagedTasks = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredTasks.value.slice(start, start + pageSize.value)
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredTasks.value.length / pageSize.value)))

watch([keyword, siteFilter, activeTab], () => {
  page.value = 1
})

watch(totalPages, (value) => {
  if (page.value > value) page.value = value
})

function toneFor(id = '') {
  const sum = String(id)
    .split('')
    .reduce((total, char) => total + char.charCodeAt(0), 0)
  return AVATAR_TONES[sum % AVATAR_TONES.length]
}

function initialOf(name = '') {
  return String(name).trim().slice(0, 1) || '采'
}

function statusOf(task) {
  return TASK_STATUS[task.status] || TASK_STATUS.ready
}

function relationsOf(task) {
  return taskRelations(task)
}

function openCreate() {
  editingTask.value = null
  taskDialogVisible.value = true
}

function openEdit(task) {
  editingTask.value = task
  taskDialogVisible.value = true
}

function openLogs(task) {
  logTask.value = task
  logDrawerVisible.value = true
}

function handleSelectionChange(rows) {
  selectedRows.value = rows
}

function clearSelection() {
  tableRef.value?.clearSelection()
  selectedRows.value = []
}

async function deleteTask(task) {
  if (task.status === 'running') {
    ElMessage.warning('任务正在采集，请等待运行结束后再删除')
    return
  }
  try {
    await ElMessageBox.confirm(
      `删除任务「${task.name}」后，其运行记录也会一并移除，此操作不可撤销。`,
      '删除采集任务',
      {
        confirmButtonText: '删除任务',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    )
    removeTask(task.id)
    ElMessage.success('采集任务已删除')
    clearSelection()
  } catch {
    // 用户取消
  }
}

async function deleteSelected() {
  if (!selectedRows.value.length) return
  if (selectedRows.value.some((task) => task.status === 'running')) {
    ElMessage.warning('选中的任务中有正在采集的任务，请稍后再试')
    return
  }
  const count = selectedRows.value.length
  try {
    await ElMessageBox.confirm(
      `将删除选中的 ${count} 个采集任务及其运行记录，此操作不可撤销。`,
      '批量删除任务',
      {
        confirmButtonText: `删除 ${count} 个任务`,
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    )
    selectedRows.value.forEach((task) => removeTask(task.id))
    selectedRows.value = []
    ElMessage.success(`已删除 ${count} 个采集任务`)
  } catch {
    // 用户取消
  }
}

async function handleTaskCommand(command, task) {
  if (command === 'edit') openEdit(task)
  if (command === 'logs') openLogs(task)
  if (command === 'traverse') await traverseTask(task)
  if (command === 'resetIteration') resetIteration(task)
  if (command === 'delete') await deleteTask(task)
}

function refreshData() {
  ElMessage.success('已同步本地工作区数据')
}

function addLog(text, type = 'info') {
  runState.logs.push({ time: formatTime(new Date()), text, type })
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function iterationStateOf(task) {
  return iterationInfoOf(task, taskRelations(task).param)
}

function resetIteration(task) {
  if (!task.iteration?.enabled) return
  task.iteration.cursor = 0
  task.updatedAt = localDateTime()
  ElMessage.success('遍历进度已重置')
}

function taskIterationInfo(task) {
  if (!task.iteration?.enabled) return null
  return iterationStateOf(task)
}

function canTraverseTask(task) {
  const info = taskIterationInfo(task)
  return Boolean(info && !info.invalid && info.remaining > 0)
}

async function collect(task, options = {}) {
  const silent = options.silent === true
  if (task.status === 'running') return { success: false, error: '任务正在运行' }
  if (batchRunning.value && !silent) {
    ElMessage.warning('列表正在遍历采集，请等待当前批次完成')
    return { success: false, error: '列表正在遍历采集' }
  }
  if (hasRunningTask.value) {
    if (!silent) ElMessage.warning('当前已有任务正在采集，请等待完成')
    return { success: false, error: '当前已有任务正在采集' }
  }

  const relations = taskRelations(task)
  if (!relations.site || !relations.config || !relations.storage) {
    if (!silent) ElMessage.error('任务关联资源不完整，请先编辑任务补全配置')
    return { success: false, error: '任务关联资源不完整' }
  }
  if (relations.site.enabled === false) {
    if (!silent) ElMessage.error('关联站点已停用，请先在采集站点中启用')
    return { success: false, error: '关联站点已停用' }
  }

  let iterationContext = null
  if (task.iteration?.enabled) {
    const info = iterationInfoOf(task, relations.param)
    if (info?.invalid) {
      if (!silent) ElMessage.error('遍历参数不存在或已被删除，请编辑任务重新选择')
      return { success: false, error: '遍历参数不存在或已被删除' }
    }
    if (!info?.total) {
      if (!silent) ElMessage.warning('遍历列表为空，请先在参数项中填写列表值')
      return { success: false, error: '遍历列表为空' }
    }
    if (info.completed) {
      if (!silent) ElMessage.warning('列表已遍历完成，请在更多操作中重置遍历进度')
      return { success: false, error: '列表已遍历完成', completed: true }
    }
    iterationContext = {
      rowId: info.rowId,
      rowKey: info.rowKey,
      index: info.cursor,
      total: info.total,
      value: info.currentValue,
    }
  }

  const pace = (ms) => (silent ? Promise.resolve() : wait(ms))
  const startedAt = localDateTime()
  const runNow = new Date()
  const method = (relations.config.method || 'GET').toUpperCase()
  const execution = normalizeExecution(relations.config)
  let requestUrl = ''
  try {
    requestUrl = resolveEndpoint(relations.site.baseUrl, relations.config.path)
    const url = new URL(requestUrl)
    resolveParamRows(relations.param, {
      now: runNow,
      iterationRowId: iterationContext?.rowId,
      iterationIndex: iterationContext?.index,
    }).forEach((row) => url.searchParams.set(row.key, row.value ?? ''))
    requestUrl = url.toString()
  } catch {
    requestUrl = ''
  }

  runState.task = task
  runState.status = 'running'
  runState.logs = []
  runState.records = []
  runState.error = ''
  runState.duration = 0
  runState.httpStatus = ''
  runState.startedAt = startedAt
  runState.storage = relations.storage
  runState.storageTotal = store.collected[task.storageId]?.total || 0
  runState.requestUrl = requestUrl
  runState.method = method
  runState.iteration = iterationContext
  if (!silent) runVisible.value = true

  task.status = 'running'
  task.lastError = ''
  task.updatedAt = startedAt

  addLog('校验采集配置与关联资源', 'step')
  await pace(160)
  addLog(
    `站点 ${relations.site.name} · 配置 ${relations.config.name} · 存储 ${relations.storage.name}`,
  )
  const headerRotation = normalizeHeaderRotation(relations.config)
  addLog(
    headerRotation.enabled && headerRotation.headerIds.length
      ? `Header 轮换 · ${headerRotation.headerIds.length} 个模板 · ${headerRotation.strategy === 'random' ? '随机' : '顺序'}`
      : `Header ${relations.header?.name || '无'} · 参数 ${relations.param?.name || '无'}`,
  )
  addLog(
    `执行策略 超时 ${execution.timeoutSeconds}s · 失败重试 ${execution.retryCount} 次 · 并发 ${execution.concurrency}`,
  )
  if (iterationContext) {
    addLog(
      `遍历参数 ${iterationContext.rowKey} · 第 ${iterationContext.index + 1}/${iterationContext.total} 项 · 当前值 ${iterationContext.value}`,
      'step',
    )
  }
  await pace(220)
  addLog(`构建请求 ${method} ${requestUrl || relations.config.path}`)
  await pace(200)
  addLog('服务端代理转发请求，等待目标站点响应…', 'step')

  try {
    const result = await collectTaskWithRetry(
      task,
      {
        iteration: iterationContext,
        now: runNow,
        timeout: execution.timeoutSeconds * 1000,
      },
      {
        retryCount: execution.retryCount,
        onRetry: (attempt, total, error) => {
          addLog(
            `请求失败：${error?.message || '未知错误'} · 第 ${attempt}/${total} 次重试`,
            'error',
          )
        },
      },
    )
    runState.httpStatus = String(result.status)
    runState.duration = result.duration
    runState.records = result.records
    addLog(`响应成功 · HTTP ${result.status} · ${result.duration}ms`, 'success')
    await pace(140)
    if (relations.config.responseType === 'html') {
      addLog(
        `解析站点页面规则 ${relations.site.pageRule?.itemSelector || ''} · ${result.pageCount || 1} 页 · 共 ${result.records.length} 条`,
        'success',
      )
    } else if (relations.config.responseType === 'web') {
      addLog(
        `提取网页片段 ${relations.config.fragmentRule?.fields?.length || 0} 个字段 · 共 ${result.records.length} 条`,
        'success',
      )
    } else if (['image', 'video'].includes(relations.config.responseType)) {
      addLog(
        `提取${relations.config.responseType === 'image' ? '图片' : '视频'}地址 · 共 ${result.records.length} 条`,
        'success',
      )
    } else if (relations.config.responseType === 'link') {
      addLog(
        `提取链接 ${relations.config.linkRule?.selector || 'a[href]'} · ${result.pageCount || 1} 页 · 共 ${result.records.length} 条`,
        'success',
      )
    } else if (relations.config.responseType === 'xhr') {
      addLog(
        `解析 XHR 响应${relations.config.dataPath ? ` ${relations.config.dataPath}` : ''} · 共 ${result.records.length} 条`,
        'success',
      )
    } else {
      addLog(
        `解析${relations.config.dataPath ? `数据路径 ${relations.config.dataPath}` : '完整响应'} · 共 ${result.records.length} 条`,
        'success',
      )
    }

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
        if (storageFilePath) {
          addLog(`已写入本地文件 ${storageFilePath}`, 'success')
        }
      } catch (fileError) {
        addLog(`本地文件写入失败：${fileError?.message || '未知错误'}`, 'info')
      }
    }

    if (relations.storage.type === 'html_folder') {
      if (['html', 'web', 'link'].includes(relations.config.responseType)) {
        try {
          const saved = await writeHtmlFolder(relations.storage, result.pages || [])
          storageFilePath = saved?.manifest || storageFilePath
          addLog(
            `已保存 ${saved?.files?.length || 0} 个 HTML 页面到 ${saved?.folder || relations.storage.target}`,
            'success',
          )
        } catch (folderError) {
          addLog(`HTML 文件夹写入失败：${folderError?.message || '未知错误'}`, 'info')
        }
      } else {
        addLog('HTML 文件夹存储需要 HTML、网页片段或链接采集配置，本次未写入文件', 'info')
      }
    }

    if (['image_folder', 'video_folder'].includes(relations.storage.type)) {
      const expectedType =
        relations.storage.type === 'image_folder' ? 'image' : 'video'
      if (
        relations.config.responseType === expectedType &&
        relations.config.media?.collectResource === false
      ) {
        addLog('配置已关闭资源采集，本次仅保存媒体地址，不下载文件', 'info')
      } else if (relations.config.responseType === expectedType) {
        try {
          const saved = await writeMediaFolder(
            relations.storage,
            result.records,
            execution.concurrency,
          )
          storageFilePath = saved?.manifest || storageFilePath
          addLog(
            `已下载 ${saved?.files?.length || 0} 个${expectedType === 'image' ? '图片' : '视频'}到 ${saved?.folder || relations.storage.target}`,
            'success',
          )
          if (saved?.errors?.length) {
            addLog(`另有 ${saved.errors.length} 个媒体文件下载失败`, 'info')
          }
          if (saved?.limited) addLog('媒体下载已限制为前 50 个文件', 'info')
        } catch (folderError) {
          addLog(`媒体文件夹写入失败：${folderError?.message || '未知错误'}`, 'info')
        }
      } else {
        addLog(
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

    runState.storageTotal = store.collected[task.storageId]?.total || 0
    runState.status = 'success'
    addLog(`已归档到 ${relations.storage.name}，累计 ${runState.storageTotal} 条`, 'success')

    if (iterationContext && task.iteration) {
      task.iteration.cursor = Math.min(
        iterationContext.index + 1,
        iterationContext.total,
      )
      const finished = task.iteration.cursor >= iterationContext.total
      addLog(
        finished
          ? `列表遍历已完成 · ${iterationContext.total}/${iterationContext.total}`
          : `遍历进度推进至 ${task.iteration.cursor}/${iterationContext.total}`,
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
      message: '采集完成',
      preview: result.records.slice(0, 3),
      method,
      requestUrl,
      httpStatus: String(result.status),
      pageCount: result.pageCount || 1,
      iteration: iterationContext,
      filePath: storageFilePath,
      error: '',
      logs: runState.logs.map((log) => ({ ...log })),
    })

    const iterationNote = iterationContext
      ? ` · 遍历 ${iterationContext.index + 1}/${iterationContext.total}`
      : ''
    if (!silent) {
      ElMessage.success(`采集完成，共获得 ${result.records.length} 条记录${iterationNote}`)
    }
    return {
      success: true,
      count: result.records.length,
      duration: result.duration,
      startedAt,
      iteration: iterationContext,
    }
  } catch (error) {
    const message = error?.message || '未知错误，请检查采集配置'
    runState.status = 'error'
    runState.error = message
    runState.duration = 0
    task.status = 'error'
    task.updatedAt = localDateTime()
    task.lastRunAt = localDateTime()
    task.lastDuration = 0
    task.lastCount = 0
    task.lastError = message
    addLog(message, 'error')
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
      httpStatus: runState.httpStatus,
      pageCount: 0,
      iteration: iterationContext,
      error: message,
      logs: runState.logs.map((log) => ({ ...log })),
    })
    if (!silent) ElMessage.error('采集失败，请查看运行日志')
    return {
      success: false,
      error: message,
      startedAt,
      iteration: iterationContext,
    }
  } finally {
    nextTick(() => tableRef.value?.clearSelection())
  }
}

function stopBatch() {
  if (!batchRunning.value) return
  batchCancelled = true
  ElMessage.info('将在当前项执行完成后停止遍历')
}

async function traverseTask(task) {
  if (batchRunning.value) return
  if (hasRunningTask.value) {
    ElMessage.warning('当前已有任务正在采集，请等待完成')
    return
  }
  const relations = taskRelations(task)
  const info = iterationInfoOf(task, relations.param)
  if (!task.iteration?.enabled || !info || info.invalid) {
    ElMessage.error('遍历参数不存在，请先在任务中配置列表遍历')
    return
  }
  if (!info.total) {
    ElMessage.warning('遍历列表为空，请先在参数项中填写列表值')
    return
  }
  if (info.remaining <= 0) {
    ElMessage.warning('列表已遍历完成，请先重置遍历进度')
    return
  }

  batchCancelled = false
  Object.assign(batchState, {
    status: 'running',
    task,
    total: info.total,
    startIndex: info.cursor,
    cursor: info.cursor,
    successCount: 0,
    failedCount: 0,
    currentIndex: info.cursor,
    currentValue: info.currentValue,
    items: [],
    error: '',
    startedAt: localDateTime(),
    finishedAt: '',
  })
  batchVisible.value = true

  try {
    while (!batchCancelled) {
      const current = iterationInfoOf(task, taskRelations(task).param)
      if (!current || current.invalid || current.completed) break
      batchState.currentIndex = current.cursor
      batchState.currentValue = current.currentValue
      batchState.cursor = current.cursor
      const result = await collect(task, { silent: true })
      if (!result?.success) {
        batchState.failedCount += 1
        batchState.items.push({
          index: current.cursor,
          value: current.currentValue,
          status: 'error',
          count: 0,
          duration: 0,
          error: result?.error || '采集失败',
          startedAt: result?.startedAt || localDateTime(),
        })
        batchState.items = batchState.items.slice(-100)
        batchState.status = 'error'
        batchState.error = result?.error || '采集失败'
        break
      }
      batchState.successCount += 1
      batchState.items.push({
        index: current.cursor,
        value: current.currentValue,
        status: 'success',
        count: result.count,
        duration: result.duration,
        error: '',
        startedAt: result.startedAt || localDateTime(),
      })
      batchState.items = batchState.items.slice(-100)
      batchState.cursor = task.iteration?.cursor ?? current.cursor + 1
      batchState.currentValue = ''
      await wait(160)
    }

    if (batchState.status === 'running') {
      batchState.status = batchCancelled ? 'stopped' : 'success'
    }
    batchState.finishedAt = localDateTime()
    if (batchState.status === 'success') {
      ElMessage.success(`遍历完成，共成功 ${batchState.successCount} 项`)
    } else if (batchState.status === 'stopped') {
      ElMessage.info('遍历已停止，进度已保留')
    }
  } catch (error) {
    batchState.status = 'error'
    batchState.error = error?.message || '遍历执行失败'
    ElMessage.error('遍历采集异常终止')
  }
}

function clearFilters() {
  keyword.value = ''
  siteFilter.value = ''
  activeTab.value = 'all'
}
</script>

<template>
  <div class="collection-page">
    <PageHeader
      eyebrow="COLLECTION LIST"
      title="采集列表"
      description="编排采集任务，关联站点资源，一键运行并查看采集结果。工作区保存在服务端 SQLite，采集结果写入配置的存储目标。"
    >
      <template #actions>
        <el-button class="refresh-button" title="刷新数据" @click="refreshData">
          <el-icon><Refresh /></el-icon>
        </el-button>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建采集任务
        </el-button>
      </template>
    </PageHeader>

    <div class="stats-grid">
      <StatCard
        label="采集任务"
        :value="store.tasks.length"
        unit="个"
        :trend="newTaskCount ? `+${newTaskCount}` : ''"
        :hint="`近 7 天新增 · ${activeSites} 个站点已接入`"
        :icon="Collection"
        tone="indigo"
      />
      <StatCard
        label="正在采集"
        :value="runningCount"
        unit="个"
        :trend="runningCount ? 'LIVE' : ''"
        :hint="`${readyCount} 个任务待采集`"
        :icon="VideoPlay"
        tone="amber"
      />
      <StatCard
        label="累计归档"
        :value="formatNumber(totalCollected)"
        unit="条"
        :trend="recentCollected ? `+${formatNumber(recentCollected)}` : ''"
        :hint="`来自 ${usedStorageCount} 个关联存储`"
        :icon="DataAnalysis"
        tone="teal"
      />
      <StatCard
        label="采集成功率"
        :value="successRate"
        unit="%"
        :trend="completedRuns.length ? '稳定' : ''"
        :muted="true"
        :hint="completedRuns.length ? `基于最近 ${completedRuns.length} 次运行` : '暂无运行记录'"
        :icon="CircleCheck"
        tone="green"
      />
    </div>

    <section class="data-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>任务总览</h2>
          <p>组合站点、配置、请求头与参数，快速发起一次采集</p>
        </div>
        <div class="toolbar-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            class="tab-btn"
            :class="{ 'is-active': activeTab === tab.key }"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
            <span class="tab-count">{{ tab.count }}</span>
          </button>
        </div>
      </div>

      <div class="toolbar-filters">
        <el-input
          v-model="keyword"
          class="filter-search"
          clearable
          placeholder="搜索任务、站点、配置或存储"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select
          v-model="siteFilter"
          class="filter-select"
          clearable
          placeholder="全部站点"
        >
          <el-option v-for="site in store.sites" :key="site.id" :label="site.name" :value="site.id" />
        </el-select>
        <div class="filter-spacer" />
        <span class="filter-result">筛选结果 <strong>{{ filteredTasks.length }}</strong> 条</span>
      </div>

      <div v-if="selectedRows.length" class="bulk-bar">
        <span>已选择 <strong>{{ selectedRows.length }}</strong> 个任务</span>
        <span class="bulk-spacer" />
        <button class="bulk-action" type="button" @click="deleteSelected">删除选中</button>
        <button class="bulk-action bulk-cancel" type="button" @click="clearSelection">取消选择</button>
      </div>

      <div class="table-wrap desktop-table">
        <el-table
          ref="tableRef"
          :data="pagedTasks"
          class="cf-table"
          table-layout="fixed"
          :row-class-name="({ row }) => (row.status === 'running' ? 'is-running-row' : '')"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="43" />
          <el-table-column label="采集任务" min-width="176">
            <template #default="{ row }">
              <div class="entity-cell">
                <div class="entity-avatar" :class="toneFor(row.id)">{{ initialOf(row.name) }}</div>
                <div class="entity-copy">
                  <button class="entity-name is-link entity-name-button" type="button" @click="openEdit(row)">
                    {{ row.name }}
                  </button>
                  <span class="entity-sub">
                    <span class="mono-text">#{{ row.id.slice(-4).toUpperCase() }}</span>
                    <i class="dot" />
                    <span>{{ fromNow(row.updatedAt) }}更新</span>
                  </span>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="采集站点" width="126">
            <template #default="{ row }">
              <div class="stack">
                <div class="entity-name">{{ relationsOf(row).site?.name || '站点已删除' }}</div>
                <div class="entity-sub">
                  <span>{{ hostOf(relationsOf(row).site?.baseUrl) }}</span>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="采集配置" width="156">
            <template #default="{ row }">
              <div class="stack">
                <div class="stack-line">
                  <span
                    class="method-badge"
                    :class="{ 'is-post': !['GET', 'HEAD'].includes(relationsOf(row).config?.method || 'GET') }"
                  >
                    {{ relationsOf(row).config?.method || 'GET' }}
                  </span>
                  <span class="nowrap">{{ relationsOf(row).config?.name || '配置已删除' }}</span>
                </div>
                <span class="code-text">{{ relationsOf(row).config?.path || '—' }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="请求头 / 参数" min-width="164">
            <template #default="{ row }">
              <div class="stack">
                <div class="stack-line">
                  <el-icon><Document /></el-icon>
                  <span :title="relationsOf(row).header?.name">
                    {{ relationsOf(row).header?.name || '无 Header' }}
                  </span>
                </div>
                <div class="stack-line">
                  <el-icon><Operation /></el-icon>
                  <span :title="relationsOf(row).param?.name">
                    {{ relationsOf(row).param?.name || '无参数' }}
                  </span>
                </div>
                <div
                  v-if="row.iteration?.enabled"
                  class="stack-line iteration-line"
                  :title="
                    taskIterationInfo(row)?.invalid
                      ? '遍历参数已失效'
                      : `遍历 ${taskIterationInfo(row)?.rowKey} ${taskIterationInfo(row)?.cursor}/${taskIterationInfo(row)?.total}`
                  "
                >
                  <el-icon><Refresh /></el-icon>
                  <span v-if="taskIterationInfo(row)?.invalid">遍历参数已失效</span>
                  <span v-else-if="taskIterationInfo(row)?.completed">
                    遍历完成 {{ taskIterationInfo(row)?.total }}/{{ taskIterationInfo(row)?.total }}
                  </span>
                  <span v-else>
                    遍历 {{ taskIterationInfo(row)?.rowKey }} ·
                    {{ taskIterationInfo(row)?.cursor }}/{{ taskIterationInfo(row)?.total }}
                  </span>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="关联存储" width="126">
            <template #default="{ row }">
              <div class="storage-cell">
                <span
                  class="storage-type-icon"
                  :class="`type-${relationsOf(row).storage?.type || 'json'}`"
                >
                  {{ (relationsOf(row).storage?.type || 'json').toUpperCase() }}
                </span>
                <div class="storage-cell-copy">
                  <strong :title="relationsOf(row).storage?.name">
                    {{ relationsOf(row).storage?.name || '存储已删除' }}
                  </strong>
                  <span>{{ relationsOf(row).storage?.target || '—' }}</span>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="采集时间" width="132">
            <template #default="{ row }">
              <div class="stack">
                <span class="mono-text nowrap" style="color: #4f5564">
                  {{ formatDateTime(row.collectAt) }}
                </span>
                <span class="entity-sub">
                  {{ row.lastRunAt ? `上次 ${fromNow(row.lastRunAt)}` : fromNow(row.collectAt) }}
                </span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="状态" width="84">
            <template #default="{ row }">
              <StatusBadge :label="statusOf(row).label" :tone="statusOf(row).tone" />
            </template>
          </el-table-column>

          <el-table-column label="操作" width="118" fixed="right">
            <template #default="{ row }">
              <div class="action-cluster">
                <el-button
                  class="collect-button"
                  :loading="row.status === 'running'"
                  :disabled="row.status === 'running' || batchRunning || (hasRunningTask && row.status !== 'running')"
                  @click="collect(row)"
                >
                  <el-icon v-if="row.status !== 'running'"><VideoPlay /></el-icon>
                  {{ row.status === 'running' ? '采集中' : '采集' }}
                </el-button>
                <el-dropdown
                  trigger="click"
                  placement="bottom-end"
                  @command="(command) => handleTaskCommand(command, row)"
                >
                  <button class="row-action" type="button" title="更多操作">
                    <el-icon><MoreFilled /></el-icon>
                  </button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="edit">
                        <el-icon><EditPen /></el-icon>
                        编辑任务
                      </el-dropdown-item>
                      <el-dropdown-item command="logs">
                        <el-icon><Document /></el-icon>
                        日志查看
                      </el-dropdown-item>
                      <el-dropdown-item
                        v-if="row.iteration?.enabled"
                        command="traverse"
                        :disabled="!canTraverseTask(row) || hasRunningTask || batchRunning"
                      >
                        <el-icon><Refresh /></el-icon>
                        遍历剩余列表
                      </el-dropdown-item>
                      <el-dropdown-item
                        v-if="row.iteration?.enabled"
                        command="resetIteration"
                        :disabled="batchRunning || row.status === 'running'"
                      >
                        <el-icon><RefreshLeft /></el-icon>
                        重置遍历进度
                      </el-dropdown-item>
                      <el-dropdown-item command="delete" divided class="dropdown-danger">
                        <el-icon><Delete /></el-icon>
                        删除任务
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>
          </el-table-column>

          <template #empty>
            <EmptyState
              :icon="Collection"
              :title="store.tasks.length ? '没有匹配的采集任务' : '还没有采集任务'"
              :description="
                store.tasks.length
                  ? '试试切换状态筛选，或调整搜索关键词。'
                  : '创建第一条采集任务，把站点、配置与存储组合起来。'
              "
            >
              <el-button v-if="store.tasks.length" @click="clearFilters">清除筛选</el-button>
              <el-button v-else type="primary" @click="openCreate">
                <el-icon><Plus /></el-icon>
                新建采集任务
              </el-button>
            </EmptyState>
          </template>
        </el-table>
      </div>

      <div class="mobile-list">
        <EmptyState
          v-if="!pagedTasks.length"
          :icon="Collection"
          :title="store.tasks.length ? '没有匹配的采集任务' : '还没有采集任务'"
          :description="
            store.tasks.length
              ? '试试切换状态筛选，或调整搜索关键词。'
              : '创建第一条采集任务，把站点、配置与存储组合起来。'
          "
        >
          <el-button v-if="store.tasks.length" @click="clearFilters">清除筛选</el-button>
          <el-button v-else type="primary" @click="openCreate">
            <el-icon><Plus /></el-icon>
            新建采集任务
          </el-button>
        </EmptyState>

        <template v-else>
        <article v-for="task in pagedTasks" :key="task.id" class="mobile-card">
          <div class="mobile-card-head">
            <div class="entity-avatar" :class="toneFor(task.id)">{{ initialOf(task.name) }}</div>
            <div class="entity-copy">
              <button class="entity-name is-link entity-name-button" type="button" @click="openEdit(task)">
                {{ task.name }}
              </button>
              <span class="entity-sub">
                <span class="mono-text">#{{ task.id.slice(-4).toUpperCase() }}</span>
                <i class="dot" />
                <span>{{ fromNow(task.updatedAt) }}更新</span>
              </span>
            </div>
            <StatusBadge :label="statusOf(task).label" :tone="statusOf(task).tone" />
          </div>

          <div class="mobile-card-meta">
            <span class="soft-chip">
              <el-icon><Link /></el-icon>
              {{ relationsOf(task).site?.name || '站点已删除' }}
            </span>
            <span class="soft-chip">
              <el-icon><SetUp /></el-icon>
              {{ relationsOf(task).config?.name || '配置已删除' }}
            </span>
            <span class="soft-chip">
              <el-icon><Document /></el-icon>
              {{ relationsOf(task).header?.name || '无 Header' }}
            </span>
            <span class="soft-chip">
              <el-icon><Operation /></el-icon>
              {{ relationsOf(task).param?.name || '无参数' }}
            </span>
            <span class="soft-chip is-accent">
              <el-icon><Files /></el-icon>
              {{ relationsOf(task).storage?.name || '存储已删除' }}
            </span>
            <span
              v-if="task.iteration?.enabled && taskIterationInfo(task)"
              class="soft-chip is-accent"
            >
              <el-icon><Refresh /></el-icon>
              <template v-if="taskIterationInfo(task)?.completed">
                遍历完成 {{ taskIterationInfo(task)?.total }}/{{ taskIterationInfo(task)?.total }}
              </template>
              <template v-else>
                遍历 {{ taskIterationInfo(task)?.rowKey }} ·
                {{ taskIterationInfo(task)?.cursor }}/{{ taskIterationInfo(task)?.total }}
              </template>
            </span>
          </div>

          <div class="mobile-info-row">
            <span>采集时间</span>
            <strong class="mono-text">{{ formatDateTime(task.collectAt) }}</strong>
          </div>
          <div class="mobile-info-row">
            <span>上次运行</span>
            <strong>{{ task.lastRunAt ? fromNow(task.lastRunAt) : '尚未运行' }}</strong>
          </div>

          <div class="mobile-card-footer">
            <span class="entity-sub">
              {{ task.lastCount ? `上次 ${formatNumber(task.lastCount)} 条` : fromNow(task.collectAt) }}
            </span>
            <div class="mobile-card-actions">
              <el-button
                class="collect-button"
                :loading="task.status === 'running'"
                :disabled="task.status === 'running' || batchRunning || (hasRunningTask && task.status !== 'running')"
                @click="collect(task)"
              >
                <el-icon v-if="task.status !== 'running'"><VideoPlay /></el-icon>
                {{ task.status === 'running' ? '采集中' : '采集' }}
              </el-button>
              <button class="row-action" type="button" title="编辑任务" @click="openEdit(task)">
                <el-icon><EditPen /></el-icon>
              </button>
              <button class="row-action" type="button" title="日志查看" @click="openLogs(task)">
                <el-icon><Document /></el-icon>
              </button>
              <button class="row-action is-danger" type="button" title="删除任务" @click="deleteTask(task)">
                <el-icon><Delete /></el-icon>
              </button>
            </div>
          </div>
        </article>
        </template>
      </div>

      <div class="table-footer">
        <span class="footer-summary">
          共 <strong>{{ filteredTasks.length }}</strong> 条记录
          <template v-if="filteredTasks.length">· 第 {{ page }} / {{ totalPages }} 页</template>
        </span>
        <div class="pagination-wrap">
          <el-pagination
            v-model:current-page="page"
            :page-size="pageSize"
            :total="filteredTasks.length"
            layout="prev, pager, next"
            background
            hide-on-single-page
          />
        </div>
      </div>
    </section>

    <TaskDialog v-model="taskDialogVisible" :task="editingTask" />
    <TaskRunDrawer v-model="runVisible" :state="runState" />
    <TaskLogDrawer v-model="logDrawerVisible" :task="logTask" />
    <BatchRunDrawer v-model="batchVisible" :state="batchState" @stop="stopBatch" />
  </div>
</template>

