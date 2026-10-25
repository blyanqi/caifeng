<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Check,
  CircleCheck,
  Connection,
  Document,
  Files,
  InfoFilled,
  Key,
  Link,
  Loading,
  MagicStick,
  Operation,
  SetUp,
  WarningFilled,
} from '@element-plus/icons-vue'
import {
  LLM_PRESETS,
  canUseLlm,
  loadLlmSettings,
  normalizeImportPlan,
  requestPlanWithLlm,
  saveLlmSettings,
  testLlmConnection,
} from '../utils/llmImport'
import { parseCurl } from '../utils/curlParser'
import {
  createConfig,
  createHeader,
  createParam,
  createProxy,
  createSite,
  createStorage,
  createTask,
  store,
  updateConfig,
  updateHeader,
  updateParam,
  updateProxy,
  updateSite,
  updateStorage,
  updateTask,
} from '../stores/collector'
import { formatDateTime } from '../utils/format'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'imported'])

const router = useRouter()
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const step = ref('input')
const curlText = ref('')
const responseSample = ref('')
const showSample = ref(false)
const showSettings = ref(false)
const parsing = ref(false)
const parseError = ref('')
const engine = ref('')
const plan = ref(null)
const conflictStrategy = ref('new')
const selectedModules = reactive({})
const MODULE_KEYS = ['site', 'config', 'header', 'param', 'proxy', 'storage', 'task']
const TASK_REQUIRED_MODULES = ['site', 'config', 'storage']
const settings = reactive(loadLlmSettings())
const modelTest = reactive({
  status: 'idle',
  message: '',
  duration: 0,
  detail: '',
})

const currentPreset = computed(
  () =>
    LLM_PRESETS.find(
      (preset) =>
        preset.baseUrl === settings.baseUrl.trim() && preset.model === settings.model.trim(),
    )?.key || '',
)

const llmReady = computed(() => canUseLlm(settings))
const modelTesting = computed(() => modelTest.status === 'running')
const engineLabel = computed(() => {
  if (llmReady.value) {
    const preset = LLM_PRESETS.find((item) => item.key === currentPreset.value)
    return preset ? `AI 解析 · ${preset.label}` : 'AI 解析 · 自定义模型'
  }
  return '本地规则解析'
})

const warnings = computed(() => plan.value?.warnings || [])

function normalizeBase(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase()
}

function normalizePath(value) {
  let path = String(value || '').trim() || '/'
  if (!path.startsWith('/')) path = `/${path}`
  return path.replace(/\/+$/, '') || '/'
}

function findConflicts(value) {
  if (!value) return []
  const conflicts = []
  const site = store.sites.find(
    (item) => normalizeBase(item.baseUrl) === normalizeBase(value.site.baseUrl),
  )
  if (site) {
    conflicts.push({
      type: 'site',
      label: '采集站点',
      existing: site.name,
      candidate: value.site.name,
      existingId: site.id,
    })
  }
  const config = store.configs.find(
    (item) =>
      String(item.method || 'GET').toUpperCase() === value.config.method &&
      normalizePath(item.path) === normalizePath(value.config.path),
  )
  if (config) {
    conflicts.push({
      type: 'config',
      label: '采集配置',
      existing: config.name,
      candidate: value.config.name,
      existingId: config.id,
    })
  }
  if (value.header) {
    const header = store.headers.find(
      (item) => item.name.trim().toLowerCase() === value.header.name.trim().toLowerCase(),
    )
    if (header) {
      conflicts.push({
        type: 'header',
        label: 'Header',
        existing: header.name,
        candidate: value.header.name,
        existingId: header.id,
      })
    }
  }
  if (value.param) {
    const param = store.params.find(
      (item) => item.name.trim().toLowerCase() === value.param.name.trim().toLowerCase(),
    )
    if (param) {
      conflicts.push({
        type: 'param',
        label: '参数项',
        existing: param.name,
        candidate: value.param.name,
        existingId: param.id,
      })
    }
  }
  if (value.proxy) {
    const proxy = store.proxies.find(
      (item) =>
        item.protocol === value.proxy.protocol &&
        item.host.trim().toLowerCase() === value.proxy.host.trim().toLowerCase() &&
        Number(item.port) === Number(value.proxy.port),
    )
    if (proxy) {
      conflicts.push({
        type: 'proxy',
        label: '代理',
        existing: proxy.name,
        candidate: value.proxy.name,
        existingId: proxy.id,
      })
    }
  }
  const storage = store.storages.find(
    (item) => item.target.trim() === value.storage.target.trim(),
  )
  if (storage) {
    conflicts.push({
      type: 'storage',
      label: '存储',
      existing: storage.name,
      candidate: value.storage.name,
      existingId: storage.id,
    })
  }
  const task = store.tasks.find((item) => item.name.trim() === value.task.name.trim())
  if (task) {
    conflicts.push({
      type: 'task',
      label: '采集任务',
      existing: task.name,
      candidate: value.task.name,
      existingId: task.id,
    })
  }
  return conflicts
}

const allConflicts = computed(() => findConflicts(plan.value))
const conflicts = computed(() =>
  allConflicts.value.filter((item) => selectedModules[item.type]),
)
const conflictTypes = computed(() => new Set(conflicts.value.map((item) => item.type)))
const conflictSummary = computed(() =>
  conflicts.value.map((item) => `${item.label}「${item.existing}」`).join('、'),
)

const importCount = computed(() => {
  if (!plan.value) return 0
  return MODULE_KEYS.filter((key) => plan.value[key] && selectedModules[key]).length
})

const importButtonLabel = computed(() => {
  if (!importCount.value) return '请选择保存模块'
  if (!conflicts.value.length) {
    return isModuleSelected('task') ? '导入选中模块并创建任务' : '保存选中模块'
  }
  return conflictStrategy.value === 'overwrite'
    ? '覆盖并导入选中模块'
    : '新建副本并导入选中模块'
})

function storageTypeLabel(type) {
  return (
    {
      json: 'JSON 文件',
      csv: 'CSV 文件',
      image_folder: '图片文件夹',
      video_folder: '视频文件夹',
      html_folder: 'HTML 文件夹',
      db: '数据库',
    }[type] || type
  )
}

function paginationSummary(config) {
  if (!config?.pagination || config.pagination.mode === 'none') return ''
  return ` · ${config.pagination.maxPages} 页翻页`
}

function configSummary(config) {
  if (!config) return '—'
  if (config.responseType === 'html') return 'HTML · 站点页面规则'
  if (config.responseType === 'web') {
    const count = (config.fragmentRule?.fields || []).filter(
      (field) => field.enabled !== false && field.key?.trim(),
    ).length
    return `网页片段 · ${count} 个字段${paginationSummary(config)}`
  }
  if (config.responseType === 'image') {
    return `图片 · ${config.media?.collectResource === false ? '仅地址' : '下载资源'} · 最多 ${config.media?.maxItems || 200} 条${paginationSummary(config)}`
  }
  if (config.responseType === 'video') {
    return `视频 · ${config.media?.collectResource === false ? '仅地址' : '下载资源'} · 最多 ${config.media?.maxItems || 200} 条${paginationSummary(config)}`
  }
  if (config.responseType === 'link') {
    return `链接 · ${config.linkRule?.maxItems || 500} 条${paginationSummary(config)}`
  }
  if (config.responseType === 'xhr') {
    return `XHR${config.dataPath ? ` · ${config.dataPath}` : ' · 完整响应'}`
  }
  if (config.responseType === 'jsonp') {
    return `JSONP${config.dataPath ? ` · ${config.dataPath}` : ' · 完整响应'}`
  }
  if (config.responseType === 'text') return '纯文本 · 全文记录'
  return `JSON${config.dataPath ? ` · ${config.dataPath}` : ' · 完整响应'}`
}

const sectionCards = computed(() => {
  if (!plan.value) return []
  const p = plan.value
  const cards = [
    {
      key: 'site',
      label: '采集站点',
      icon: Link,
      tone: 'indigo',
      title: p.site.name,
      lines: [p.site.baseUrl, p.site.description],
      selectable: true,
    },
    {
      key: 'config',
      label: '采集配置',
      icon: SetUp,
      tone: 'teal',
      title: p.config.name,
      lines: [
        `${p.config.method} ${p.config.path}`,
        `${configSummary(p.config)}${p.config.body ? ' · 含请求体' : ''}`,
      ],
      selectable: true,
    },
    {
      key: 'storage',
      label: '关联存储',
      icon: Files,
      tone: 'amber',
      title: p.storage.name,
      lines: [`${storageTypeLabel(p.storage.type)} · ${p.storage.target}`, p.storage.description],
      selectable: true,
    },
    {
      key: 'task',
      label: '采集任务',
      icon: MagicStick,
      tone: 'rose',
      title: p.task.name,
      lines: [formatDateTime(p.task.collectAt), p.task.description],
      selectable: true,
    },
  ]
  if (p.header) {
    cards.splice(2, 0, {
      key: 'header',
      label: '采集 Header',
      icon: Document,
      tone: 'cyan',
      title: p.header.name,
      lines: [
        `${p.header.rows.length} 个请求头字段`,
        p.header.rows
          .slice(0, 3)
          .map((row) => row.key)
          .join(' · '),
      ],
      selectable: true,
    })
  }
  if (p.param) {
    cards.splice(3, 0, {
      key: 'param',
      label: '采集参数项',
      icon: Operation,
      tone: 'slate',
      title: p.param.name,
      lines: [
        `${p.param.rows.length} 个查询参数`,
        p.param.rows
          .slice(0, 3)
          .map((row) => `${row.key}=${row.value}`)
          .join(' · '),
      ],
      selectable: true,
    })
  }
  if (p.proxy) {
    cards.push({
      key: 'proxy',
      label: '代理配置',
      icon: Connection,
      tone: 'amber',
      title: p.proxy.name,
      lines: [
        `${p.proxy.protocol.toUpperCase()} · ${p.proxy.host}:${p.proxy.port}`,
        '仅保存，出口代理尚未接入服务端转发',
      ],
      selectable: true,
    })
  }
  if (p.pageRule) {
    cards.splice(1, 0, {
      key: 'pageRule',
      label: '页面规则',
      icon: SetUp,
      tone: 'teal',
      title: `${p.pageRule.itemSelector} · ${p.pageRule.fields.length} 个字段${
        p.pageRule.crawl?.enabled ? ` · ${1 + p.pageRule.crawl.levels.length} 级` : ''
      }`,
      lines: [
        `列表页 ${p.pageRule.listPath}`,
        p.pageRule.crawl?.enabled
          ? `多级采集 · 详情页 ${p.pageRule.crawl.levels.map((level) => level.name).join(' → ')}`
          : p.pageRule.pagination.mode === 'none'
            ? '单页采集'
            : `分页 ${p.pageRule.pagination.mode} · 最多 ${p.pageRule.pagination.maxPages} 页`,
      ],
      selectable: false,
    })
  }
  return cards
})

const selectableCards = computed(() => sectionCards.value.filter((card) => card.selectable))
const allModulesSelected = computed(
  () =>
    selectableCards.value.length > 0 &&
    selectableCards.value.every((card) => isModuleSelected(card.key)),
)
const importSummaryText = computed(() => {
  if (!importCount.value) return '请选择至少一个模块后再导入。'
  if (!isModuleSelected('task')) {
    return '未选择采集任务，只保存勾选的资源模块，不会创建可执行任务。'
  }
  if (conflicts.value.length) {
    return conflictStrategy.value === 'overwrite'
      ? '将覆盖选中的重复配置，并保留其余选中的配置继续创建。'
      : '将保留现有数据，并为选中的重复项创建新的副本。'
  }
  return '采集任务会自动关联本次勾选的站点、配置和存储，Header 与参数可选。'
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    step.value = 'input'
    plan.value = null
    parseError.value = ''
    engine.value = ''
    parsing.value = false
    curlText.value = ''
    responseSample.value = ''
    showSample.value = false
    showSettings.value = false
    resetParseResult()
    Object.assign(settings, loadLlmSettings())
    resetModelTest()
  },
)

function resetParseResult() {
  parseError.value = ''
  plan.value = null
  conflictStrategy.value = 'new'
  MODULE_KEYS.forEach((key) => {
    selectedModules[key] = false
  })
}

function initModuleSelection(value) {
  MODULE_KEYS.forEach((key) => {
    selectedModules[key] = Boolean(value?.[key])
  })
}

function isModuleSelected(key) {
  return Boolean(selectedModules[key])
}

function selectAllModules() {
  MODULE_KEYS.forEach((key) => {
    if (plan.value?.[key]) selectedModules[key] = true
  })
}

function clearModules() {
  MODULE_KEYS.forEach((key) => {
    selectedModules[key] = false
  })
}

function toggleModule(key) {
  const wasSelected = isModuleSelected(key)
  if (key === 'task') {
    selectedModules.task = !wasSelected
    if (!wasSelected) {
      TASK_REQUIRED_MODULES.forEach((requiredKey) => {
        if (plan.value?.[requiredKey]) selectedModules[requiredKey] = true
      })
    }
    return
  }

  selectedModules[key] = !wasSelected
  if (
    wasSelected &&
    TASK_REQUIRED_MODULES.includes(key) &&
    isModuleSelected('task')
  ) {
    selectedModules.task = false
    ElMessage.info('采集任务依赖站点、配置和存储，已同时取消任务')
  }
}

function activateCard(card) {
  if (card.selectable) toggleModule(card.key)
}

function resetModelTest() {
  Object.assign(modelTest, { status: 'idle', message: '', duration: 0, detail: '' })
}

function applyPreset(preset) {
  settings.baseUrl = preset.baseUrl
  settings.model = preset.model
  resetModelTest()
}

function persistSettings() {
  if (!settings.baseUrl.trim() || !settings.model.trim()) {
    ElMessage.warning('请填写 Base URL 与模型名称')
    return
  }
  saveLlmSettings(settings)
  ElMessage.success('模型连接设置已保存')
  showSettings.value = false
}

async function testModel() {
  if (!settings.baseUrl.trim() || !settings.model.trim()) {
    ElMessage.warning('请先填写 Base URL 与模型名称')
    return
  }
  if (!llmReady.value) {
    ElMessage.warning('请填写 API Key 后再测试云端模型')
    return
  }
  modelTest.status = 'running'
  modelTest.message = '正在请求模型…'
  modelTest.duration = 0
  modelTest.detail = ''
  try {
    const result = await testLlmConnection(settings)
    Object.assign(modelTest, {
      status: 'success',
      message: `连接成功 · ${result.duration}ms`,
      duration: result.duration,
      detail: `${result.model}${result.message ? ` · ${result.message.slice(0, 80)}` : ''}`,
    })
    ElMessage.success('模型连接测试通过')
  } catch (error) {
    Object.assign(modelTest, {
      status: 'error',
      message: '模型连接失败',
      duration: 0,
      detail: error?.message || '未知错误',
    })
  }
}

async function startParse() {
  const curl = curlText.value.trim()
  if (!curl) {
    parseError.value = '请先粘贴 cURL 命令或完整请求地址'
    return
  }
  resetParseResult()
  parsing.value = true

  let fallback = null
  try {
    fallback = parseCurl(curl, responseSample.value)
  } catch (error) {
    if (!llmReady.value) {
      parseError.value = error.message || '无法解析 cURL'
      parsing.value = false
      return
    }
  }

  try {
    if (llmReady.value) {
      engine.value = 'llm'
      saveLlmSettings(settings)
      const raw = await requestPlanWithLlm({
        curlText: curl,
        responseSample: responseSample.value,
        settings,
      })
      const normalized = normalizeImportPlan(raw, fallback)
      normalized.source = 'llm'
      plan.value = normalized
    } else {
      engine.value = 'local'
      await new Promise((resolve) => setTimeout(resolve, 260))
      if (!fallback) throw new Error('无法解析这段 cURL，请检查命令是否完整')
      plan.value = {
        ...normalizeImportPlan(fallback, fallback),
        source: 'local',
        warnings: fallback.warnings || [],
      }
    }
    if (!plan.value.site.baseUrl) {
      throw new Error('没有识别到有效的站点地址')
    }
    conflictStrategy.value = 'new'
    initModuleSelection(plan.value)
    step.value = 'preview'
  } catch (error) {
    parseError.value = error?.message || '解析失败，请检查 cURL 或模型设置'
  } finally {
    parsing.value = false
  }
}

function useLocalParse() {
  try {
    const fallback = parseCurl(curlText.value, responseSample.value)
    engine.value = 'local'
    plan.value = {
      ...normalizeImportPlan(fallback, fallback),
      source: 'local',
      warnings: fallback.warnings || [],
    }
    conflictStrategy.value = 'new'
    parseError.value = ''
    initModuleSelection(plan.value)
    step.value = 'preview'
  } catch (error) {
    parseError.value = error?.message || '无法解析这段 cURL'
  }
}

function backToInput() {
  step.value = 'input'
  parseError.value = ''
}

function uniqueName(baseName, list) {
  const name = String(baseName || '未命名').trim() || '未命名'
  const names = new Set((list || []).map((item) => item.name))
  if (!names.has(name)) return name
  let index = 2
  while (names.has(`${name} (${index})`)) index += 1
  return `${name} (${index})`
}

function conflictOf(type) {
  return conflicts.value.find((item) => item.type === type)
}

function shouldOverwrite(type) {
  return conflictStrategy.value === 'overwrite' && Boolean(conflictOf(type))
}

async function importPlan() {
  if (!plan.value) return
  const p = plan.value
  if (!importCount.value) {
    ElMessage.warning('请至少选择一个需要保存的模块')
    return
  }
  if ((selectedModules.site || selectedModules.task) && !p.site.baseUrl) {
    ElMessage.error('站点地址不完整，无法保存站点或任务')
    return
  }
  if ((selectedModules.config || selectedModules.task) && !p.config.path) {
    ElMessage.error('请求路径不完整，无法保存配置或任务')
    return
  }
  if (
    selectedModules.task &&
    !TASK_REQUIRED_MODULES.every((key) => selectedModules[key])
  ) {
    ElMessage.error('采集任务需要同时保存站点、配置和存储')
    return
  }

  const taskSelected = isModuleSelected('task')
  const taskConflict = taskSelected && shouldOverwrite('task') ? conflictOf('task') : null
  if (taskConflict) {
    const existingTask = store.tasks.find((task) => task.id === taskConflict.existingId)
    if (existingTask?.status === 'running') {
      ElMessage.error('重复的采集任务正在运行，请等待结束后再覆盖导入')
      return
    }
  }

  try {
    let site = null
    if (selectedModules.site) {
      const sitePayload = {
        name: p.site.name,
        baseUrl: p.site.baseUrl,
        description: p.site.description,
        enabled: p.site.enabled !== false,
        pageRule: p.pageRule || null,
      }
      const siteConflict = conflictOf('site')
      site =
        shouldOverwrite('site') && siteConflict
          ? updateSite(siteConflict.existingId, sitePayload) ||
            createSite({ ...sitePayload, name: uniqueName(p.site.name, store.sites) })
          : createSite({ ...sitePayload, name: uniqueName(p.site.name, store.sites) })
    }

    let config = null
    if (selectedModules.config) {
      const configPayload = {
        name: p.config.name,
        method: p.config.method,
        path: p.config.path,
        responseType: p.config.responseType,
        dataPath: p.config.dataPath,
        body: p.config.body,
        fragmentRule: p.config.fragmentRule || null,
        linkRule: p.config.linkRule || null,
        media: p.config.media || null,
        pagination: p.config.pagination || null,
        description: p.config.description,
      }
      const configConflict = conflictOf('config')
      config =
        shouldOverwrite('config') && configConflict
          ? updateConfig(configConflict.existingId, configPayload) ||
            createConfig({ ...configPayload, name: uniqueName(p.config.name, store.configs) })
          : createConfig({ ...configPayload, name: uniqueName(p.config.name, store.configs) })
    }

    let header = null
    if (selectedModules.header && p.header) {
      const headerPayload = {
        name: p.header.name,
        description: p.header.description,
        rows: p.header.rows,
      }
      const headerConflict = conflictOf('header')
      header =
        shouldOverwrite('header') && headerConflict
          ? updateHeader(headerConflict.existingId, headerPayload) ||
            createHeader({ ...headerPayload, name: uniqueName(p.header.name, store.headers) })
          : createHeader({ ...headerPayload, name: uniqueName(p.header.name, store.headers) })
    }

    let param = null
    if (selectedModules.param && p.param) {
      const paramPayload = {
        name: p.param.name,
        description: p.param.description,
        rows: p.param.rows,
      }
      const paramConflict = conflictOf('param')
      param =
        shouldOverwrite('param') && paramConflict
          ? updateParam(paramConflict.existingId, paramPayload) ||
            createParam({ ...paramPayload, name: uniqueName(p.param.name, store.params) })
          : createParam({ ...paramPayload, name: uniqueName(p.param.name, store.params) })
    }

    let storage = null
    if (selectedModules.storage) {
      const storagePayload = {
        name: p.storage.name,
        type: p.storage.type,
        target: p.storage.target,
        description: p.storage.description,
        db: p.storage.db || null,
      }
      const storageConflict = conflictOf('storage')
      storage =
        shouldOverwrite('storage') && storageConflict
          ? updateStorage(storageConflict.existingId, storagePayload) ||
            createStorage({ ...storagePayload, name: uniqueName(p.storage.name, store.storages) })
          : createStorage({ ...storagePayload, name: uniqueName(p.storage.name, store.storages) })
    }

    if (selectedModules.proxy && p.proxy) {
      const proxyPayload = {
        name: p.proxy.name,
        protocol: p.proxy.protocol,
        host: p.proxy.host,
        port: p.proxy.port,
        username: p.proxy.username,
        password: p.proxy.password,
        enabled: p.proxy.enabled,
        description: p.proxy.description,
      }
      const proxyConflict = conflictOf('proxy')
      if (shouldOverwrite('proxy') && proxyConflict) {
        updateProxy(proxyConflict.existingId, proxyPayload)
      } else {
        createProxy({ ...proxyPayload, name: uniqueName(p.proxy.name, store.proxies) })
      }
    }

    if (taskSelected) {
      if (!site || !config || !storage) {
        throw new Error('采集任务缺少关联的站点、配置或存储')
      }
      const taskPayload = {
        name: p.task.name,
        description: p.task.description,
        siteId: site.id,
        configId: config.id,
        headerId: header?.id || '',
        paramId: param?.id || '',
        storageId: storage.id,
        collectAt: p.task.collectAt,
      }
      if (shouldOverwrite('task') && taskConflict) {
        updateTask(taskConflict.existingId, {
          ...taskPayload,
          status: 'ready',
          lastRunAt: '',
          lastDuration: 0,
          lastCount: 0,
          lastError: '',
        })
      } else {
        createTask({ ...taskPayload, name: uniqueName(p.task.name, store.tasks) })
      }
    }

    const overwriteNote =
      conflictStrategy.value === 'overwrite' && conflicts.value.length
        ? `，覆盖了 ${conflicts.value.length} 项重复配置`
        : ''
    const taskNote = taskSelected ? '并创建任务' : '，未创建任务'
    ElMessage.success(`已保存 ${importCount.value} 个模块${taskNote}${overwriteNote}`)
    visible.value = false
    emit('imported')

    const target = taskSelected
      ? '/collections'
      : selectedModules.site
        ? '/sites'
        : selectedModules.config
          ? '/configs'
          : selectedModules.header
            ? '/headers'
            : selectedModules.param
              ? '/params'
              : selectedModules.proxy
                ? '/proxies'
                : '/storages'
    router.push(target)
  } catch (error) {
    ElMessage.error(error?.message || '导入失败，请重试')
  }
}

function useSample() {
  curlText.value = `curl 'https://api.example.com/v1/items?page=1&limit=20' \\
  -H 'Accept: application/json' \\
  -H 'Authorization: Bearer YOUR_TOKEN'`
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="cf-dialog curl-import-dialog"
    width="min(920px, 96vw)"
    :close-on-click-modal="false"
    destroy-on-close
    append-to-body
  >
    <template #header>
      <div class="dialog-heading">
        <span class="dialog-heading-icon is-ai">
          <el-icon><MagicStick /></el-icon>
        </span>
        <div class="dialog-heading-copy">
          <h3>一键解析</h3>
          <p>粘贴 cURL，自动生成站点、配置、Header、参数、代理、存储与采集任务。</p>
        </div>
      </div>
    </template>

    <div class="import-steps">
      <div class="import-step" :class="{ 'is-active': step === 'input' }">
        <span>01</span>
        粘贴 cURL
      </div>
      <i />
      <div class="import-step" :class="{ 'is-active': step === 'preview' }">
        <span>02</span>
        确认导入
      </div>
      <div class="import-step-spacer" />
      <span class="import-engine-badge" :class="llmReady ? 'is-ai' : 'is-local'">
        <span class="engine-spark" />
        {{ engineLabel }}
      </span>
    </div>

    <template v-if="step === 'input'">
      <div class="llm-status-row">
        <div class="llm-status-copy">
          <strong>{{ llmReady ? '使用大模型理解请求结构' : '尚未配置模型，将使用本地规则解析' }}</strong>
          <span>
            {{
              llmReady
                ? 'cURL 与响应示例会发送给所选模型服务商，请先脱敏；模型会补全命名、数据路径与页面规则。'
                : '配置任意 OpenAI 兼容接口后，可获得更准确的数据路径、页面规则与字段推断。'
            }}
          </span>
        </div>
        <button class="settings-toggle" type="button" @click="showSettings = !showSettings">
          <el-icon><Key /></el-icon>
          {{ showSettings ? '收起设置' : '模型设置' }}
        </button>
      </div>

      <div v-if="showSettings" class="model-config-panel">
        <div class="model-config-head">
          <div class="model-config-title">
            <span class="model-config-title-icon"><el-icon><Key /></el-icon></span>
            <div>
              <strong>模型连接</strong>
              <span>OpenAI 兼容接口 · 配置仅保存在当前浏览器</span>
            </div>
          </div>
          <span class="model-test-status" :class="`is-${modelTest.status}`">
            {{
              modelTest.status === 'running'
                ? '测试中'
                : modelTest.status === 'success'
                  ? '连接正常'
                  : modelTest.status === 'error'
                    ? '连接失败'
                    : '未测试'
            }}
          </span>
        </div>

        <div class="provider-preset-row">
          <span>服务商</span>
          <div class="provider-presets">
            <button
              v-for="preset in LLM_PRESETS"
              :key="preset.key"
              type="button"
              :class="{ 'is-active': currentPreset === preset.key }"
              @click="applyPreset(preset)"
            >
              {{ preset.label }}
            </button>
          </div>
        </div>

        <div class="model-config-grid">
          <label class="config-field">
            <span>Base URL</span>
            <el-input
              v-model="settings.baseUrl"
              placeholder="https://api.deepseek.com"
              @input="resetModelTest"
            />
          </label>
          <label class="config-field">
            <span>模型名称</span>
            <el-input
              v-model="settings.model"
              placeholder="deepseek-chat"
              @input="resetModelTest"
            />
          </label>
          <label class="config-field is-wide">
            <span>API Key</span>
            <el-input
              v-model="settings.apiKey"
              type="password"
              show-password
              autocomplete="off"
              placeholder="sk-…（本地 Ollama 可留空）"
              @input="resetModelTest"
            />
          </label>
        </div>

        <div
          v-if="modelTest.status !== 'idle'"
          class="model-test-result"
          :class="`is-${modelTest.status}`"
        >
          <span class="model-test-icon">
            <el-icon>
              <Loading v-if="modelTest.status === 'running'" class="is-spinning" />
              <CircleCheck v-else-if="modelTest.status === 'success'" />
              <WarningFilled v-else />
            </el-icon>
          </span>
          <div>
            <strong>{{ modelTest.message }}</strong>
            <span>{{ modelTest.detail || '测试会发送一条简短消息以验证连接。' }}</span>
          </div>
        </div>

        <div class="model-config-footer">
          <p>API Key 仅保存在本地；测试会消耗极少量模型额度。</p>
          <div>
            <el-button
              :loading="modelTesting"
              :disabled="!settings.baseUrl.trim() || !settings.model.trim()"
              @click="testModel"
            >
              测试模型
            </el-button>
            <el-button type="primary" @click="persistSettings">保存设置</el-button>
          </div>
        </div>
      </div>

      <div class="curl-input-layout">
        <div class="curl-input-main">
          <div class="input-section-head">
            <div>
              <strong>cURL 命令 <em>*</em></strong>
              <span>支持浏览器 DevTools 中复制的 Copy as cURL</span>
            </div>
            <button type="button" class="text-button" @click="useSample">填入示例</button>
          </div>
          <el-input
            v-model="curlText"
            class="curl-textarea"
            type="textarea"
            :rows="9"
            resize="none"
            spellcheck="false"
            placeholder="curl 'https://api.example.com/v1/items?page=1' -H 'Accept: application/json'"
          />
          <button class="sample-toggle" type="button" @click="showSample = !showSample">
            <span>{{ showSample ? '−' : '+' }}</span>
            {{ showSample ? '收起响应示例' : '附上响应示例（可选，能提高数据路径与页面规则准确率）' }}
          </button>
          <el-input
            v-if="showSample"
            v-model="responseSample"
            class="response-textarea"
            type="textarea"
            :rows="5"
            resize="none"
            spellcheck="false"
            placeholder='粘贴一段 JSON 响应或 HTML 片段，例如 {"data": {"items": [...]}}'
          />
        </div>

        <aside class="parse-guide">
          <div class="parse-guide-title">
            <el-icon><MagicStick /></el-icon>
            解析后会生成
          </div>
          <div class="guide-item">
            <span class="guide-icon"><Link /></span>
            <div><strong>站点 + 配置</strong><span>基础地址、路径、请求方式与解析规则</span></div>
          </div>
          <div class="guide-item">
            <span class="guide-icon"><Document /></span>
            <div><strong>Header + 参数</strong><span>自动提取请求头与查询参数</span></div>
          </div>
          <div class="guide-item">
            <span class="guide-icon"><Files /></span>
            <div><strong>存储 + 任务</strong><span>默认创建 JSON 存储并生成可执行任务</span></div>
          </div>
          <div class="parse-guide-divider" />
          <p>本地规则模式不会上传内容；AI 模式会把 cURL 发送给模型服务商，请提前移除真实密钥。</p>
        </aside>
      </div>

      <div v-if="parseError" class="result-error import-error">
        <el-icon><WarningFilled /></el-icon>
        <div>
          <strong>解析未完成</strong>
          {{ parseError }}
          <el-button
            v-if="engine === 'llm' || llmReady"
            class="inline-local-button"
            size="small"
            @click="useLocalParse"
          >
            改用本地规则解析
          </el-button>
        </div>
      </div>

      <div v-if="parsing" class="parsing-panel">
        <span class="parsing-icon"><el-icon><Loading class="is-spinning" /></el-icon></span>
        <div>
          <strong>{{ engine === 'llm' ? '大模型正在解析 cURL…' : '正在解析 cURL…' }}</strong>
          <span>{{ engine === 'llm' ? '分析请求结构、命名栏目并生成采集配置' : '提取请求地址、请求头与查询参数' }}</span>
        </div>
        <div class="parsing-bars"><i /><i /><i /></div>
      </div>
    </template>

    <template v-else>
      <div class="import-preview-head">
        <div>
          <span class="preview-kicker">
            <span class="source-dot" :class="engine === 'llm' ? 'is-ai' : 'is-local'" />
            {{ engine === 'llm' ? 'AI 解析结果' : '本地规则解析结果' }}
          </span>
          <h4>已识别 {{ sectionCards.length }} 个栏目，已选择 {{ importCount }} 个保存模块</h4>
          <p>勾选需要保存的模块，未勾选的模块不会写入工作区。</p>
        </div>
        <button class="text-button" type="button" @click="backToInput">← 返回修改</button>
      </div>

      <div class="import-module-toolbar">
        <div class="module-toolbar-copy">
          <strong>选择保存模块</strong>
          <span>
            已选 {{ importCount }}/{{ selectableCards.length }} 项 · 勾选采集任务会自动包含站点、配置与存储
          </span>
        </div>
        <div class="module-toolbar-actions">
          <button
            type="button"
            :disabled="allModulesSelected"
            @click="selectAllModules"
          >
            全选
          </button>
          <button type="button" :disabled="!importCount" @click="clearModules">
            清空
          </button>
        </div>
      </div>

      <div v-if="warnings.length" class="import-warnings">
        <el-icon><WarningFilled /></el-icon>
        <div>
          <strong>请注意</strong>
          <span v-for="warning in warnings" :key="warning">{{ warning }}</span>
        </div>
      </div>

      <div v-if="conflicts.length" class="import-conflict-panel">
        <div class="conflict-head">
          <span class="conflict-icon"><el-icon><WarningFilled /></el-icon></span>
          <div>
            <strong>发现 {{ conflicts.length }} 项重复配置</strong>
            <span>{{ conflictSummary }}</span>
          </div>
        </div>
        <div class="conflict-options">
          <button
            type="button"
            class="conflict-option"
            :class="{ 'is-active': conflictStrategy === 'new' }"
            @click="conflictStrategy = 'new'"
          >
            <span class="conflict-radio"><i /></span>
            <div>
              <strong>新建副本</strong>
              <span>保留现有数据，使用新名称创建一份配置</span>
            </div>
          </button>
          <button
            type="button"
            class="conflict-option is-danger"
            :class="{ 'is-active': conflictStrategy === 'overwrite' }"
            @click="conflictStrategy = 'overwrite'"
          >
            <span class="conflict-radio"><i /></span>
            <div>
              <strong>覆盖已有</strong>
              <span>更新同名或同地址配置，可能影响已关联任务</span>
            </div>
          </button>
        </div>
      </div>

      <div class="import-preview-grid">
        <article
          v-for="card in sectionCards"
          :key="card.key"
          class="import-preview-card"
          :class="[
            `tone-${card.tone}`,
            {
              'is-selectable': card.selectable,
              'is-selected': card.selectable && isModuleSelected(card.key),
              'is-unselected': card.selectable && !isModuleSelected(card.key),
              'is-dependent': !card.selectable,
              'is-dimmed': card.key === 'pageRule' && !isModuleSelected('site'),
            },
          ]"
          :role="card.selectable ? 'checkbox' : undefined"
          :aria-checked="card.selectable ? isModuleSelected(card.key) : undefined"
          :tabindex="card.selectable ? 0 : undefined"
          :title="card.selectable ? '点击选择或取消保存该模块' : ''"
          @click="activateCard(card)"
          @keydown.enter.prevent="activateCard(card)"
          @keydown.space.prevent="activateCard(card)"
        >
          <div class="import-preview-card-head">
            <span class="import-card-icon">
              <el-icon><component :is="card.icon" /></el-icon>
            </span>
            <span class="import-card-label">{{ card.label }}</span>
            <span v-if="conflictTypes.has(card.key)" class="import-card-conflict">已存在</span>
            <span v-if="!card.selectable" class="import-card-dependent">随站点</span>
            <span
              v-else
              class="import-select-box"
              :class="{ 'is-checked': isModuleSelected(card.key) }"
            >
              <el-icon v-if="isModuleSelected(card.key)"><Check /></el-icon>
            </span>
          </div>
          <strong class="import-card-title">{{ card.title }}</strong>
          <span
            v-for="(line, index) in card.lines"
            :key="index"
            class="import-card-line"
          >{{ line || '—' }}</span>
        </article>
      </div>

      <div class="import-summary-bar">
        <div class="import-summary-copy">
          <el-icon><InfoFilled /></el-icon>
          <span>{{ importSummaryText }}</span>
        </div>
        <span class="import-storage-chip">
          {{ plan.config.method }} · {{ storageTypeLabel(plan.storage.type) }}
        </span>
      </div>
    </template>

    <template #footer>
      <div class="dialog-footer">
        <span class="dialog-footer-hint">
          {{ step === 'input' ? '解析只读取 cURL 内容，不会自动发起目标请求' : '仅保存勾选的模块，未选中的内容不会写入' }}
        </span>
        <div class="dialog-footer-actions">
          <el-button @click="visible = false">取消</el-button>
          <el-button v-if="step === 'preview'" @click="backToInput">返回修改</el-button>
          <el-button
            v-if="step === 'input'"
            type="primary"
            :loading="parsing"
            :disabled="!curlText.trim()"
            @click="startParse"
          >
            <el-icon v-if="!parsing"><MagicStick /></el-icon>
            {{ llmReady ? '大模型解析' : '本地规则解析' }}
          </el-button>
          <el-button
            v-else
            type="primary"
            :disabled="!importCount"
            @click="importPlan"
          >
            <el-icon><CircleCheck /></el-icon>
            {{ importButtonLabel }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>
