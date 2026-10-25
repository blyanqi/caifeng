<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Connection, InfoFilled, Search } from '@element-plus/icons-vue'
import { apiRequest } from '../services/api'
import { canWrite } from '../services/auth'
import {
  createConfig,
  createHeader,
  createParam,
  createSite,
  createStorage,
  createTask,
  store,
} from '../stores/collector'
import { localDateTime, uid } from '../utils/format'
import { buildSchedule } from '../utils/schedule'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'generated'])

const pageUrl = ref('')
const waitMs = ref(5000)
const sessionId = ref('')
const sessions = ref([])
const loading = ref(false)
const generated = ref(false)
const candidates = ref([])
const selected = ref(null)
const pageInfo = ref(null)
const createTaskAfterSave = ref(true)
const writable = ref(false)

const previewColumns = computed(() => (selected.value?.fields || []).slice(0, 8))

const selectedParams = computed(() => selected.value?.params || [])

function resetResult() {
  candidates.value = []
  selected.value = null
  pageInfo.value = null
  generated.value = false
}

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) resetResult()
  },
)

async function loadSessions() {
  try {
    const payload = await apiRequest('/api/site-sessions')
    sessions.value = (payload.items || []).filter((item) => item.status === 'active')
  } catch {
    sessions.value = []
  }
}

async function sniff() {
  if (!pageUrl.value.trim()) return ElMessage.warning('请填写网页地址')
  loading.value = true
  resetResult()
  try {
    const payload = await apiRequest('/api/sniff', {
      method: 'POST',
      body: {
        url: pageUrl.value.trim(),
        waitMs: Math.min(Math.max(Number(waitMs.value) || 5000, 1000), 15000),
        siteSessionId: sessionId.value || undefined,
      },
    })
    pageInfo.value = payload.page
    candidates.value = payload.candidates || []
    selected.value = candidates.value[0] || null
    if (!candidates.value.length) {
      ElMessage.warning('页面加载完成，但没有发现可解析的数据接口')
    }
  } catch (error) {
    ElMessage.error(error.message || '网页接口嗅探失败')
  } finally {
    loading.value = false
  }
}

function selectCandidate(candidate) {
  selected.value = candidate
  generated.value = false
}

function hostOf(value) {
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

function sanitize(value, fallback = 'data') {
  const text = String(value || '')
    .replace(/^https?:\/\//i, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
  return text || fallback
}

function uniqueName(base) {
  let name = base
  let index = 2
  while (store.configs.some((config) => config.name === name)) {
    name = `${base} ${index}`
    index += 1
  }
  return name
}

function generate() {
  if (!selected.value) return
  if (!writable.value) return ElMessage.warning('当前账号没有创建配置的权限')
  const candidate = selected.value
  const host = hostOf(candidate.origin)
  const baseName = `${host} · ${candidate.dataPath || '数据接口'}`
  const site =
    store.sites.find((item) => {
      try {
        return new URL(item.baseUrl).origin === candidate.origin
      } catch {
        return false
      }
    }) ||
    createSite({
      name: `${host} 数据接口`,
      baseUrl: candidate.origin,
      description: `由网页接口嗅探自动创建 · ${candidate.pageUrl}`,
      enabled: true,
      pageRule: null,
    })

  const headerName = `${host} · 嗅探请求头`
  let header = store.headers.find((item) => item.name === headerName)
  if (!header) {
    header = createHeader({
      name: headerName,
      description: `Referer: ${candidate.pageUrl}`,
      rows: [
        { id: uid('row'), key: 'Referer', value: candidate.pageUrl, enabled: true },
        {
          id: uid('row'),
          key: 'Accept',
          value: candidate.jsonp ? '*/*' : 'application/json, text/javascript, */*; q=0.01',
          enabled: true,
        },
      ],
    })
  }

  const callbackKey =
    candidate.callbackParam ||
    candidate.params?.find((item) =>
      ['callback', 'cb', 'jsonp', 'jsoncallback'].includes(item.key?.toLowerCase()),
    )?.key ||
    ''
  const paramRows = []
  for (const item of candidate.params || []) {
    if (!item.key) continue
    if (callbackKey && item.key === callbackKey) continue
    if (/^_$|^_t$|^timestamp$/i.test(item.key)) continue
    paramRows.push({
      id: uid('row'),
      key: item.key,
      value: item.value ?? '',
      enabled: true,
      valueType: 'text',
      timestamp: { format: 'unix_ms', timezone: 'local', offsetSeconds: 0 },
      list: { values: [] },
    })
  }
  if (callbackKey) {
    paramRows.push({
      id: uid('row'),
      key: callbackKey,
      value: 'cb',
      enabled: true,
      valueType: 'text',
      timestamp: { format: 'unix_ms', timezone: 'local', offsetSeconds: 0 },
      list: { values: [] },
    })
  }
  const param = paramRows.length
    ? createParam({
        name: `${host} · ${candidate.dataPath || '嗅探参数'}`,
        description: `网页接口嗅探 ${candidate.endpoint}`,
        rows: paramRows,
      })
    : null

  const storageTarget = `data/collections/${sanitize(host)}-${sanitize(candidate.path)}.json`
  const storage = createStorage({
    name: `${host} · ${candidate.dataPath || '嗅探数据'} JSON`,
    type: 'json',
    target: storageTarget,
    description: `网页接口嗅探 · ${candidate.endpoint}`,
    db: null,
  })

  const configSchedule = buildSchedule(
    {
      enabled: false,
      mode: 'interval',
      startAt: '',
      endAt: '',
      intervalSeconds: 60,
      onceAt: '',
    },
    null,
  )
  const config = createConfig({
    name: uniqueName(baseName),
    method: candidate.method || 'GET',
    path: candidate.path,
    responseType: candidate.jsonp ? 'jsonp' : 'xhr',
    dataPath: candidate.dataPath || '',
    body: '',
    fragmentRule: null,
    linkRule: null,
    media: null,
    pagination: null,
    dynamic: null,
    execution: { retryCount: 1, timeoutSeconds: 30, concurrency: 1 },
    headerRotation: { enabled: false, strategy: 'round-robin', headerIds: [], cursor: 0 },
    schedule: configSchedule,
    description: `网页接口嗅探自动生成 · ${candidate.recordCount} 条示例记录`,
    jsonpCallbackParam: callbackKey,
    createdAt: localDateTime(),
    updatedAt: localDateTime(),
  })

  let task = null
  if (createTaskAfterSave.value) {
    task = createTask({
      name: `抓取 ${host} ${candidate.dataPath || '数据接口'}`,
      description: `采集 ${candidate.endpoint}`,
      siteId: site.id,
      configId: config.id,
      headerId: header.id,
      paramId: param?.id || '',
      storageId: storage.id,
      collectAt: localDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    })
  }

  generated.value = true
  ElMessage.success(
    task
      ? `已生成配置和任务，可在采集列表运行`
      : `已生成采集配置，可在配置管理中查看`,
  )
  emit('generated', { config, task, site })
  emit('update:modelValue', false)
}

onMounted(() => {
  writable.value = canWrite()
  loadSessions()
})
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    class="cf-dialog sniff-dialog"
    @update:model-value="(value) => emit('update:modelValue', value)"
    width="min(1080px, 97vw)"
    :close-on-click-modal="false"
    append-to-body
  >
    <template #header>
      <div class="dialog-heading">
        <span class="dialog-heading-icon"><el-icon><Connection /></el-icon></span>
        <div class="dialog-heading-copy">
          <h3>网页接口嗅探</h3>
          <p>输入网页地址，自动发现页面加载过程中请求的 JSON / JSONP 数据接口。</p>
        </div>
      </div>
    </template>

    <div class="sniff-form">
      <el-input
        v-model="pageUrl"
        class="sniff-url"
        placeholder="https://data.eastmoney.com/bkzj/gn.html"
        @keyup.enter="sniff"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-input-number v-model="waitMs" :min="1000" :max="15000" :step="500" controls-position="right" />
      <el-select v-model="sessionId" clearable placeholder="不使用页面登录态" style="width: 190px">
        <el-option v-for="item in sessions" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
      <el-button type="primary" :loading="loading" @click="sniff">
        <el-icon><Connection /></el-icon>
        开始嗅探
      </el-button>
    </div>
    <p class="sniff-hint">
      <el-icon><InfoFilled /></el-icon>
      只捕获页面加载后自动发出的 XHR / Fetch / JSONP；需要点击才发出的接口请先直接使用接口地址。
    </p>

    <div v-if="pageInfo" class="sniff-page-meta">
      页面：<code>{{ pageInfo.finalUrl || pageInfo.url }}</code>
      <span>发现 {{ pageInfo.candidates }} 个候选接口</span>
    </div>

    <div v-if="loading" class="sniff-loading">
      <span class="sniff-pulse" />
      正在启动无头浏览器并监听网络请求…
    </div>

    <div v-else-if="candidates.length" class="sniff-workspace">
      <div class="sniff-list">
        <button
          v-for="candidate in candidates"
          :key="candidate.id"
          type="button"
          class="sniff-candidate"
          :class="{ 'is-active': selected?.id === candidate.id }"
          @click="selectCandidate(candidate)"
        >
          <div class="sniff-candidate-top">
            <span class="soft-chip is-accent">{{ candidate.jsonp ? 'JSONP' : candidate.resourceType }}</span>
            <span class="soft-chip">{{ candidate.recordCount }} 条</span>
            <span class="soft-chip">{{ candidate.status }}</span>
          </div>
          <strong>{{ candidate.path }}</strong>
          <span>{{ hostOf(candidate.origin) }} · {{ candidate.dataPath || '根数组' }}</span>
          <small>{{ candidate.fields.slice(0, 4).join(' / ') }}</small>
        </button>
      </div>

      <div v-if="selected" class="sniff-preview">
        <div class="sniff-preview-head">
          <div>
            <strong>{{ selected.dataPath || '根数组' }}</strong>
            <span>{{ selected.recordCount }} 条 · {{ selected.fields.length }} 个字段</span>
          </div>
          <span class="soft-chip" :class="selected.jsonp ? 'is-accent' : 'is-empty'">
            {{ selected.jsonp ? `JSONP${selected.callbackParam ? ` · ${selected.callbackParam}` : ''}` : 'JSON' }}
          </span>
        </div>
        <div class="sniff-endpoint">
          <code>{{ selected.endpoint }}</code>
          <span>{{ selected.size }} bytes</span>
        </div>
        <div class="table-wrap">
          <el-table :data="selected.sample" class="cf-table" table-layout="fixed" max-height="260">
            <el-table-column
              v-for="field in previewColumns"
              :key="field"
              :label="field"
              min-width="110"
              show-overflow-tooltip
            >
              <template #default="{ row }">{{ row[field] ?? '—' }}</template>
            </el-table-column>
          </el-table>
        </div>
        <div class="sniff-params">
          <span v-for="item in selectedParams.slice(0, 12)" :key="item.key" class="sniff-param">
            <b>{{ item.key }}</b>=<span>{{ item.value }}</span>
          </span>
        </div>
        <div class="sniff-generate">
          <el-checkbox v-model="createTaskAfterSave">同时创建采集任务</el-checkbox>
          <el-button type="primary" @click="generate">生成采集配置</el-button>
        </div>
      </div>
    </div>

    <div v-else-if="pageInfo" class="sniff-empty">
      <el-icon><Search /></el-icon>
      <strong>没有发现数据接口</strong>
      <span>可以增大等待时间，或确认页面需要登录后再试。</span>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <span class="dialog-footer-hint">接口嗅探会复用现有站点、Header、参数、存储与任务体系</span>
        <div class="dialog-footer-actions">
          <el-button @click="emit('update:modelValue', false)">关闭</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>
