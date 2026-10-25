<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, EditPen, InfoFilled, Lock, Plus } from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { apiRequest } from '../services/api'
import { canWrite } from '../services/auth'
import { store } from '../stores/collector'
import { formatDateTime, fromNow } from '../utils/format'

const sessions = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const editing = ref(null)
const saving = ref(false)
const form = reactive({
  siteId: '',
  name: '',
  type: 'cookie',
  payload: '',
  expiresAt: '',
  status: 'active',
})

const siteName = (id) => store.sites.find((site) => site.id === id)?.name || '站点已删除'
const writable = computed(() => canWrite())

async function load() {
  loading.value = true
  try {
    const payload = await apiRequest('/api/site-sessions')
    sessions.value = payload.items || []
  } catch (error) {
    ElMessage.error(error.message || '站点会话加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, {
    siteId: store.sites[0]?.id || '',
    name: '',
    type: 'cookie',
    payload: '',
    expiresAt: '',
    status: 'active',
  })
  dialogVisible.value = true
}

function openEdit(item) {
  editing.value = item
  Object.assign(form, {
    siteId: item.siteId,
    name: item.name,
    type: item.type,
    payload: '',
    expiresAt: item.expiresAt || '',
    status: item.status,
  })
  dialogVisible.value = true
}

async function save() {
  if (!form.siteId) return ElMessage.warning('请选择采集站点')
  if (!form.name.trim()) return ElMessage.warning('请填写会话名称')
  if (!editing.value && !form.payload.trim()) return ElMessage.warning('请粘贴 Cookie / Token 内容')
  saving.value = true
  try {
    const body = {
      siteId: form.siteId,
      name: form.name.trim(),
      type: form.type,
      payload: form.payload.trim() || undefined,
      expiresAt: form.expiresAt,
      status: form.status,
    }
    if (editing.value) {
      await apiRequest(`/api/site-sessions/${editing.value.id}`, { method: 'PUT', body })
      ElMessage.success('站点会话已更新')
    } else {
      await apiRequest('/api/site-sessions', { method: 'POST', body })
      ElMessage.success('站点会话已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error(error.message || '保存站点会话失败')
  } finally {
    saving.value = false
  }
}

async function remove(item) {
  try {
    await ElMessageBox.confirm(`确认删除会话「${item.name}」？关联任务将不再注入该 Cookie。`, '删除站点会话', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await apiRequest(`/api/site-sessions/${item.id}`, { method: 'DELETE' })
    ElMessage.success('站点会话已删除')
    await load()
  } catch {
    // 用户取消
  }
}

onMounted(load)
</script>

<template>
  <div class="site-sessions-page">
    <PageHeader
      eyebrow="SITE SESSIONS"
      title="会话管理"
      description="管理目标网站的登录 Cookie、Bearer Token 或 Storage State。采集时由服务端注入，不返回给浏览器。"
    >
      <template v-if="writable" #actions>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建站点会话
        </el-button>
      </template>
    </PageHeader>

    <section class="data-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>目标站点登录态</h2>
          <p>共 {{ sessions.length }} 个会话 · 加密保存在服务端</p>
        </div>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>
      <div class="table-wrap">
        <el-table :data="sessions" class="cf-table" table-layout="fixed">
          <el-table-column label="会话" min-width="230">
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
          <el-table-column label="类型" width="120">
            <template #default="{ row }"><span class="code-text">{{ row.type }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <span class="soft-chip" :class="{ 'is-empty': row.status !== 'active' || row.expired }">
                {{ row.status !== 'active' ? '已停用' : row.expired ? '已过期' : '有效' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="过期时间" width="170">
            <template #default="{ row }">
              {{ row.expiresAt ? formatDateTime(row.expiresAt, { withSeconds: true }) : '长期有效' }}
            </template>
          </el-table-column>
          <el-table-column label="最近更新" width="140">
            <template #default="{ row }">{{ fromNow(row.updatedAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="140" align="right">
            <template #default="{ row }">
              <div v-if="writable" class="action-cluster">
                <button class="row-action" title="编辑会话" @click="openEdit(row)">
                  <el-icon><EditPen /></el-icon>
                </button>
                <button class="row-action is-danger" title="删除会话" @click="remove(row)">
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <EmptyState :icon="Lock" title="还没有站点会话" description="创建 Cookie 或 Token 后，任务可选择使用。" />
          </template>
        </el-table>
      </div>
    </section>

    <el-dialog v-model="dialogVisible" class="cf-dialog" width="min(660px, 96vw)" append-to-body>
      <template #header>
        <div class="dialog-heading">
          <span class="dialog-heading-icon"><el-icon><Lock /></el-icon></span>
          <div class="dialog-heading-copy">
            <h3>{{ editing ? '编辑站点会话' : '新建站点会话' }}</h3>
            <p>Cookie 内容仅加密保存在服务端，采集时自动注入。</p>
          </div>
        </div>
      </template>
      <el-form label-position="top" @submit.prevent>
        <div class="form-grid">
          <el-form-item label="采集站点">
            <el-select v-model="form.siteId" filterable style="width: 100%">
              <el-option v-for="site in store.sites" :key="site.id" :label="site.name" :value="site.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="会话名称">
            <el-input v-model="form.name" maxlength="40" placeholder="例如 主账号登录态" />
          </el-form-item>
          <el-form-item label="类型">
            <el-select v-model="form.type" style="width: 100%">
              <el-option label="Cookie" value="cookie" />
              <el-option label="Bearer Token" value="bearer" />
              <el-option label="Storage State" value="storage_state" />
            </el-select>
          </el-form-item>
          <el-form-item label="过期时间">
            <el-date-picker
              v-model="form.expiresAt"
              type="datetime"
              value-format="YYYY-MM-DD HH:mm:ss"
              format="YYYY-MM-DD HH:mm:ss"
              placeholder="留空表示长期有效"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item class="span-2" label="Cookie / Token 内容">
            <el-input
              v-model="form.payload"
              type="textarea"
              :rows="7"
              resize="none"
              :placeholder="
                editing
                  ? '留空表示不修改现有内容；粘贴新的 Cookie 或 Token 会覆盖原会话'
                  : '支持 document.cookie 字符串、JSON 对象、Playwright storageState JSON 或 Bearer Token'
              "
            />
          </el-form-item>
          <el-form-item v-if="editing" label="状态">
            <el-select v-model="form.status" style="width: 100%">
              <el-option label="启用" value="active" />
              <el-option label="停用" value="disabled" />
            </el-select>
          </el-form-item>
        </div>
        <p class="form-hint">
          <el-icon><InfoFilled /></el-icon>
          服务端会用 AES-256-GCM 加密保存内容。任务运行时由采集代理注入 Cookie / Authorization，不会通过接口返回明文。
        </p>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">会话与站点关联，可被多个任务复用</span>
          <div class="dialog-footer-actions">
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" :loading="saving" @click="save">保存会话</el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
