<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCheck,
  Connection,
  CopyDocument,
  Delete,
  EditPen,
  InfoFilled,
  Plus,
  Search,
  SetUp,
} from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import BulkActionBar from '../components/BulkActionBar.vue'
import StatCard from '../components/StatCard.vue'
import FragmentFieldsEditor from '../components/FragmentFieldsEditor.vue'
import SniffDialog from '../components/SniffDialog.vue'
import { useBulkSelection } from '../composables/useBulkSelection'
import {
  createConfig,
  removeConfig,
  store,
  updateConfig,
  usageCount,
} from '../stores/collector'
import {
  formatDateTime,
  fromNow,
  localDateTime,
  uid,
} from '../utils/format'
import {
  buildHeaderRotation,
  buildSchedule,
  executionLabel,
  nextRunLabel,
  normalizeExecution,
  normalizeHeaderRotation,
  normalizeSchedule,
  scheduleSummary,
} from '../utils/schedule'

const RESPONSE_META = {
  json: { label: 'JSON', tag: 'is-json', description: '解析 JSON 接口响应' },
  html: { label: 'HTML 页面', tag: 'is-html', description: '按站点页面规则提取' },
  web: { label: '网页片段', tag: 'is-web', description: '自定义 CSS 片段字段' },
  image: { label: '图片', tag: 'is-image', description: '自动提取图片地址' },
  video: { label: '视频', tag: 'is-video', description: '自动提取视频地址' },
  link: { label: '链接', tag: 'is-link', description: '提取页面超链接' },
  xhr: { label: 'XHR 接口', tag: 'is-xhr', description: '直接请求 XHR/API 响应' },
  jsonp: { label: 'JSONP', tag: 'is-jsonp', description: '解析回调包裹的 JSONP 响应' },
  text: { label: '纯文本', tag: 'is-text', description: '保留全文响应' },
}

const activeTab = ref('all')
const keyword = ref('')
const dialogVisible = ref(false)
const sniffVisible = ref(false)
const editingConfig = ref(null)
const formRef = ref(null)
const saving = ref(false)
const { tableRef, selectedRows, bulkBusy, handleSelectionChange, clearSelection } =
  useBulkSelection()

function defaultFragmentFields() {
  return [
    { id: uid('field'), key: 'title', selector: 'title', attr: 'text', attribute: '', enabled: true },
    {
      id: uid('field'),
      key: 'description',
      selector: 'meta[name="description"]',
      attr: 'attribute',
      attribute: 'content',
      enabled: true,
    },
    { id: uid('field'), key: 'canonical', selector: 'link[rel="canonical"]', attr: 'href', attribute: '', enabled: true },
  ]
}

function defaultScheduleInput() {
  const start = new Date()
  const end = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const once = new Date(Date.now() + 60 * 60 * 1000)
  return {
    startAt: localDateTime(start),
    endAt: localDateTime(end),
    onceAt: localDateTime(once),
  }
}

function emptyForm() {
  const scheduleDefaults = defaultScheduleInput()
  return {
    name: '',
    method: 'GET',
    path: '',
    responseType: 'json',
    dataPath: '',
    body: '',
    description: '',
    fragmentItemSelector: '',
    fragmentFields: defaultFragmentFields(),
    mediaMaxItems: 200,
    mediaCollectResource: true,
    linkSelector: 'a[href]',
    linkUrlContains: '',
    linkUrlContainsNot: '',
    linkSameOrigin: true,
    linkDedupe: true,
    linkMaxItems: 500,
    dynamicEnabled: false,
    dynamicWaitMs: 3000,
    xhrUrlContains: '',
    paginationMode: 'none',
    paginationParam: 'page',
    paginationStartPage: 1,
    paginationMaxPages: 1,
    paginationNextSelector: '',
    retryCount: 0,
    timeoutSeconds: 30,
    concurrency: 1,
    headerRotationEnabled: false,
    headerRotationStrategy: 'round-robin',
    headerRotationHeaderIds: [],
    scheduleEnabled: false,
    scheduleMode: 'interval',
    scheduleStartAt: scheduleDefaults.startAt,
    scheduleEndAt: scheduleDefaults.endAt,
    scheduleIntervalSeconds: 60,
    scheduleOnceAt: scheduleDefaults.onceAt,
  }
}

const form = reactive(emptyForm())

const rules = {
  name: [
    { required: true, message: '请填写配置名称', trigger: 'blur' },
    { max: 30, message: '名称不能超过 30 个字符', trigger: 'blur' },
  ],
  path: [
    { required: true, message: '请填写请求路径', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (!value) return callback()
        if (/\s/.test(value)) return callback(new Error('请求路径中不能包含空格'))
        callback()
      },
      trigger: 'blur',
    },
  ],
}

const tabs = computed(() => [
  { key: 'all', label: '全部配置', count: store.configs.length },
  { key: 'auto', label: '自动采集', count: store.configs.filter((item) => normalizeSchedule(item).enabled).length },
  { key: 'json', label: 'JSON', count: store.configs.filter((item) => item.responseType === 'json').length },
  { key: 'html', label: 'HTML 页面', count: store.configs.filter((item) => item.responseType === 'html').length },
  { key: 'web', label: '网页片段', count: store.configs.filter((item) => item.responseType === 'web').length },
  { key: 'media', label: '媒体', count: store.configs.filter((item) => ['image', 'video'].includes(item.responseType)).length },
  { key: 'link', label: '链接', count: store.configs.filter((item) => item.responseType === 'link').length },
  { key: 'xhr', label: 'XHR', count: store.configs.filter((item) => item.responseType === 'xhr').length },
  { key: 'jsonp', label: 'JSONP', count: store.configs.filter((item) => item.responseType === 'jsonp').length },
  { key: 'text', label: '纯文本', count: store.configs.filter((item) => item.responseType === 'text').length },
])

const filteredConfigs = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return store.configs.filter((config) => {
    if (activeTab.value === 'auto') {
      if (!normalizeSchedule(config).enabled) return false
    } else if (activeTab.value === 'media') {
      if (!['image', 'video'].includes(config.responseType)) return false
    } else if (activeTab.value !== 'all' && config.responseType !== activeTab.value) {
      return false
    }
    if (!query) return true
    return [config.name, config.path, config.dataPath, config.description]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  })
})

const page = ref(1)
const pageSize = 10
const totalPages = computed(() => Math.max(1, Math.ceil(filteredConfigs.value.length / pageSize)))
const pagedConfigs = computed(() =>
  filteredConfigs.value.slice((page.value - 1) * pageSize, page.value * pageSize),
)
watch(filteredConfigs, () => {
  if (page.value > totalPages.value) page.value = totalPages.value
})

const linkedTaskCount = computed(() => store.tasks.filter((task) => task.configId).length)
const autoConfigCount = computed(() => store.configs.filter((item) => normalizeSchedule(item).enabled).length)
const htmlConfigCount = computed(() => store.configs.filter((item) => item.responseType === 'html').length)
const configTaskCount = computed(() =>
  editingConfig.value ? store.tasks.filter((task) => task.configId === editingConfig.value.id).length : 0,
)

const schedulePreviewTitle = computed(() => {
  if (!form.scheduleEnabled) return '自动采集未启用'
  if (form.scheduleMode === 'once') return `单次定时 · ${formatDateTime(form.scheduleOnceAt, { withSeconds: true })}`
  return `每 ${form.scheduleIntervalSeconds || 0} 秒执行一次`
})
const schedulePreviewDetail = computed(() => {
  if (!form.scheduleEnabled) return '保存后仅能手动点击「采集」触发任务。'
  if (form.scheduleMode === 'once') return '到点执行一次后自动停用。'
  return `在 ${formatDateTime(form.scheduleStartAt)} 至 ${formatDateTime(form.scheduleEndAt)} 之间循环执行。`
})

function responseHint(config) {
  if (config.responseType === 'html') return config.crawlEnabled ? 'HTML · 多级页面规则' : '站点页面规则'
  if (config.responseType === 'web') {
    const count = (config.fragmentRule?.fields || []).filter((field) => field.enabled !== false && field.key?.trim()).length
    return `${count} 个片段字段`
  }
  if (config.responseType === 'image') return config.media?.collectResource === false ? '仅图片地址' : '图片资源'
  if (config.responseType === 'video') return config.media?.collectResource === false ? '仅视频地址' : '视频资源'
  if (config.responseType === 'link') return `${config.linkRule?.selector || 'a[href]'} · 最多 ${config.linkRule?.maxItems || 500} 条`
  if (config.responseType === 'xhr') return config.dynamic?.enabled ? '页面 XHR 捕获' : 'XHR 接口'
  if (config.responseType === 'jsonp') return 'JSONP 回调解析'
  if (config.responseType === 'text') return '全文记录'
  return config.dataPath || '完整响应'
}

function configCrawlEnabled(config) {
  return config?.crawl?.enabled || config?.pageRule?.crawl?.enabled
}

function scheduleOf(config) {
  return normalizeSchedule(config)
}

function headerRotationOf(config) {
  return normalizeHeaderRotation(config)
}

function openCreate() {
  editingConfig.value = null
  dialogVisible.value = true
}

function openEdit(config) {
  editingConfig.value = config
  dialogVisible.value = true
}

watch(
  () => dialogVisible.value,
  (open) => {
    if (!open) return
    const defaults = defaultScheduleInput()
    if (editingConfig.value) {
      const execution = normalizeExecution(editingConfig.value)
      const schedule = normalizeSchedule(editingConfig.value)
      const rotation = normalizeHeaderRotation(editingConfig.value)
      Object.assign(form, emptyForm(), {
        name: editingConfig.value.name || '',
        method: editingConfig.value.method || 'GET',
        path: editingConfig.value.path || '',
        responseType: editingConfig.value.responseType || 'json',
        dataPath: editingConfig.value.dataPath || '',
        body: editingConfig.value.body || '',
        description: editingConfig.value.description || '',
        fragmentItemSelector: editingConfig.value.fragmentRule?.itemSelector || '',
        fragmentFields:
          editingConfig.value.fragmentRule?.fields?.length
            ? editingConfig.value.fragmentRule.fields.map((field) => ({ ...field, id: field.id || uid('field') }))
            : defaultFragmentFields(),
        mediaMaxItems: editingConfig.value.media?.maxItems || 200,
        mediaCollectResource: editingConfig.value.media?.collectResource !== false,
        linkSelector: editingConfig.value.linkRule?.selector || 'a[href]',
        linkUrlContains: editingConfig.value.linkRule?.urlContains || '',
        linkUrlContainsNot: editingConfig.value.linkRule?.urlContainsNot || '',
        linkSameOrigin: editingConfig.value.linkRule?.sameOrigin !== false,
        linkDedupe: editingConfig.value.linkRule?.dedupe !== false,
        linkMaxItems: editingConfig.value.linkRule?.maxItems || 500,
        dynamicEnabled: editingConfig.value.dynamic?.enabled === true,
        dynamicWaitMs: editingConfig.value.dynamic?.waitMs || 3000,
        xhrUrlContains: editingConfig.value.dynamic?.xhrMatch || '',
        paginationMode: editingConfig.value.pagination?.mode || 'none',
        paginationParam: editingConfig.value.pagination?.param || 'page',
        paginationStartPage: editingConfig.value.pagination?.startPage || 1,
        paginationMaxPages: editingConfig.value.pagination?.maxPages || 1,
        paginationNextSelector: editingConfig.value.pagination?.nextSelector || '',
        retryCount: execution.retryCount,
        timeoutSeconds: execution.timeoutSeconds,
        concurrency: execution.concurrency,
        headerRotationEnabled: rotation.enabled,
        headerRotationStrategy: rotation.strategy,
        headerRotationHeaderIds: [...rotation.headerIds],
        scheduleEnabled: schedule.enabled,
        scheduleMode: schedule.mode,
        scheduleStartAt: schedule.startAt || defaults.startAt,
        scheduleEndAt: schedule.endAt || defaults.endAt,
        scheduleIntervalSeconds: schedule.intervalSeconds,
        scheduleOnceAt: schedule.onceAt || defaults.onceAt,
      })
    } else {
      Object.assign(form, emptyForm())
    }
    nextTick(() => formRef.value?.clearValidate())
  },
)

watch(
  () => form.responseType,
  (type) => {
    if (type === 'web' && !form.fragmentFields.length) form.fragmentFields = defaultFragmentFields()
  },
)

function addField() {
  form.fragmentFields.push({ id: uid('field'), key: '', selector: '', attr: 'text', attribute: '', enabled: true })
}
function removeField(index) {
  form.fragmentFields.splice(index, 1)
}

async function saveConfig() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  const retryCount = Number(form.retryCount)
  const timeoutSeconds = Number(form.timeoutSeconds)
  const concurrency = Number(form.concurrency)
  if (!Number.isFinite(retryCount) || retryCount < 0 || retryCount > 10) return ElMessage.warning('重试次数需在 0 - 10 之间')
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 60) return ElMessage.warning('超时时间需在 1 - 60 秒之间')
  if (!Number.isFinite(concurrency) || concurrency < 1 || concurrency > 10) return ElMessage.warning('并发数需在 1 - 10 之间')
  if (form.headerRotationEnabled && !form.headerRotationHeaderIds.length) return ElMessage.warning('启用请求头轮换后至少选择一个 Header 模板')
  if (form.responseType === 'web') {
    const fields = form.fragmentFields.filter((field) => field.enabled !== false && field.key?.trim())
    if (!fields.length) return ElMessage.warning('网页片段采集至少需要一个启用的字段')
    if (new Set(fields.map((field) => field.key.trim())).size !== fields.length) return ElMessage.warning('网页片段字段名不能重复')
  }
  if (['image', 'video'].includes(form.responseType)) {
    if (!Number.isFinite(Number(form.mediaMaxItems)) || Number(form.mediaMaxItems) < 1 || Number(form.mediaMaxItems) > 2000) {
      return ElMessage.warning('媒体采集数量需在 1 - 2000 之间')
    }
  }
  if (form.responseType === 'link') {
    if (!form.linkSelector.trim()) return ElMessage.warning('请填写链接选择器')
    if (!Number.isFinite(Number(form.linkMaxItems)) || Number(form.linkMaxItems) < 1 || Number(form.linkMaxItems) > 2000) {
      return ElMessage.warning('链接采集数量需在 1 - 2000 之间')
    }
  }
  if (['link', 'xhr'].includes(form.responseType) && form.dynamicEnabled) {
    if (!Number.isFinite(Number(form.dynamicWaitMs)) || Number(form.dynamicWaitMs) < 300 || Number(form.dynamicWaitMs) > 10000) {
      return ElMessage.warning('动态渲染等待时间需在 300 - 10000 毫秒之间')
    }
  }
  if (['web', 'image', 'video', 'link'].includes(form.responseType)) {
    if (!Number.isFinite(Number(form.paginationMaxPages)) || Number(form.paginationMaxPages) < 1 || Number(form.paginationMaxPages) > 50) {
      return ElMessage.warning('最大页数需在 1 - 50 之间')
    }
    if (form.paginationMode === 'pageParam' && !form.paginationParam.trim()) return ElMessage.warning('请填写分页参数名')
    if (form.paginationMode === 'nextLink' && !form.paginationNextSelector.trim()) return ElMessage.warning('请填写下一页链接的 CSS 选择器')
  }
  if (form.scheduleEnabled) {
    if (form.scheduleMode === 'once' && !form.scheduleOnceAt) return ElMessage.warning('请选择单次执行时间')
    if (form.scheduleMode !== 'once' && (!form.scheduleStartAt || !form.scheduleEndAt)) return ElMessage.warning('请选择自动采集开始和结束时间')
    if (form.scheduleMode !== 'once' && Number(form.scheduleIntervalSeconds) < 1) return ElMessage.warning('采集间隔至少 1 秒')
  }
  const duplicate = store.configs.some(
    (config) => config.id !== editingConfig.value?.id && config.name.trim() === form.name.trim(),
  )
  if (duplicate) return ElMessage.warning('已存在同名采集配置')

  const schedule = buildSchedule(
    {
      enabled: form.scheduleEnabled,
      mode: form.scheduleMode,
      startAt: form.scheduleStartAt,
      endAt: form.scheduleEndAt,
      intervalSeconds: Number(form.scheduleIntervalSeconds),
      onceAt: form.scheduleOnceAt,
    },
    editingConfig.value?.schedule,
  )
  const payload = {
    name: form.name.trim(),
    method: form.method,
    path: form.path.trim(),
    responseType: form.responseType,
    dataPath: ['json', 'xhr', 'jsonp'].includes(form.responseType) ? form.dataPath.trim() : '',
    body: ['GET', 'HEAD'].includes(form.method) ? '' : form.body,
    description: form.description.trim(),
    fragmentRule:
      form.responseType === 'web'
        ? {
            itemSelector: form.fragmentItemSelector.trim(),
            fields: form.fragmentFields
              .filter((field) => field.enabled !== false && field.key?.trim())
              .map((field) => ({
                id: field.id,
                key: field.key.trim(),
                selector: field.selector?.trim() || '',
                attr: field.attr || 'text',
                attribute: field.attribute?.trim() || '',
                enabled: true,
              })),
          }
        : null,
    linkRule:
      form.responseType === 'link'
        ? {
            selector: form.linkSelector.trim() || 'a[href]',
            urlContains: form.linkUrlContains.trim(),
            urlContainsNot: form.linkUrlContainsNot.trim(),
            sameOrigin: form.linkSameOrigin,
            dedupe: form.linkDedupe,
            maxItems: Math.min(Math.max(Number(form.linkMaxItems) || 500, 1), 2000),
          }
        : null,
    media: ['image', 'video'].includes(form.responseType)
      ? {
          maxItems: Number(form.mediaMaxItems),
          collectResource: form.mediaCollectResource !== false,
        }
      : null,
    dynamic:
      ['link', 'xhr'].includes(form.responseType) && form.dynamicEnabled
        ? {
            enabled: true,
            waitMs: Math.min(Math.max(Number(form.dynamicWaitMs) || 3000, 300), 10000),
            xhrMatch: form.xhrUrlContains.trim(),
          }
        : null,
    pagination: ['web', 'image', 'video', 'link'].includes(form.responseType)
      ? {
          mode: form.paginationMode,
          param: form.paginationParam.trim() || 'page',
          startPage: Math.max(Number(form.paginationStartPage) || 1, 1),
          maxPages: Math.min(Math.max(Number(form.paginationMaxPages) || 1, 1), 50),
          nextSelector: form.paginationNextSelector.trim(),
        }
      : null,
    execution: { retryCount, timeoutSeconds, concurrency },
    headerRotation: buildHeaderRotation(
      {
        enabled: form.headerRotationEnabled,
        strategy: form.headerRotationStrategy,
        headerIds: form.headerRotationHeaderIds,
      },
      editingConfig.value?.headerRotation,
    ),
    schedule,
  }
  saving.value = true
  try {
    if (editingConfig.value) {
      updateConfig(editingConfig.value.id, payload)
      ElMessage.success('采集配置已更新')
    } else {
      createConfig(payload)
      ElMessage.success('采集配置已创建')
    }
    dialogVisible.value = false
  } finally {
    saving.value = false
  }
}

async function deleteConfig(config) {
  const count = usageCount('configs', config.id)
  if (count) {
    ElMessage.warning(`该配置正被 ${count} 个任务使用，请先调整关联任务`)
    return
  }
  try {
    await ElMessageBox.confirm(`确认删除采集配置「${config.name}」？`, '删除采集配置', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    removeConfig(config.id)
    ElMessage.success('采集配置已删除')
  } catch {
    // 用户取消
  }
}

function duplicateConfig(config) {
  const copy = {
    ...JSON.parse(JSON.stringify(config)),
    name: `${config.name} · 副本`,
    schedule: buildSchedule(
      { enabled: false, mode: 'interval', startAt: '', endAt: '', intervalSeconds: 60, onceAt: '' },
      config.schedule,
    ),
    headerRotation: buildHeaderRotation(
      {
        enabled: config.headerRotation?.enabled === true,
        strategy: config.headerRotation?.strategy || 'round-robin',
        headerIds: config.headerRotation?.headerIds || [],
      },
      config.headerRotation,
    ),
  }
  delete copy.id
  delete copy.createdAt
  delete copy.updatedAt
  createConfig(copy)
  ElMessage.success('已创建配置副本')
}

async function bulkDelete() {
  if (!selectedRows.value.length) return
  const blocked = selectedRows.value.filter((config) => usageCount('configs', config.id))
  const deletable = selectedRows.value.filter((config) => !usageCount('configs', config.id))
  if (!deletable.length) {
    ElMessage.warning('选中的配置都正被任务使用，无法删除')
    return
  }
  try {
    await ElMessageBox.confirm(
      blocked.length
        ? `选中的 ${selectedRows.value.length} 个配置中，${blocked.length} 个正被任务使用将跳过。确认删除其余 ${deletable.length} 个？`
        : `确认删除选中的 ${deletable.length} 个配置？`,
      '批量删除配置',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
    bulkBusy.value = true
    deletable.forEach((config) => removeConfig(config.id))
    clearSelection()
    ElMessage.success('批量删除完成')
  } catch {
    // 用户取消
  } finally {
    bulkBusy.value = false
  }
}

function copyTarget(config) {
  navigator.clipboard?.writeText(config.path || '').then(
    () => ElMessage.success('请求路径已复制'),
    () => ElMessage.warning('复制失败'),
  )
}

function clearFilters() {
  keyword.value = ''
  activeTab.value = 'all'
}
</script>

<template>
  <div class="configs-page">
    <PageHeader
      eyebrow="REQUEST SCHEMAS"
      title="采集配置管理"
      description="定义 API、网页片段、图片、视频采集，以及重试、超时与自动计划。配置与站点解耦，可被多个任务复用。"
    >
      <template #actions>
        <el-button @click="sniffVisible = true">
          <el-icon><Connection /></el-icon>
          接口嗅探
        </el-button>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建配置
        </el-button>
      </template>
    </PageHeader>

    <div class="stats-grid">
      <StatCard label="采集配置" :value="store.configs.length" unit="套" :hint="`${linkedTaskCount} 个任务正在使用配置`" :icon="SetUp" tone="indigo" />
      <StatCard label="自动采集" :value="autoConfigCount" unit="套" hint="启用自动计划的配置" :icon="CircleCheck" tone="teal" />
      <StatCard label="HTML 规则" :value="htmlConfigCount" unit="套" hint="依赖站点页面规则" :icon="SetUp" tone="amber" />
      <StatCard label="关联任务" :value="linkedTaskCount" unit="个" hint="配置与任务解耦复用" :icon="CopyDocument" tone="green" />
    </div>

    <section class="data-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>配置目录</h2>
          <p>{{ linkedTaskCount }} 个任务正在使用配置 · {{ autoConfigCount }} 套自动计划 · 共 {{ store.configs.length }} 套</p>
        </div>
        <div class="toolbar-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            :class="{ 'is-active': activeTab === tab.key }"
            @click="activeTab = tab.key"
          >
            {{ tab.label }} <span>{{ tab.count }}</span>
          </button>
        </div>
      </div>

      <div class="toolbar-filters">
        <el-input v-model="keyword" class="filter-search" clearable placeholder="搜索配置名称、请求路径或数据路径">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <div class="filter-spacer" />
        <span class="filter-result">筛选结果 <strong>{{ filteredConfigs.length }}</strong> 条</span>
      </div>

      <BulkActionBar
        :count="selectedRows.length"
        noun="配置"
        :busy="bulkBusy"
        @delete="bulkDelete"
        @clear="clearSelection"
      />

      <div class="table-wrap desktop-table">
        <el-table
          ref="tableRef"
          :data="pagedConfigs"
          class="cf-table"
          table-layout="fixed"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="42" />
          <el-table-column label="配置名称" min-width="210">
            <template #default="{ row }">
              <div class="entity-cell">
                <span class="entity-avatar is-soft"><el-icon><SetUp /></el-icon></span>
                <div class="entity-copy">
                  <span class="entity-name">{{ row.name }}</span>
                  <span class="entity-sub">{{ row.description || '暂无描述' }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="请求方式" width="98">
            <template #default="{ row }"><span class="method-badge" :class="{ 'is-post': row.method !== 'GET' }">{{ row.method }}</span></template>
          </el-table-column>
          <el-table-column label="请求路径" min-width="160">
            <template #default="{ row }">
              <div class="copy-value">
                <span class="code-text" :title="row.path">{{ row.path }}</span>
                <button class="copy-btn" type="button" title="复制请求路径" @click="copyTarget(row)"><el-icon><CopyDocument /></el-icon></button>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="响应解析" min-width="145">
            <template #default="{ row }">
              <span class="type-tag" :class="RESPONSE_META[row.responseType]?.tag">{{ RESPONSE_META[row.responseType]?.label || row.responseType }}</span>
              <span class="entity-sub">{{ responseHint(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="采集策略" min-width="160">
            <template #default="{ row }">
              <span class="entity-sub">{{ executionLabel(row) }}</span>
              <span class="soft-chip" :class="{ 'is-empty': !normalizeSchedule(row).enabled }">{{ normalizeSchedule(row).enabled ? scheduleSummary(row) : '仅手动' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="关联任务" width="90">
            <template #default="{ row }"><span class="soft-chip" :class="{ 'is-empty': !usageCount('configs', row.id) }">{{ usageCount('configs', row.id) }} 个任务</span></template>
          </el-table-column>
          <el-table-column label="最近更新" width="125">
            <template #default="{ row }"><span class="entity-sub">{{ fromNow(row.updatedAt) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="130" align="right">
            <template #default="{ row }">
              <div class="action-cluster">
                <button class="row-action" type="button" title="编辑配置" @click="openEdit(row)"><el-icon><EditPen /></el-icon></button>
                <button class="row-action" type="button" title="复制配置" @click="duplicateConfig(row)"><el-icon><CopyDocument /></el-icon></button>
                <button class="row-action is-danger" type="button" title="删除配置" @click="deleteConfig(row)"><el-icon><Delete /></el-icon></button>
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <EmptyState
              :icon="SetUp"
              :title="store.configs.length ? '没有匹配的采集配置' : '还没有采集配置'"
              :description="store.configs.length ? '换个关键词或切换类型筛选。' : '创建第一个配置，定义请求与解析规则。'"
            >
              <el-button v-if="store.configs.length" @click="clearFilters">清除筛选</el-button>
              <el-button v-else type="primary" @click="openCreate">新建配置</el-button>
            </EmptyState>
          </template>
        </el-table>
      </div>

      <div class="table-footer">
        <span class="footer-summary">共 <strong>{{ filteredConfigs.length }}</strong> 条记录</span>
        <el-pagination v-model:current-page="page" :page-size="pageSize" :total="filteredConfigs.length" layout="prev, pager, next" background hide-on-single-page />
      </div>
    </section>

    <SniffDialog
      v-model="sniffVisible"
      @generated="({ config }) => {
        sniffVisible = false
        if (config) openEdit(config)
      }"
    />

    <el-dialog
      v-model="dialogVisible"
      class="cf-dialog config-dialog"
      width="min(760px, 96vw)"
      :close-on-click-modal="false"
      append-to-body
    >
      <template #header>
        <div class="dialog-heading">
          <span class="dialog-heading-icon"><el-icon><SetUp /></el-icon></span>
          <div class="dialog-heading-copy">
            <h3>{{ editingConfig ? '编辑采集配置' : '新建采集配置' }}</h3>
            <p>定义如何发起请求，以及如何从响应中提取记录。</p>
          </div>
        </div>
      </template>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent>
        <section class="form-section">
          <div class="form-section-head"><span class="section-index">01</span><h4>基础信息</h4><span class="section-note">名称与请求方式</span></div>
          <div class="form-grid">
            <el-form-item class="span-2" label="配置名称" prop="name"><el-input v-model="form.name" maxlength="30" placeholder="例如 商品列表 · 标准" /></el-form-item>
            <el-form-item label="请求方式">
              <el-select v-model="form.method">
                <el-option v-for="method in ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']" :key="method" :label="method" :value="method" />
              </el-select>
            </el-form-item>
            <el-form-item class="span-2" label="响应类型">
              <div class="segmented-control">
                <button
                  v-for="type in [
                    { value: 'json', label: 'JSON' },
                    { value: 'html', label: 'HTML' },
                    { value: 'web', label: '网页片段' },
                    { value: 'image', label: '图片' },
                    { value: 'video', label: '视频' },
                    { value: 'link', label: '链接' },
                    { value: 'xhr', label: 'XHR' },
                    { value: 'jsonp', label: 'JSONP' },
                    { value: 'text', label: '纯文本' },
                  ]"
                  :key="type.value"
                  type="button"
                  :class="{ 'is-active': form.responseType === type.value }"
                  @click="form.responseType = type.value"
                >
                  {{ type.label }}
                </button>
              </div>
            </el-form-item>
            <el-form-item class="span-2" label="请求路径" prop="path">
              <el-input v-model="form.path" placeholder="/products 或 /api/v1/items"><template #prefix><span class="input-prefix-path">PATH</span></template></el-input>
            </el-form-item>
            <el-form-item class="span-2" label="响应数据路径">
              <el-input v-model="form.dataPath" :disabled="!['json', 'xhr', 'jsonp'].includes(form.responseType)" placeholder="例如 data.items 或 products；留空则解析完整响应">
                <template #prefix><span class="input-prefix-path">PATH</span></template>
              </el-input>
            </el-form-item>

            <template v-if="form.responseType === 'web'">
              <el-form-item class="span-2" label="片段条目选择器（可选）"><el-input v-model="form.fragmentItemSelector" placeholder="留空则抓取当前页面整体" /></el-form-item>
              <el-form-item class="span-2" label="片段字段"><FragmentFieldsEditor v-model="form.fragmentFields" /></el-form-item>
            </template>

            <template v-else-if="['image', 'video'].includes(form.responseType)">
              <el-form-item label="最多采集条数"><el-input-number v-model="form.mediaMaxItems" :min="1" :max="2000" :step="50" controls-position="right" /></el-form-item>
              <el-form-item label="是否采集资源"><el-switch v-model="form.mediaCollectResource" active-text="下载资源" inactive-text="仅记录地址" /></el-form-item>
            </template>

            <template v-else-if="form.responseType === 'link'">
              <el-form-item label="链接选择器"><el-input v-model="form.linkSelector" placeholder="a[href]" /></el-form-item>
              <el-form-item label="最多采集条数"><el-input-number v-model="form.linkMaxItems" :min="1" :max="2000" :step="50" controls-position="right" /></el-form-item>
              <el-form-item class="span-2" label="链接包含（可选）"><el-input v-model="form.linkUrlContains" placeholder="例如 /article/；留空不限制" /></el-form-item>
              <el-form-item class="span-2" label="链接排除（可选）"><el-input v-model="form.linkUrlContainsNot" placeholder="例如 /login 或 javascript:" /></el-form-item>
              <el-form-item label="同站链接"><el-switch v-model="form.linkSameOrigin" /></el-form-item>
              <el-form-item label="链接去重"><el-switch v-model="form.linkDedupe" /></el-form-item>
            </template>

            <template v-if="['link', 'xhr'].includes(form.responseType)">
              <el-form-item label="JS 动态加载"><el-switch v-model="form.dynamicEnabled" active-text="浏览器渲染" inactive-text="普通请求" /></el-form-item>
              <el-form-item v-if="form.dynamicEnabled" label="渲染等待（毫秒）"><el-input-number v-model="form.dynamicWaitMs" :min="300" :max="10000" :step="200" controls-position="right" /></el-form-item>
              <el-form-item v-if="form.dynamicEnabled && form.responseType === 'xhr'" class="span-2" label="XHR 地址包含（可选）"><el-input v-model="form.xhrUrlContains" placeholder="例如 /api/list；留空捕获全部 XHR/Fetch" /></el-form-item>
            </template>

            <el-form-item v-if="!['GET', 'HEAD'].includes(form.method)" class="span-2" label="请求体"><el-input v-model="form.body" type="textarea" :rows="3" resize="none" placeholder='可选，例如 {"keyword":"desk","page":1}' /></el-form-item>
            <el-form-item class="span-2" label="配置说明"><el-input v-model="form.description" type="textarea" :rows="2" maxlength="80" placeholder="说明这套配置的用途（可选）" /></el-form-item>
          </div>
          <p class="form-hint"><el-icon><InfoFilled /></el-icon>字段选择器会在每个条目内部查找；选择器留空时直接读取条目本身。</p>
        </section>

        <section v-if="['web', 'image', 'video', 'link'].includes(form.responseType)" class="form-section">
          <div class="form-section-head"><span class="section-index">02</span><h4>翻页采集</h4><span class="section-note">页码参数 / 下一页链接</span></div>
          <div class="form-grid">
            <el-form-item label="翻页方式">
              <el-select v-model="form.paginationMode">
                <el-option label="只采集单页" value="none" />
                <el-option label="页码参数" value="pageParam" />
                <el-option label="跟随下一页链接" value="nextLink" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="form.paginationMode === 'pageParam'" label="分页参数名"><el-input v-model="form.paginationParam" placeholder="page" /></el-form-item>
            <el-form-item v-if="form.paginationMode === 'pageParam'" label="起始页"><el-input-number v-model="form.paginationStartPage" :min="1" :max="500" controls-position="right" /></el-form-item>
            <el-form-item v-if="form.paginationMode !== 'none'" label="最大页数"><el-input-number v-model="form.paginationMaxPages" :min="1" :max="50" controls-position="right" /></el-form-item>
            <el-form-item v-if="form.paginationMode === 'nextLink'" class="span-2" label="下一页选择器"><el-input v-model="form.paginationNextSelector" placeholder="例如 a.next-page" /></el-form-item>
          </div>
          <p class="form-hint"><el-icon><InfoFilled /></el-icon>页码分页会按并发数请求多页；下一页链接模式会读取当前页 DOM 并顺序跟随。</p>
        </section>

        <section class="form-section">
          <div class="form-section-head"><span class="section-index">03</span><h4>执行策略</h4><span class="section-note">重试 / 超时 / 并发 / Header 轮换</span></div>
          <div class="form-grid">
            <el-form-item label="失败重试次数"><el-input-number v-model="form.retryCount" :min="0" :max="10" controls-position="right" /></el-form-item>
            <el-form-item label="请求超时（秒）"><el-input-number v-model="form.timeoutSeconds" :min="1" :max="60" controls-position="right" /></el-form-item>
            <el-form-item label="并发数"><el-input-number v-model="form.concurrency" :min="1" :max="10" controls-position="right" /></el-form-item>
            <el-form-item label="启用 Header 轮换"><el-switch v-model="form.headerRotationEnabled" /></el-form-item>
            <template v-if="form.headerRotationEnabled">
              <el-form-item label="轮换方式">
                <el-select v-model="form.headerRotationStrategy">
                  <el-option label="按顺序轮换" value="round-robin" />
                  <el-option label="随机选择" value="random" />
                </el-select>
              </el-form-item>
              <el-form-item class="span-2" label="轮换 Header 模板">
                <el-select v-model="form.headerRotationHeaderIds" multiple collapse-tags filterable placeholder="选择多个 Header 模板">
                  <el-option v-for="item in store.headers" :key="item.id" :label="item.name" :value="item.id" />
                </el-select>
              </el-form-item>
            </template>
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head"><span class="section-index">04</span><h4>自动采集</h4><span class="section-note">时间段循环 / 单次定时</span></div>
          <div class="toggle-row">
            <div><strong>启用自动计划</strong><span>计划运行依赖浏览器页面保持打开</span></div>
            <el-switch v-model="form.scheduleEnabled" />
          </div>
          <template v-if="form.scheduleEnabled">
            <div class="form-grid">
              <el-form-item label="计划类型">
                <el-select v-model="form.scheduleMode">
                  <el-option label="按时间段循环" value="interval" />
                  <el-option label="单次定时" value="once" />
                </el-select>
              </el-form-item>
              <el-form-item v-if="form.scheduleMode === 'once'" label="执行时间">
                <el-date-picker v-model="form.scheduleOnceAt" type="datetime" format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" />
              </el-form-item>
              <template v-else>
                <el-form-item label="开始时间"><el-date-picker v-model="form.scheduleStartAt" type="datetime" format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" /></el-form-item>
                <el-form-item label="结束时间"><el-date-picker v-model="form.scheduleEndAt" type="datetime" format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" /></el-form-item>
                <el-form-item label="间隔时间（秒）"><el-input-number v-model="form.scheduleIntervalSeconds" :min="1" :max="86400" controls-position="right" /></el-form-item>
              </template>
            </div>
            <div class="schedule-preview">
              <strong>{{ schedulePreviewTitle }}</strong>
              <span>{{ schedulePreviewDetail }}</span>
            </div>
          </template>
        </section>

        <section class="form-section">
          <div class="form-section-head"><span class="section-index">05</span><h4>请求预览</h4><span class="section-note">最终地址由站点与路径拼接</span></div>
          <div class="request-preview">
            <div class="preview-head"><span class="preview-label"><el-icon><SetUp /></el-icon>解析规则</span><span class="preview-state">{{ RESPONSE_META[form.responseType]?.label }}</span></div>
            <div class="request-url">{{ form.method }} · {{ form.path || '/path' }}</div>
            <div class="preview-meta">
              <span class="method-badge" :class="{ 'is-post': !['GET', 'HEAD'].includes(form.method) }">{{ form.method }}</span>
              <span class="soft-chip is-accent">{{ responseHint({ ...form, fragmentRule: { fields: form.fragmentFields }, linkRule: { selector: form.linkSelector, maxItems: form.linkMaxItems }, media: { maxItems: form.mediaMaxItems, collectResource: form.mediaCollectResource }, dynamic: { enabled: form.dynamicEnabled } }) }}</span>
            </div>
          </div>
        </section>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">{{ editingConfig ? `${configTaskCount} 个任务正在使用该配置` : '配置保存后可被多个任务复用' }}</span>
          <div class="dialog-footer-actions">
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" :loading="saving" @click="saveConfig">{{ editingConfig ? '保存修改' : '创建配置' }}</el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
