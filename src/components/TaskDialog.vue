<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, Collection, InfoFilled, Link, Plus } from '@element-plus/icons-vue'
import { createTask, store, updateTask } from '../stores/collector'
import { hostOf, localDateTime } from '../utils/format'
import { resolveEndpoint } from '../utils/collector'
import { listCount, listRowsOf, resolveParamValue } from '../utils/params'
import { normalizeHeaderRotation } from '../utils/schedule'
import { apiRequest } from '../services/api'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  task: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue', 'saved'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const formRef = ref(null)
const form = reactive(createEmptyForm())
const siteSessions = ref([])
const siteSessionsLoading = ref(false)
const riskProfiles = ref([])
const riskProfilesLoading = ref(false)

async function loadSiteSessions(siteId) {
  siteSessions.value = []
  if (!siteId) return
  siteSessionsLoading.value = true
  riskProfilesLoading.value = true
  try {
    const [sessionPayload, riskPayload] = await Promise.all([
      apiRequest(`/api/site-sessions?siteId=${encodeURIComponent(siteId)}`),
      apiRequest('/api/risk/profiles'),
    ])
    siteSessions.value = (sessionPayload.items || []).filter(
      (item) => item.status === 'active',
    )
    riskProfiles.value = (riskPayload.items || []).filter(
      (item) => item.enabled && (!item.siteId || item.siteId === siteId),
    )
    if (
      form.siteSessionId &&
      !siteSessions.value.some((item) => item.id === form.siteSessionId)
    ) {
      form.siteSessionId = ''
    }
    if (
      form.riskProfileId &&
      !riskProfiles.value.some((item) => item.id === form.riskProfileId)
    ) {
      form.riskProfileId = ''
    }
  } catch {
    siteSessions.value = []
    riskProfiles.value = []
  } finally {
    siteSessionsLoading.value = false
    riskProfilesLoading.value = false
  }
}

function defaultCollectAt() {
  const date = new Date(Date.now() + 5 * 60 * 1000)
  date.setSeconds(0, 0)
  return localDateTime(date)
}

function firstId(collection, predicate = () => true) {
  return collection.find(predicate)?.id || ''
}

function createEmptyForm() {
  return {
    name: '',
    description: '',
    siteId: '',
    configId: '',
    headerId: '',
    paramId: '',
    storageId: '',
    siteSessionId: '',
    riskProfileId: '',
    collectAt: defaultCollectAt(),
    iterationEnabled: false,
    iterationRowId: '',
  }
}

const rules = {
  name: [
    { required: true, message: '请填写采集名称', trigger: 'blur' },
    { max: 32, message: '名称不能超过 32 个字符', trigger: 'blur' },
  ],
  siteId: [{ required: true, message: '请选择采集站点', trigger: 'change' }],
  configId: [{ required: true, message: '请选择采集配置', trigger: 'change' }],
  storageId: [{ required: true, message: '请选择关联存储', trigger: 'change' }],
  collectAt: [{ required: true, message: '请选择采集时间', trigger: 'change' }],
}

const site = computed(() => store.sites.find((item) => item.id === form.siteId))
const config = computed(() => store.configs.find((item) => item.id === form.configId))
const header = computed(() => store.headers.find((item) => item.id === form.headerId))
const param = computed(() => store.params.find((item) => item.id === form.paramId))
const storage = computed(() => store.storages.find((item) => item.id === form.storageId))
const missingResources = computed(() => {
  const missing = []
  if (!store.sites.length) missing.push('采集站点')
  if (!store.configs.length) missing.push('采集配置')
  if (!store.storages.length) missing.push('关联存储')
  return missing
})
const htmlMode = computed(() => config.value?.responseType === 'html')
const webMode = computed(() => config.value?.responseType === 'web')
const mediaMode = computed(() => ['image', 'video'].includes(config.value?.responseType))
const fragmentFieldCount = computed(
  () =>
    (config.value?.fragmentRule?.fields || []).filter(
      (field) => field.enabled !== false && field.key?.trim(),
    ).length,
)
const headerRotation = computed(() => normalizeHeaderRotation(config.value))
const pagination = computed(() => config.value?.pagination || null)
const pageRuleReady = computed(() => {
  const rule = site.value?.pageRule
  return Boolean(
    rule?.enabled &&
      rule.itemSelector?.trim() &&
      (rule.fields || []).some((field) => field.enabled !== false && field.key?.trim()),
  )
})

const enabledHeaderCount = computed(
  () => (header.value?.rows || []).filter((row) => row.enabled !== false && row.key?.trim()).length,
)
const enabledParamCount = computed(
  () => (param.value?.rows || []).filter((row) => row.enabled !== false && row.key?.trim()).length,
)
const availableListRows = computed(() => listRowsOf(param.value))
const selectedIterationRow = computed(() =>
  availableListRows.value.find((row) => row.id === form.iterationRowId),
)
const iterationCursor = computed(() => {
  if (!props.task?.iteration || props.task.iteration.rowId !== form.iterationRowId) return 0
  return Math.max(Number(props.task.iteration.cursor) || 0, 0)
})
const iterationTotal = computed(() => listCount(selectedIterationRow.value))

const requestPreview = computed(() => {
  if (!site.value || !config.value) {
    return { url: '选择采集站点与配置后，将在这里生成完整请求地址', ready: false }
  }
  try {
    const endpoint = resolveEndpoint(site.value.baseUrl, config.value.path)
    const url = new URL(endpoint)
    const iteration =
      form.iterationEnabled && form.iterationRowId
        ? { rowId: form.iterationRowId, index: iterationCursor.value }
        : null
    ;(param.value?.rows || [])
      .filter((row) => row.enabled !== false && row.key?.trim())
      .forEach((row) => {
        const value = resolveParamValue(row, {
          now: new Date(),
          iterationRowId: iteration?.rowId,
          iterationIndex: iteration?.index,
        })
        url.searchParams.set(row.key.trim(), value)
      })
    return { url: url.toString(), ready: true }
  } catch (error) {
    return { url: error.message || '请求地址无法生成', ready: false }
  }
})

const storageTypeLabel = computed(
  () => ({ json: 'JSON', csv: 'CSV', db: 'DB' })[storage.value?.type] || '—',
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    if (props.task) {
      Object.assign(form, createEmptyForm(), {
        name: props.task.name || '',
        description: props.task.description || '',
        siteId: props.task.siteId || '',
        configId: props.task.configId || '',
        headerId: props.task.headerId || '',
        paramId: props.task.paramId || '',
        storageId: props.task.storageId || '',
        siteSessionId: props.task.siteSessionId || '',
        riskProfileId: props.task.riskProfileId || '',
        collectAt: props.task.collectAt || defaultCollectAt(),
        iterationEnabled: Boolean(props.task.iteration?.enabled),
        iterationRowId: props.task.iteration?.rowId || '',
      })
    } else {
      Object.assign(form, createEmptyForm(), {
        siteId: firstId(store.sites, (item) => item.enabled !== false),
        configId: firstId(store.configs),
        headerId: firstId(store.headers),
        paramId: firstId(store.params),
        storageId: firstId(store.storages),
      })
    }
    void loadSiteSessions(form.siteId)
    nextTick(() => formRef.value?.clearValidate())
  },
)

watch(
  () => form.siteId,
  (siteId, previous) => {
    if (!props.modelValue || siteId === previous) return
    void loadSiteSessions(siteId)
  },
)

watch(
  () => form.paramId,
  () => {
    if (!form.iterationEnabled) return
    if (!availableListRows.value.some((row) => row.id === form.iterationRowId)) {
      form.iterationRowId = availableListRows.value[0]?.id || ''
    }
  },
)

function toggleIteration(value) {
  if (value && !form.iterationRowId) {
    form.iterationRowId = availableListRows.value[0]?.id || ''
  }
}

function iterationNextValue() {
  if (!selectedIterationRow.value) return ''
  return resolveParamValue(selectedIterationRow.value, {
    now: new Date(),
    iterationRowId: form.iterationRowId,
    iterationIndex: iterationCursor.value,
  })
}

function setQuickTime(kind) {
  const date = new Date()
  if (kind === 'now') {
    date.setSeconds(0, 0)
  }
  if (kind === 'later') {
    date.setMinutes(date.getMinutes() + 30)
    date.setSeconds(0, 0)
  }
  if (kind === 'tomorrow') {
    date.setDate(date.getDate() + 1)
    date.setHours(9, 0, 0, 0)
  }
  form.collectAt = localDateTime(date)
}

async function submit() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  if (htmlMode.value && !pageRuleReady.value) {
    ElMessage.warning('HTML 页面解析需要站点页面规则；也可以把配置类型改为网页片段、图片或视频采集')
    return
  }
  if (webMode.value && !fragmentFieldCount.value) {
    ElMessage.warning('当前配置使用网页片段采集，请先编辑采集配置添加片段字段')
    return
  }

  if (form.iterationEnabled) {
    if (!availableListRows.value.length) {
      ElMessage.warning('当前参数项中没有可用的列表值，无法启用遍历')
      return
    }
    if (!selectedIterationRow.value) {
      ElMessage.warning('请选择用于遍历的列表参数')
      return
    }
    if (!listCount(selectedIterationRow.value)) {
      ElMessage.warning('遍历列表为空，请先在参数项中填写列表值')
      return
    }
  }

  const duplicate = store.tasks.some(
    (item) => item.id !== props.task?.id && item.name.trim() === form.name.trim(),
  )
  if (duplicate) {
    ElMessage.warning('已存在同名采集任务，请换一个名称')
    return
  }

  const payload = {
    name: form.name.trim(),
    description: form.description.trim(),
    siteId: form.siteId,
    configId: form.configId,
    headerId: form.headerId || '',
    paramId: form.paramId || '',
    storageId: form.storageId,
    siteSessionId: form.siteSessionId || '',
    riskProfileId: form.riskProfileId || '',
    collectAt: form.collectAt,
    iteration:
      form.iterationEnabled && form.iterationRowId
        ? {
            enabled: true,
            rowId: form.iterationRowId,
            cursor:
              props.task?.iteration?.rowId === form.iterationRowId
                ? Math.max(Number(props.task.iteration.cursor) || 0, 0)
                : 0,
          }
        : null,
  }

  if (props.task) {
    updateTask(props.task.id, payload)
    ElMessage.success('采集任务已更新')
  } else {
    createTask(payload)
    ElMessage.success('采集任务已创建')
  }
  emit('saved')
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="cf-dialog"
    width="min(760px, 94vw)"
    :close-on-click-modal="false"
    destroy-on-close
    append-to-body
  >
    <template #header>
      <div class="dialog-heading">
        <span class="dialog-heading-icon">
          <el-icon><Collection /></el-icon>
        </span>
        <div class="dialog-heading-copy">
          <h3>{{ task ? '编辑采集任务' : '新建采集任务' }}</h3>
          <p>{{ task ? '调整关联资源与执行参数，保存后立即生效。' : '将站点、配置、请求头、参数与存储组合成一条可执行任务。' }}</p>
        </div>
      </div>
    </template>

    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent>
      <div v-if="missingResources.length" class="form-callout">
        <el-icon><InfoFilled /></el-icon>
        <span>
          还缺少{{ missingResources.join('、') }}，请先在左侧对应栏目中创建，再回来新建采集任务。
        </span>
      </div>
      <section class="form-section">
        <div class="form-section-head">
          <span class="section-index">01</span>
          <h4>基础信息</h4>
          <span class="section-note">任务标识与执行时间</span>
        </div>
        <div class="form-grid">
          <el-form-item label="采集名称" prop="name">
            <el-input v-model="form.name" maxlength="32" placeholder="例如 每日商品快照" />
          </el-form-item>
          <el-form-item label="采集时间" prop="collectAt">
            <el-date-picker
              v-model="form.collectAt"
              type="datetime"
              value-format="YYYY-MM-DD HH:mm:ss"
              placeholder="填写或选择采集时间"
              :clearable="false"
            />
          </el-form-item>
          <div class="span-2 quick-times">
            <button class="quick-chip" type="button" @click="setQuickTime('now')">现在</button>
            <button class="quick-chip" type="button" @click="setQuickTime('later')">30 分钟后</button>
            <button class="quick-chip" type="button" @click="setQuickTime('tomorrow')">明天 09:00</button>
          </div>
          <el-form-item class="span-2" label="任务备注">
            <el-input
              v-model="form.description"
              maxlength="80"
              placeholder="一句话说明本任务的采集目的（可选）"
            />
          </el-form-item>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head">
          <span class="section-index">02</span>
          <h4>关联采集资源</h4>
          <span class="section-note">站点与配置必选，Header 与参数可选</span>
        </div>
        <div class="form-grid">
          <el-form-item label="采集站点" prop="siteId">
            <el-select v-model="form.siteId" filterable placeholder="选择数据源站点">
              <el-option
                v-for="item in store.sites"
                :key="item.id"
                :value="item.id"
                :label="item.name"
              >
                <div class="select-option">
                  <span>{{ item.name }}<em v-if="!item.enabled"> · 已停用</em></span>
                  <small>{{ hostOf(item.baseUrl) }}</small>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="采集配置" prop="configId">
            <el-select v-model="form.configId" filterable placeholder="选择请求与解析配置">
              <el-option
                v-for="item in store.configs"
                :key="item.id"
                :value="item.id"
                :label="item.name"
              >
                <div class="select-option">
                  <span>{{ item.name }}</span>
                  <small>{{ item.method }} · {{ item.path }}</small>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="采集 Header">
            <el-select v-model="form.headerId" filterable clearable placeholder="不关联请求头">
              <el-option
                v-for="item in store.headers"
                :key="item.id"
                :value="item.id"
                :label="item.name"
              >
                <div class="select-option">
                  <span>{{ item.name }}</span>
                  <small>{{ (item.rows || []).filter((row) => row.enabled !== false).length }} 个字段</small>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="站点登录态">
            <el-select
              v-model="form.siteSessionId"
              clearable
              filterable
              :loading="siteSessionsLoading"
              placeholder="不关联登录 Cookie"
            >
              <el-option
                v-for="item in siteSessions"
                :key="item.id"
                :value="item.id"
                :label="item.name"
              >
                <div class="select-option">
                  <span>{{ item.name }}</span>
                  <small>{{ item.type }} · {{ item.expiresAt || '长期有效' }}</small>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="风控方案">
            <el-select
              v-model="form.riskProfileId"
              clearable
              filterable
              :loading="riskProfilesLoading"
              placeholder="不启用风控处理"
            >
              <el-option
                v-for="item in riskProfiles"
                :key="item.id"
                :value="item.id"
                :label="item.name"
              >
                <div class="select-option">
                  <span>{{ item.name }}</span>
                  <small>{{ item.riskType }} · {{ item.strategy }}</small>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="采集参数">
            <el-select v-model="form.paramId" filterable clearable placeholder="不关联请求参数">
              <el-option
                v-for="item in store.params"
                :key="item.id"
                :value="item.id"
                :label="item.name"
              >
                <div class="select-option">
                  <span>{{ item.name }}</span>
                  <small>{{ (item.rows || []).filter((row) => row.enabled !== false).length }} 个参数</small>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item class="span-2" label="关联存储" prop="storageId">
            <el-select v-model="form.storageId" filterable placeholder="选择采集结果写入位置">
              <el-option
                v-for="item in store.storages"
                :key="item.id"
                :value="item.id"
                :label="item.name"
              >
                <div class="select-option">
                  <span>{{ item.name }}</span>
                  <small>{{ item.type.toUpperCase() }} · {{ item.target }}</small>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
        </div>
      </section>

      <section v-if="availableListRows.length" class="form-section">
        <div class="form-section-head">
          <span class="section-index">03</span>
          <h4>列表遍历</h4>
          <span class="section-note">每次采集使用列表中的下一个值</span>
        </div>
        <div class="toggle-row">
          <div>
            <strong>启用列表遍历</strong>
            <span>成功后自动前进，遍历完成后停止；失败时保留当前项</span>
          </div>
          <el-switch v-model="form.iterationEnabled" @change="toggleIteration" />
        </div>
        <div v-if="form.iterationEnabled" class="form-grid">
          <el-form-item class="span-2" label="遍历参数">
            <el-select v-model="form.iterationRowId" placeholder="选择一个列表参数">
              <el-option
                v-for="row in availableListRows"
                :key="row.id"
                :value="row.id"
                :label="row.key"
              >
                <div class="select-option">
                  <span>{{ row.key }}</span>
                  <small>{{ listCount(row) }} 个值</small>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <div class="span-2 iteration-preview">
            <div>
              <span>当前进度</span>
              <strong>{{ Math.min(iterationCursor, iterationTotal) }} / {{ iterationTotal }}</strong>
            </div>
            <div>
              <span>下一个值</span>
              <strong class="mono-text">{{ iterationNextValue() || '遍历完成' }}</strong>
            </div>
            <div>
              <span>遍历完成后</span>
              <strong>停止</strong>
            </div>
          </div>
        </div>
        <p class="form-hint">
          <el-icon><InfoFilled /></el-icon>
          一个任务同时只使用一个列表作为遍历驱动；其他列表参数默认取第一项。
        </p>
      </section>

      <section class="form-section">
        <div class="form-section-head">
          <span class="section-index">04</span>
          <h4>请求预览</h4>
          <span class="section-note">保存前检查请求组合</span>
        </div>
        <div class="request-preview">
          <div class="preview-head">
            <span class="preview-label">
              <el-icon><Link /></el-icon>
              即将发起的请求
            </span>
            <span class="preview-state">{{ requestPreview.ready ? 'READY TO COLLECT' : 'WAITING FOR CONFIG' }}</span>
          </div>
          <div class="request-url">{{ requestPreview.url }}</div>
          <div class="preview-meta">
            <span
              class="method-badge"
              :class="{ 'is-post': !['GET', 'HEAD'].includes(config?.method || 'GET') }"
            >{{ config?.method || 'GET' }}</span>
            <span class="soft-chip is-accent">{{ header?.name || '无 Header' }} · {{ enabledHeaderCount }}</span>
            <span v-if="headerRotation.enabled" class="soft-chip is-accent">
              Header 轮换 · {{ headerRotation.headerIds.length }}
            </span>
            <span class="soft-chip is-accent">{{ param?.name || '无参数' }} · {{ enabledParamCount }}</span>
            <span class="soft-chip">{{ storage ? `${storageTypeLabel} · ${storage.name}` : '未选择存储' }}</span>
            <span v-if="form.iterationEnabled" class="soft-chip is-accent">
              遍历 · {{ selectedIterationRow?.key || '未选择' }} ·
              {{ Math.min(iterationCursor, iterationTotal) }}/{{ iterationTotal }}
            </span>
            <span
              v-if="htmlMode"
              class="soft-chip"
              :class="pageRuleReady ? 'is-accent' : 'is-empty'"
            >
              {{ pageRuleReady ? 'HTML · 站点页面规则已就绪' : 'HTML · 缺少站点页面规则' }}
            </span>
            <span
              v-else-if="webMode"
              class="soft-chip"
              :class="fragmentFieldCount ? 'is-accent' : 'is-empty'"
            >
              网页片段 · {{ fragmentFieldCount }} 个字段
            </span>
            <span v-else-if="mediaMode" class="soft-chip is-accent">
              {{ config?.responseType === 'image' ? '图片' : '视频' }} · 自动提取地址
            </span>
            <span
              v-if="pagination && pagination.mode !== 'none'"
              class="soft-chip is-accent"
            >
              翻页 · 最多 {{ pagination.maxPages }} 页
            </span>
          </div>
        </div>
        <p class="form-hint">
          <el-icon><InfoFilled /></el-icon>
          <template v-if="htmlMode">
            HTML 模式经服务端代理抓取页面，并应用采集站点中配置的 CSS 选择器、字段映射与分页规则。
          </template>
          <template v-else-if="webMode">
            网页片段模式使用配置中的 CSS 字段映射提取内容，不依赖站点页面规则。
          </template>
          <template v-else-if="mediaMode">
            图片 / 视频模式会自动解析页面中的资源地址并去重，采集结果可写入 JSON / CSV 存储。
          </template>
          <template v-else>
            采集经本地服务端代理转发，可携带 Referer、User-Agent 等受限 Header，不受浏览器 CORS 限制；请保持代理服务运行。
          </template>
        </p>
      </section>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <span class="dialog-footer-hint">保存后可在列表中点击「采集」立即运行</span>
        <div class="dialog-footer-actions">
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" @click="submit">
            <el-icon><Plus v-if="!task" /><Check v-else /></el-icon>
            {{ task ? '保存修改' : '创建任务' }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>
