<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, EditPen, InfoFilled, Key, Plus } from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { apiRequest } from '../services/api'
import { canWrite } from '../services/auth'
import { formatDateTime, fromNow } from '../utils/format'

const providers = ref([])
const jobs = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const editing = ref(null)
const saving = ref(false)
const writable = ref(false)
const form = reactive(emptyForm())
const requestTemplatePlaceholder =
  '{"key":"{{api_key}}","type":"{{captcha_type}}","url":"{{page_url}}","sitekey":"{{site_key}}","image":"{{image}}"}'
const pollTemplatePlaceholder = '{"taskId":"{{task_id}}","key":"{{api_key}}"}'

function emptyForm() {
  return {
    name: '',
    endpoint: '',
    method: 'POST',
    apiKey: '',
    requestTemplate: '',
    headersText: '{}',
    taskIdPath: '',
    resultPath: '',
    statusPath: '',
    successValue: '',
    pollEndpoint: '',
    pollMethod: 'GET',
    pollTemplate: '',
    pollTaskIdParam: 'taskId',
    pollIntervalSeconds: 3,
    timeoutSeconds: 120,
    enabled: true,
  }
}

async function load() {
  loading.value = true
  try {
    const [providerPayload, jobPayload] = await Promise.all([
      apiRequest('/api/captcha/providers'),
      apiRequest('/api/captcha/jobs?limit=100'),
    ])
    providers.value = providerPayload.items || []
    jobs.value = jobPayload.items || []
  } catch (error) {
    ElMessage.error(error.message || '打码配置加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, emptyForm())
  dialogVisible.value = true
}

function openEdit(provider) {
  editing.value = provider
  Object.assign(form, {
    name: provider.name,
    endpoint: provider.endpoint,
    method: provider.method,
    apiKey: '',
    requestTemplate: provider.requestTemplate,
    headersText: JSON.stringify(provider.headers || {}, null, 2),
    taskIdPath: provider.taskIdPath,
    resultPath: provider.resultPath,
    statusPath: provider.statusPath,
    successValue: provider.successValue,
    pollEndpoint: provider.pollEndpoint,
    pollMethod: provider.pollMethod,
    pollTemplate: provider.pollTemplate,
    pollTaskIdParam: provider.pollTaskIdParam,
    pollIntervalSeconds: provider.pollIntervalSeconds,
    timeoutSeconds: provider.timeoutSeconds,
    enabled: provider.enabled,
  })
  dialogVisible.value = true
}

async function save() {
  if (!form.name.trim() || !form.endpoint.trim()) {
    ElMessage.warning('请填写名称和创建任务接口')
    return
  }
  let headers = {}
  try {
    headers = JSON.parse(form.headersText || '{}')
  } catch {
    ElMessage.warning('请求头必须是有效 JSON')
    return
  }
  saving.value = true
  try {
    const body = {
      ...form,
      headers,
      apiKey: form.apiKey || undefined,
    }
    if (editing.value) {
      await apiRequest(`/api/captcha/providers/${editing.value.id}`, { method: 'PUT', body })
      ElMessage.success('打码平台已更新')
    } else {
      await apiRequest('/api/captcha/providers', { method: 'POST', body })
      ElMessage.success('打码平台已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error(error.message || '保存打码平台失败')
  } finally {
    saving.value = false
  }
}

async function remove(provider) {
  try {
    await ElMessageBox.confirm(`确认删除打码平台「${provider.name}」？`, '删除打码平台', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await apiRequest(`/api/captcha/providers/${provider.id}`, { method: 'DELETE' })
    ElMessage.success('打码平台已删除')
    await load()
  } catch {
    // 用户取消
  }
}

onMounted(async () => {
  writable.value = canWrite()
  await load()
})
</script>

<template>
  <div class="captcha-page">
    <PageHeader
      eyebrow="CAPTCHA PROVIDERS"
      title="打码管理"
      description="接入自定义第三方打码接口，配置创建任务、轮询结果与字段路径。站点匹配规则后续接入。"
    >
      <template v-if="writable" #actions>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建打码平台
        </el-button>
      </template>
    </PageHeader>

    <section class="data-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>自定义打码平台</h2>
          <p>共 {{ providers.length }} 个平台 · API Key 加密保存</p>
        </div>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>
      <div class="table-wrap">
        <el-table :data="providers" class="cf-table" table-layout="fixed">
          <el-table-column label="平台" min-width="210">
            <template #default="{ row }">
              <div class="entity-cell">
                <span class="entity-avatar is-soft"><el-icon><Key /></el-icon></span>
                <div class="entity-copy">
                  <span class="entity-name">{{ row.name }}</span>
                  <span class="entity-sub">{{ row.providerType }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="创建任务接口" min-width="230">
            <template #default="{ row }"><span class="code-text">{{ row.method }} {{ row.endpoint }}</span></template>
          </el-table-column>
          <el-table-column label="轮询" min-width="160">
            <template #default="{ row }">
              <span class="entity-sub">{{ row.pollMethod }} {{ row.pollEndpoint || '同创建接口' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="API Key" width="110">
            <template #default="{ row }">
              <span class="soft-chip" :class="{ 'is-empty': !row.hasApiKey }">
                {{ row.hasApiKey ? '已配置' : '未配置' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <span class="soft-chip" :class="{ 'is-empty': !row.enabled }">{{ row.enabled ? '启用' : '停用' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" align="right">
            <template #default="{ row }">
              <div v-if="writable" class="action-cluster">
                <button class="row-action" title="编辑平台" @click="openEdit(row)">
                  <el-icon><EditPen /></el-icon>
                </button>
                <button class="row-action is-danger" title="删除平台" @click="remove(row)">
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <EmptyState :icon="Key" title="还没有打码平台" description="配置自定义接口后，后续可接入站点验证码规则。" />
          </template>
        </el-table>
      </div>
    </section>

    <section class="data-card captcha-jobs-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>打码任务记录</h2>
          <p>最近 {{ jobs.length }} 条任务</p>
        </div>
      </div>
      <div class="table-wrap">
        <el-table :data="jobs" class="cf-table" table-layout="fixed">
          <el-table-column label="任务" min-width="160">
            <template #default="{ row }"><span class="code-text">{{ row.id }}</span></template>
          </el-table-column>
          <el-table-column label="平台" width="150">
            <template #default="{ row }">{{ row.provider_name || row.provider_id }}</template>
          </el-table-column>
          <el-table-column label="类型" width="120">
            <template #default="{ row }">{{ row.captcha_type || 'image' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <span class="soft-chip" :class="{ 'is-empty': row.status === 'failed' }">{{ row.status }}</span>
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="110">
            <template #default="{ row }">{{ row.solved_at ? fromNow(row.solved_at) : '—' }}</template>
          </el-table-column>
          <el-table-column label="创建时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.created_at, { withSeconds: true }) }}</template>
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
          <span class="dialog-heading-icon"><el-icon><Key /></el-icon></span>
          <div class="dialog-heading-copy">
            <h3>{{ editing ? '编辑打码平台' : '新建打码平台' }}</h3>
            <p>自定义创建任务与轮询结果接口，字段路径支持点号和数组下标。</p>
          </div>
        </div>
      </template>
      <el-form label-position="top" @submit.prevent>
        <section class="form-section">
          <div class="form-section-head"><span class="section-index">01</span><h4>基础连接</h4></div>
          <div class="form-grid">
            <el-form-item label="平台名称"><el-input v-model="form.name" placeholder="例如 自定义打码" /></el-form-item>
            <el-form-item label="请求方式">
              <el-select v-model="form.method" style="width: 100%">
                <el-option v-for="method in ['POST', 'GET', 'PUT', 'PATCH']" :key="method" :label="method" :value="method" />
              </el-select>
            </el-form-item>
            <el-form-item class="span-2" label="创建任务接口">
              <el-input v-model="form.endpoint" placeholder="https://captcha.example.com/create" />
            </el-form-item>
            <el-form-item class="span-2" label="API Key / 密钥">
              <el-input
                v-model="form.apiKey"
                type="password"
                show-password
                :placeholder="editing ? '留空表示不修改现有密钥' : '用于 api_key 占位符'"
              />
            </el-form-item>
            <el-form-item class="span-2" label="请求头 JSON">
              <el-input v-model="form.headersText" type="textarea" :rows="2" placeholder='{"Content-Type":"application/json"}' />
            </el-form-item>
            <el-form-item class="span-2" label="创建任务请求模板">
              <el-input
                v-model="form.requestTemplate"
                type="textarea"
                :rows="5"
                :placeholder="requestTemplatePlaceholder"
              />
            </el-form-item>
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head"><span class="section-index">02</span><h4>结果解析</h4></div>
          <div class="form-grid">
            <el-form-item label="任务 ID 路径"><el-input v-model="form.taskIdPath" placeholder="data.taskId" /></el-form-item>
            <el-form-item label="成功状态值"><el-input v-model="form.successValue" placeholder="done" /></el-form-item>
            <el-form-item label="状态路径"><el-input v-model="form.statusPath" placeholder="data.status" /></el-form-item>
            <el-form-item label="结果 Token 路径"><el-input v-model="form.resultPath" placeholder="data.token" /></el-form-item>
            <el-form-item label="轮询间隔（秒）"><el-input-number v-model="form.pollIntervalSeconds" :min="1" :max="60" style="width: 100%" /></el-form-item>
            <el-form-item label="超时时间（秒）"><el-input-number v-model="form.timeoutSeconds" :min="5" :max="600" style="width: 100%" /></el-form-item>
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head"><span class="section-index">03</span><h4>轮询接口</h4></div>
          <div class="form-grid">
            <el-form-item label="请求方式">
              <el-select v-model="form.pollMethod" style="width: 100%">
                <el-option v-for="method in ['GET', 'POST', 'PUT', 'PATCH']" :key="method" :label="method" :value="method" />
              </el-select>
            </el-form-item>
            <el-form-item label="任务 ID 参数名"><el-input v-model="form.pollTaskIdParam" placeholder="taskId" /></el-form-item>
            <el-form-item class="span-2" label="轮询接口">
              <el-input v-model="form.pollEndpoint" placeholder="https://captcha.example.com/result" />
            </el-form-item>
            <el-form-item class="span-2" label="轮询请求模板（可选）">
              <el-input v-model="form.pollTemplate" type="textarea" :rows="3" :placeholder="pollTemplatePlaceholder" />
            </el-form-item>
          </div>
          <p class="form-hint">
            <el-icon><InfoFilled /></el-icon>
            支持 api_key、captcha_type、page_url、site_key、image，以及轮询时的 task_id 占位符。
          </p>
        </section>
        <el-form-item label="启用状态">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">API Key 仅在服务端加密保存</span>
          <div class="dialog-footer-actions">
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" :loading="saving" @click="save">保存平台</el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
