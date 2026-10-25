<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Connection, CopyDocument, Delete, Document, EditPen, Key, Plus, Promotion, Refresh } from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { apiRequest } from '../services/api'
import { canWrite } from '../services/auth'
import { store } from '../stores/collector'
import { copyText } from '../utils/clipboard'
import { formatDateTime, fromNow } from '../utils/format'

const clients = ref([])
const jobs = ref([])
const loading = ref(false)
const clientDialog = ref(false)
const jobDialog = ref(false)
const editingClient = ref(null)
const saving = ref(false)
const writable = ref(false)
const keyDialog = ref(false)
const issuedKey = ref('')
const payloadDialog = ref(false)
const selectedJob = ref(null)

const clientForm = reactive({
  name: '',
  scopes: ['jobs:read', 'results:write'],
  webhookUrl: '',
  rateLimitPerMinute: 60,
  ipAllowlistText: '',
})

const jobForm = reactive({
  taskId: '',
  clientId: '',
  direction: 'pull',
})

const clientName = (id) => clients.value.find((client) => client.id === id)?.name || id
const taskName = (id) => store.tasks.find((task) => task.id === id)?.name || id
const jobPayloadText = computed(() =>
  selectedJob.value ? JSON.stringify(selectedJob.value, null, 2) : '',
)

async function load() {
  loading.value = true
  try {
    const [clientPayload, jobPayload] = await Promise.all([
      apiRequest('/api/api-clients'),
      apiRequest('/api/api-jobs?limit=100'),
    ])
    clients.value = clientPayload.items || []
    jobs.value = jobPayload.items || []
  } catch (error) {
    ElMessage.error(error.message || 'API 管理数据加载失败')
  } finally {
    loading.value = false
  }
}

function openCreateClient() {
  editingClient.value = null
  Object.assign(clientForm, {
    name: '',
    scopes: ['jobs:read', 'results:write'],
    webhookUrl: '',
    rateLimitPerMinute: 60,
    ipAllowlistText: '',
  })
  clientDialog.value = true
}

function openEditClient(client) {
  editingClient.value = client
  Object.assign(clientForm, {
    name: client.name,
    scopes: [...client.scopes],
    webhookUrl: client.webhookUrl,
    rateLimitPerMinute: client.rateLimitPerMinute,
    ipAllowlistText: (client.ipAllowlist || []).join('\n'),
  })
  clientDialog.value = true
}

async function saveClient() {
  if (!clientForm.name.trim()) return ElMessage.warning('请填写客户端名称')
  saving.value = true
  try {
    const body = {
      name: clientForm.name.trim(),
      scopes: clientForm.scopes,
      webhookUrl: clientForm.webhookUrl.trim(),
      rateLimitPerMinute: Number(clientForm.rateLimitPerMinute) || 60,
      ipAllowlist: clientForm.ipAllowlistText
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean),
    }
    if (editingClient.value) {
      await apiRequest(`/api/api-clients/${editingClient.value.id}`, { method: 'PUT', body })
      ElMessage.success('API 客户端已更新')
    } else {
      const payload = await apiRequest('/api/api-clients', { method: 'POST', body })
      issuedKey.value = payload.key
      keyDialog.value = true
      ElMessage.success('API 客户端已创建')
    }
    clientDialog.value = false
    await load()
  } catch (error) {
    ElMessage.error(error.message || '保存 API 客户端失败')
  } finally {
    saving.value = false
  }
}

async function resetKey(client) {
  try {
    await ElMessageBox.confirm(`重置「${client.name}」的 API Key？旧 Key 会立即失效。`, '重置 API Key', {
      confirmButtonText: '重置',
      cancelButtonText: '取消',
      type: 'warning',
    })
    const payload = await apiRequest(`/api/api-clients/${client.id}/reset-key`, { method: 'POST' })
    issuedKey.value = payload.key
    keyDialog.value = true
    await load()
  } catch {
    // 用户取消
  }
}

async function removeClient(client) {
  try {
    await ElMessageBox.confirm(`确认删除 API 客户端「${client.name}」？`, '删除 API 客户端', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await apiRequest(`/api/api-clients/${client.id}`, { method: 'DELETE' })
    ElMessage.success('API 客户端已删除')
    await load()
  } catch {
    // 用户取消
  }
}

function openCreateJob() {
  Object.assign(jobForm, {
    taskId: store.tasks[0]?.id || '',
    clientId: clients.value[0]?.id || '',
    direction: 'pull',
  })
  jobDialog.value = true
}

async function createJob() {
  if (!jobForm.taskId || !jobForm.clientId) {
    ElMessage.warning('请选择任务与 API 客户端')
    return
  }
  saving.value = true
  try {
    await apiRequest('/api/api-jobs', {
      method: 'POST',
      body: { ...jobForm },
    })
    ElMessage.success(jobForm.direction === 'push' ? '任务已创建并开始推送' : '任务已进入拉取队列')
    jobDialog.value = false
    await load()
  } catch (error) {
    ElMessage.error(error.message || '创建 API 任务失败')
  } finally {
    saving.value = false
  }
}

function viewJob(job) {
  selectedJob.value = job
  payloadDialog.value = true
}

async function copyKey() {
  const ok = await copyText(issuedKey.value)
  ElMessage[ok ? 'success' : 'warning'](ok ? 'API Key 已复制' : '复制失败，请手动选择')
}

onMounted(async () => {
  writable.value = canWrite()
  await load()
})
</script>

<template>
  <div class="api-management-page">
    <PageHeader
      eyebrow="API CONTROL PLANE"
      title="API 管理"
      description="管理第三方爬虫客户端，支持拉取任务配置和推送任务两种模式，并接收采集结果。"
    >
      <template v-if="writable" #actions>
        <el-button @click="openCreateJob">
          <el-icon><Promotion /></el-icon>
          新建 API 任务
        </el-button>
        <el-button type="primary" @click="openCreateClient">
          <el-icon><Plus /></el-icon>
          新建 API 客户端
        </el-button>
      </template>
    </PageHeader>

    <section class="data-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>API 客户端</h2>
          <p>共 {{ clients.length }} 个客户端 · Key 只在创建或重置时显示一次</p>
        </div>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>
      <div class="table-wrap">
        <el-table :data="clients" class="cf-table" table-layout="fixed">
          <el-table-column label="客户端" min-width="210">
            <template #default="{ row }">
              <div class="entity-cell">
                <span class="entity-avatar is-soft"><el-icon><Connection /></el-icon></span>
                <div class="entity-copy">
                  <span class="entity-name">{{ row.name }}</span>
                  <span class="entity-sub">{{ row.keyPrefix }}…</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="权限" min-width="210">
            <template #default="{ row }">
              <span v-for="scope in row.scopes" :key="scope" class="soft-chip is-accent api-scope-chip">{{ scope }}</span>
            </template>
          </el-table-column>
          <el-table-column label="推送 Webhook" min-width="220">
            <template #default="{ row }">
              <span class="code-text">{{ row.webhookUrl || '未配置' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="限流" width="100">
            <template #default="{ row }">{{ row.rateLimitPerMinute }}/分</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <span class="soft-chip" :class="{ 'is-empty': row.status !== 'active' }">{{ row.status === 'active' ? '启用' : '停用' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" align="right">
            <template #default="{ row }">
              <div v-if="writable" class="action-cluster api-client-actions">
                <button class="row-action" title="编辑客户端" @click="openEditClient(row)">
                  <el-icon><EditPen /></el-icon>
                </button>
                <button class="row-action" title="重置 Key" @click="resetKey(row)">
                  <el-icon><Refresh /></el-icon>
                </button>
                <button class="row-action is-danger" title="删除客户端" @click="removeClient(row)">
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <EmptyState :icon="Connection" title="还没有 API 客户端" description="创建客户端后即可让第三方爬虫拉取或接收任务。" />
          </template>
        </el-table>
      </div>
    </section>

    <section class="data-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>API 任务</h2>
          <p>拉取任务等待客户端 claim；推送任务通过 Webhook 下发</p>
        </div>
      </div>
      <div class="table-wrap">
        <el-table :data="jobs" class="cf-table" table-layout="fixed">
          <el-table-column label="任务" min-width="200">
            <template #default="{ row }">
              <div class="stack">
                <span class="entity-name">{{ row.taskName || taskName(row.taskId) }}</span>
                <span class="entity-sub">{{ row.id }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="客户端" width="150">
            <template #default="{ row }">{{ clientName(row.clientId) }}</template>
          </el-table-column>
          <el-table-column label="方向" width="90">
            <template #default="{ row }">
              <span class="soft-chip" :class="row.direction === 'push' ? 'is-accent' : ''">
                {{ row.direction === 'push' ? '推送' : '拉取' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <span class="soft-chip" :class="{ 'is-empty': row.status === 'error' }">{{ row.status }}</span>
            </template>
          </el-table-column>
          <el-table-column label="结果" width="90">
            <template #default="{ row }">{{ row.resultCount }} 条</template>
          </el-table-column>
          <el-table-column label="创建时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt, { withSeconds: true }) }}</template>
          </el-table-column>
          <el-table-column label="错误" min-width="170">
            <template #default="{ row }">{{ row.error || '—' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="right">
            <template #default="{ row }">
              <el-button size="small" @click="viewJob(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <section class="data-card api-doc-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>第三方爬虫接口</h2>
          <p>使用 API Key 访问 /api/v1/*，请求头 Authorization: Bearer &lt;key&gt;</p>
        </div>
      </div>
      <div class="api-doc-grid">
        <div><span>拉取任务</span><code>GET /api/v1/jobs/next</code></div>
        <div><span>查询任务</span><code>GET /api/v1/jobs/:id</code></div>
        <div><span>回传结果</span><code>POST /api/v1/jobs/:id/result</code></div>
        <div><span>上报失败</span><code>POST /api/v1/jobs/:id/fail</code></div>
      </div>
      <p class="form-hint">
        推送模式会把任务配置 POST 到客户端 Webhook，第三方完成后调用结果回传接口；拉取模式由第三方主动领取 pending 任务。只有授予 secrets:read 的客户端才会收到 Cookie、Authorization 等敏感请求头。
      </p>
    </section>

    <el-dialog v-model="clientDialog" class="cf-dialog" width="min(580px, 96vw)" append-to-body>
      <template #header>
        <div class="dialog-heading">
          <span class="dialog-heading-icon"><el-icon><Connection /></el-icon></span>
          <div class="dialog-heading-copy">
            <h3>{{ editingClient ? '编辑 API 客户端' : '新建 API 客户端' }}</h3>
            <p>Key 生成后仅显示一次，请妥善保存。</p>
          </div>
        </div>
      </template>
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="客户端名称">
          <el-input v-model="clientForm.name" placeholder="例如 第三方采集器" />
        </el-form-item>
        <el-form-item label="权限范围">
          <el-checkbox-group v-model="clientForm.scopes">
            <el-checkbox label="jobs:read">读取任务</el-checkbox>
            <el-checkbox label="results:write">回传结果</el-checkbox>
            <el-checkbox label="secrets:read">读取登录态与敏感 Header</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="推送 Webhook（推送模式必填）">
          <el-input v-model="clientForm.webhookUrl" placeholder="https://crawler.example.com/hook" />
        </el-form-item>
        <el-form-item label="每分钟请求上限">
          <el-input-number v-model="clientForm.rateLimitPerMinute" :min="1" :max="10000" style="width: 100%" />
        </el-form-item>
        <el-form-item label="IP 白名单（可选，每行或逗号分隔）">
          <el-input v-model="clientForm.ipAllowlistText" type="textarea" :rows="2" placeholder="127.0.0.1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">API Key 采用哈希保存</span>
          <div class="dialog-footer-actions">
            <el-button @click="clientDialog = false">取消</el-button>
            <el-button type="primary" :loading="saving" @click="saveClient">保存客户端</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="jobDialog" class="cf-dialog" width="min(520px, 94vw)" append-to-body>
      <template #header>
        <div class="dialog-heading">
          <span class="dialog-heading-icon"><el-icon><Promotion /></el-icon></span>
          <div class="dialog-heading-copy">
            <h3>新建 API 任务</h3>
            <p>选择任务、客户端和下发方向。</p>
          </div>
        </div>
      </template>
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="采集任务">
          <el-select v-model="jobForm.taskId" filterable style="width: 100%">
            <el-option v-for="task in store.tasks" :key="task.id" :label="task.name" :value="task.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="API 客户端">
          <el-select v-model="jobForm.clientId" filterable style="width: 100%">
            <el-option v-for="client in clients" :key="client.id" :label="client.name" :value="client.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="下发方向">
          <el-radio-group v-model="jobForm.direction">
            <el-radio-button label="pull">等待拉取</el-radio-button>
            <el-radio-button label="push">Webhook 推送</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">任务配置会生成快照，不受后续修改影响</span>
          <div class="dialog-footer-actions">
            <el-button @click="jobDialog = false">取消</el-button>
            <el-button type="primary" :loading="saving" @click="createJob">创建任务</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="keyDialog" class="cf-dialog" width="min(560px, 94vw)" append-to-body>
      <template #header>
        <div class="dialog-heading">
          <span class="dialog-heading-icon"><el-icon><Key /></el-icon></span>
          <div class="dialog-heading-copy">
            <h3>API Key 已生成</h3>
            <p>关闭后不会再显示明文，请立即复制。</p>
          </div>
        </div>
      </template>
      <div class="api-key-box">{{ issuedKey }}</div>
      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">请像密码一样保管</span>
          <div class="dialog-footer-actions">
            <el-button @click="copyKey"><el-icon><CopyDocument /></el-icon>复制</el-button>
            <el-button type="primary" @click="keyDialog = false">已保存</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="payloadDialog" class="cf-dialog api-payload-dialog" width="min(820px, 96vw)" append-to-body>
      <template #header>
        <div class="dialog-heading">
          <span class="dialog-heading-icon"><el-icon><Document /></el-icon></span>
          <div class="dialog-heading-copy">
            <h3>API 任务详情</h3>
            <p>{{ selectedJob?.id }}</p>
          </div>
        </div>
      </template>
      <pre class="api-json-view">{{ jobPayloadText }}</pre>
      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">{{ selectedJob?.error || selectedJob?.status }}</span>
          <div class="dialog-footer-actions">
            <el-button type="primary" @click="payloadDialog = false">关闭</el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
