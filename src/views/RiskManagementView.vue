<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, EditPen, InfoFilled, Key, Lock, Plus, VideoPlay } from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { apiRequest } from '../services/api'
import { canWrite } from '../services/auth'
import { store } from '../stores/collector'
import { formatDateTime, fromNow } from '../utils/format'

const strategies = [
  { value: 'custom_api', label: '自定义接口' },
  { value: 'browser', label: '浏览器过盾' },
  { value: 'manual', label: '手动 Cookie' },
]

const riskTypes = [
  { value: 'cloudflare', label: 'Cloudflare' },
  { value: 'akamai', label: 'Akamai' },
  { value: 'datadome', label: 'DataDome' },
  { value: 'perimeterx', label: 'PerimeterX' },
  { value: 'custom', label: '自定义风控' },
]

const profiles = ref([])
const jobs = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const editing = ref(null)
const saving = ref(false)
const writable = ref(false)
const form = reactive(emptyForm())
const testVisible = ref(false)
const testProfile = ref(null)
const testUrl = ref('')
const testing = ref(false)
const testResult = ref(null)

const siteName = (id) => store.sites.find((site) => site.id === id)?.name || '未关联站点'
const strategyLabel = (value) =>
  strategies.find((item) => item.value === value)?.label || value

function emptyForm() {
  return {
    name: '',
    siteId: '',
    riskType: 'cloudflare',
    strategy: 'custom_api',
    endpoint: '',
    method: 'POST',
    apiKey: '',
    headersText: '{}',
    requestTemplate: '{"url":"{{url}}","key":"{{api_key}}"}',
    cookiePath: 'data.cookies',
    tokenPath: 'data.token',
    manualCookie: '',
    waitMs: 3000,
    enabled: true,
  }
}

async function load() {
  loading.value = true
  try {
    const [profilePayload, jobPayload] = await Promise.all([
      apiRequest('/api/risk/profiles'),
      apiRequest('/api/risk/jobs?limit=100'),
    ])
    profiles.value = profilePayload.items || []
    jobs.value = jobPayload.items || []
  } catch (error) {
    ElMessage.error(error.message || '风控方案加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, emptyForm())
  dialogVisible.value = true
}

function openEdit(profile) {
  editing.value = profile
  Object.assign(form, {
    name: profile.name,
    siteId: profile.siteId,
    riskType: profile.riskType,
    strategy: profile.strategy,
    endpoint: profile.endpoint,
    method: profile.method,
    apiKey: '',
    headersText: JSON.stringify(profile.headers || {}, null, 2),
    requestTemplate: profile.requestTemplate,
    cookiePath: profile.cookiePath,
    tokenPath: profile.tokenPath,
    manualCookie: '',
    waitMs: profile.waitMs,
    enabled: profile.enabled,
  })
  dialogVisible.value = true
}

async function save() {
  if (!form.name.trim()) return ElMessage.warning('请填写风控方案名称')
  let headers = {}
  try {
    headers = JSON.parse(form.headersText || '{}')
  } catch {
    return ElMessage.warning('请求头必须是有效 JSON')
  }
  if (form.strategy === 'custom_api' && !form.endpoint.trim()) {
    return ElMessage.warning('请填写自定义风控接口')
  }
  if (form.strategy === 'manual' && !editing.value && !form.manualCookie.trim()) {
    return ElMessage.warning('请填写手动 Cookie')
  }
  saving.value = true
  try {
    const body = {
      ...form,
      headers,
      apiKey: form.apiKey || undefined,
      manualCookie: form.manualCookie || undefined,
    }
    if (editing.value) {
      await apiRequest(`/api/risk/profiles/${editing.value.id}`, { method: 'PUT', body })
      ElMessage.success('风控方案已更新')
    } else {
      await apiRequest('/api/risk/profiles', { method: 'POST', body })
      ElMessage.success('风控方案已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error(error.message || '保存风控方案失败')
  } finally {
    saving.value = false
  }
}

async function remove(profile) {
  try {
    await ElMessageBox.confirm(`确认删除风控方案「${profile.name}」？`, '删除风控方案', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await apiRequest(`/api/risk/profiles/${profile.id}`, { method: 'DELETE' })
    ElMessage.success('风控方案已删除')
    await load()
  } catch {
    // 用户取消
  }
}

function openTest(profile) {
  testProfile.value = profile
  const site = store.sites.find((item) => item.id === profile.siteId)
  testUrl.value = site?.baseUrl || ''
  testResult.value = null
  testVisible.value = true
}

async function runTest() {
  if (!testUrl.value.trim()) return ElMessage.warning('请填写测试目标地址')
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await apiRequest('/api/risk/resolve', {
      method: 'POST',
      body: { profileId: testProfile.value.id, url: testUrl.value.trim() },
    })
    await load()
  } catch (error) {
    ElMessage.error(error.message || '风控处理失败')
  } finally {
    testing.value = false
  }
}

onMounted(async () => {
  writable.value = canWrite()
  await load()
})
</script>

<template>
  <div class="risk-page">
    <PageHeader
      eyebrow="RISK CONTROL"
      title="风控管理"
      description="管理目标站点的反爬/风控处理方案。支持自定义接口、浏览器过盾和手动 Cookie，仅用于已获授权的目标站点。"
    >
      <template v-if="writable" #actions>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建风控方案
        </el-button>
      </template>
    </PageHeader>

    <section class="data-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>风控方案</h2>
          <p>共 {{ profiles.length }} 个方案 · 密钥与 Cookie 加密保存</p>
        </div>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>
      <div class="table-wrap">
        <el-table :data="profiles" class="cf-table" table-layout="fixed">
          <el-table-column label="方案" min-width="220">
            <template #default="{ row }">
              <div class="entity-cell">
                <span class="entity-avatar is-soft"><el-icon><Lock /></el-icon></span>
                <div class="entity-copy">
                  <span class="entity-name">{{ row.name }}</span>
                  <span class="entity-sub">{{ siteName(row.siteId) }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="风控类型" width="130">
            <template #default="{ row }">{{ row.riskType }}</template>
          </el-table-column>
          <el-table-column label="处理方式" width="130">
            <template #default="{ row }">
              <span class="soft-chip is-accent">{{ strategyLabel(row.strategy) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="接口 / 等待" min-width="220">
            <template #default="{ row }">
              <span class="code-text">{{ row.strategy === 'browser' ? `${row.waitMs} ms 浏览器` : row.endpoint || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <span class="soft-chip" :class="{ 'is-empty': !row.enabled }">{{ row.enabled ? '启用' : '停用' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="190" align="right">
            <template #default="{ row }">
              <div class="action-cluster">
                <button class="row-action" title="测试风控" @click="openTest(row)">
                  <el-icon><VideoPlay /></el-icon>
                </button>
                <button v-if="writable" class="row-action" title="编辑方案" @click="openEdit(row)">
                  <el-icon><EditPen /></el-icon>
                </button>
                <button v-if="writable" class="row-action is-danger" title="删除方案" @click="remove(row)">
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <EmptyState :icon="Lock" title="还没有风控方案" description="创建方案后，可在风控任务中复用。" />
          </template>
        </el-table>
      </div>
    </section>

    <section class="data-card risk-jobs-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>风控执行记录</h2>
          <p>最近 {{ jobs.length }} 条记录</p>
        </div>
      </div>
      <div class="table-wrap">
        <el-table :data="jobs" class="cf-table" table-layout="fixed">
          <el-table-column label="时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.created_at, { withSeconds: true }) }}</template>
          </el-table-column>
          <el-table-column label="方案" min-width="160">
            <template #default="{ row }">{{ row.profile_name || row.profile_id }}</template>
          </el-table-column>
          <el-table-column label="目标" min-width="220">
            <template #default="{ row }"><span class="code-text">{{ row.url }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <span class="soft-chip" :class="{ 'is-empty': row.status === 'error' }">{{ row.status }}</span>
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="110">
            <template #default="{ row }">{{ row.solved_at ? fromNow(row.solved_at) : '—' }}</template>
          </el-table-column>
          <el-table-column label="错误" min-width="180">
            <template #default="{ row }">{{ row.error || '—' }}</template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <el-dialog v-model="dialogVisible" class="cf-dialog" width="min(760px, 96vw)" append-to-body>
      <template #header>
        <div class="dialog-heading">
          <span class="dialog-heading-icon"><el-icon><Lock /></el-icon></span>
          <div class="dialog-heading-copy">
            <h3>{{ editing ? '编辑风控方案' : '新建风控方案' }}</h3>
            <p>仅用于已获得目标站点授权的采集任务。</p>
          </div>
        </div>
      </template>
      <el-form label-position="top" @submit.prevent>
        <section class="form-section">
          <div class="form-section-head"><span class="section-index">01</span><h4>基础信息</h4></div>
          <div class="form-grid">
            <el-form-item label="方案名称"><el-input v-model="form.name" /></el-form-item>
            <el-form-item label="关联站点">
              <el-select v-model="form.siteId" clearable filterable style="width: 100%">
                <el-option v-for="site in store.sites" :key="site.id" :label="site.name" :value="site.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="风控类型">
              <el-select v-model="form.riskType" style="width: 100%">
                <el-option v-for="type in riskTypes" :key="type.value" :label="type.label" :value="type.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="处理方式">
              <el-select v-model="form.strategy" style="width: 100%">
                <el-option v-for="item in strategies" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="启用状态"><el-switch v-model="form.enabled" /></el-form-item>
            <el-form-item v-if="form.strategy === 'browser'" label="浏览器等待（毫秒）">
              <el-input-number v-model="form.waitMs" :min="500" :max="30000" :step="500" controls-position="right" />
            </el-form-item>
          </div>
        </section>

        <section v-if="form.strategy === 'custom_api'" class="form-section">
          <div class="form-section-head"><span class="section-index">02</span><h4>自定义风控接口</h4></div>
          <div class="form-grid">
            <el-form-item label="请求方式">
              <el-select v-model="form.method" style="width: 100%">
                <el-option v-for="method in ['GET', 'POST', 'PUT', 'PATCH']" :key="method" :label="method" :value="method" />
              </el-select>
            </el-form-item>
            <el-form-item label="接口地址"><el-input v-model="form.endpoint" placeholder="https://risk.example.com/resolve" /></el-form-item>
            <el-form-item class="span-2" label="API Key">
              <el-input v-model="form.apiKey" type="password" show-password :placeholder="editing ? '留空保持现有密钥' : '用于 {{api_key}} 占位符'" />
            </el-form-item>
            <el-form-item class="span-2" label="请求头 JSON">
              <el-input v-model="form.headersText" type="textarea" :rows="2" />
            </el-form-item>
            <el-form-item class="span-2" label="请求模板">
              <el-input v-model="form.requestTemplate" type="textarea" :rows="4" />
            </el-form-item>
            <el-form-item label="Cookie 路径"><el-input v-model="form.cookiePath" placeholder="data.cookies" /></el-form-item>
            <el-form-item label="Token 路径"><el-input v-model="form.tokenPath" placeholder="data.token" /></el-form-item>
          </div>
          <p class="form-hint"><el-icon><InfoFilled /></el-icon>支持 api_key、url、site_id 占位符；Cookie 路径可返回 Cookie 字符串、对象或数组。</p>
        </section>

        <section v-if="form.strategy === 'manual'" class="form-section">
          <div class="form-section-head"><span class="section-index">02</span><h4>手动 Cookie</h4></div>
          <el-form-item label="Cookie 内容">
            <el-input v-model="form.manualCookie" type="textarea" :rows="5" :placeholder="editing ? '留空保持现有 Cookie' : '粘贴目标站点 Cookie，例如 sessionid=...' " />
          </el-form-item>
        </section>

      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">Cookie / API Key 加密保存</span>
          <div class="dialog-footer-actions">
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" :loading="saving" @click="save">保存方案</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="testVisible" class="cf-dialog" width="min(720px, 96vw)" append-to-body>
      <template #header>
        <div class="dialog-heading">
          <span class="dialog-heading-icon"><el-icon><Key /></el-icon></span>
          <div class="dialog-heading-copy">
            <h3>测试风控方案</h3>
            <p>{{ testProfile?.name }}</p>
          </div>
        </div>
      </template>
      <el-form label-position="top">
        <el-form-item label="测试目标地址">
          <el-input v-model="testUrl" placeholder="https://example.com/protected-page" />
        </el-form-item>
        <el-button type="primary" :loading="testing" @click="runTest">
          <el-icon><VideoPlay /></el-icon>
          执行风控处理
        </el-button>
      </el-form>
      <div v-if="testResult" class="risk-test-result">
        <div><span>Cookies</span><code>{{ testResult.cookieHeader || '—' }}</code></div>
        <div><span>Token</span><code>{{ testResult.token || '—' }}</code></div>
        <div><span>LocalStorage</span><code>{{ testResult.localStorage || '—' }}</code></div>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">测试结果不会自动写入采集任务</span>
          <div class="dialog-footer-actions">
            <el-button @click="testVisible = false">关闭</el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
