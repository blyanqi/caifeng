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
  Lock,
  Plus,
  Search,
} from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import BulkActionBar from '../components/BulkActionBar.vue'
import { useBulkSelection } from '../composables/useBulkSelection'
import {
  createProxy,
  removeProxy,
  store,
  updateProxy,
} from '../stores/collector'
import { formatDateTime } from '../utils/format'
import { copyText } from '../utils/clipboard'

const PROTOCOLS = {
  http: { label: 'HTTP', tone: 'http' },
  https: { label: 'HTTPS', tone: 'https' },
  socks5: { label: 'SOCKS5', tone: 'socks5' },
}

const activeTab = ref('all')
const keyword = ref('')
const dialogVisible = ref(false)
const editingProxy = ref(null)
const formRef = ref(null)
const { tableRef, selectedRows, bulkBusy, handleSelectionChange, clearSelection } =
  useBulkSelection()

const form = reactive({
  name: '',
  protocol: 'http',
  host: '',
  port: '8080',
  username: '',
  password: '',
  description: '',
  enabled: true,
})

const rules = {
  name: [
    { required: true, message: '请填写代理名称', trigger: 'blur' },
    { max: 30, message: '名称不能超过 30 个字符', trigger: 'blur' },
  ],
  host: [
    { required: true, message: '请填写代理主机', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (!value) return callback()
        if (/^https?:\/\//i.test(value) || value.includes('://')) {
          return callback(new Error('主机字段无需填写协议，请单独选择协议类型'))
        }
        if (/[\s/]/.test(value)) return callback(new Error('主机中不能包含空格或路径'))
        callback()
      },
      trigger: 'blur',
    },
  ],
  port: [
    { required: true, message: '请填写端口', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (!value) return callback()
        if (!/^\d+$/.test(String(value))) return callback(new Error('端口必须是数字'))
        const port = Number(value)
        if (port < 1 || port > 65535) return callback(new Error('端口范围应为 1 - 65535'))
        callback()
      },
      trigger: 'blur',
    },
  ],
}

const tabs = computed(() => [
  { key: 'all', label: '全部代理', count: store.proxies.length },
  { key: 'enabled', label: '已启用', count: store.proxies.filter((proxy) => proxy.enabled).length },
  { key: 'disabled', label: '已停用', count: store.proxies.filter((proxy) => !proxy.enabled).length },
])

const enabledCount = computed(() => store.proxies.filter((proxy) => proxy.enabled).length)
const authenticatedCount = computed(
  () => store.proxies.filter((proxy) => proxy.username?.trim()).length,
)

const filteredProxies = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return store.proxies.filter((proxy) => {
    if (activeTab.value === 'enabled' && !proxy.enabled) return false
    if (activeTab.value === 'disabled' && proxy.enabled) return false
    if (!query) return true
    return [proxy.name, proxy.host, proxy.protocol, proxy.description, proxy.username]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  })
})

const addressPreview = computed(() => {
  const auth = form.username?.trim() ? `${form.username.trim()}:••••@` : ''
  return `${form.protocol}://${auth}${form.host || 'host'}:${form.port || 'port'}`
})

watch(
  () => dialogVisible.value,
  (open) => {
    if (!open) return
    if (editingProxy.value) {
      Object.assign(form, {
        name: editingProxy.value.name,
        protocol: editingProxy.value.protocol || 'http',
        host: editingProxy.value.host || '',
        port: String(editingProxy.value.port || ''),
        username: editingProxy.value.username || '',
        password: editingProxy.value.password || '',
        description: editingProxy.value.description || '',
        enabled: editingProxy.value.enabled !== false,
      })
    } else {
      Object.assign(form, {
        name: '',
        protocol: 'http',
        host: '',
        port: '8080',
        username: '',
        password: '',
        description: '',
        enabled: true,
      })
    }
    nextTick(() => formRef.value?.clearValidate())
  },
)

function openCreate() {
  editingProxy.value = null
  dialogVisible.value = true
}

function openEdit(proxy) {
  editingProxy.value = proxy
  dialogVisible.value = true
}

async function saveProxy() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  if (form.password && !form.username.trim()) {
    ElMessage.warning('填写密码时请同时填写认证用户名')
    return
  }
  const duplicate = store.proxies.some(
    (proxy) => proxy.id !== editingProxy.value?.id && proxy.name.trim() === form.name.trim(),
  )
  if (duplicate) {
    ElMessage.warning('已存在同名代理')
    return
  }
  const payload = {
    name: form.name.trim(),
    protocol: form.protocol,
    host: form.host.trim(),
    port: Number(form.port),
    username: form.username.trim(),
    password: form.password,
    description: form.description.trim(),
    enabled: form.enabled,
  }
  if (editingProxy.value) {
    updateProxy(editingProxy.value.id, payload)
    ElMessage.success('代理配置已更新')
  } else {
    createProxy(payload)
    ElMessage.success('代理配置已创建')
  }
  dialogVisible.value = false
}

async function deleteProxy(proxy) {
  try {
    await ElMessageBox.confirm(
      `确认删除代理「${proxy.name}」？本地保存的认证信息也会一并移除。`,
      '删除代理配置',
      { confirmButtonText: '删除代理', cancelButtonText: '取消', type: 'warning' },
    )
    removeProxy(proxy.id)
    ElMessage.success('代理配置已删除')
  } catch {
    // 用户取消
  }
}

async function deleteSelectedProxies() {
  if (!selectedRows.value.length || bulkBusy.value) return
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${selectedRows.value.length} 个代理？本地保存的认证信息也会一并移除。`,
      '批量删除代理配置',
      { confirmButtonText: '删除代理', cancelButtonText: '取消', type: 'warning' },
    )
    bulkBusy.value = true
    const count = selectedRows.value.length
    selectedRows.value.forEach((proxy) => removeProxy(proxy.id))
    clearSelection()
    ElMessage.success(`已删除 ${count} 个代理配置`)
  } catch {
    // 用户取消
  } finally {
    bulkBusy.value = false
  }
}

function setSelectedProxiesEnabled(enabled) {
  if (!selectedRows.value.length) return
  selectedRows.value.forEach((proxy) => updateProxy(proxy.id, { enabled }))
  ElMessage.success(`已${enabled ? '启用' : '停用'} ${selectedRows.value.length} 个代理`)
  clearSelection()
}

function handleToggle(proxy, value) {
  ElMessage.success(value ? `已启用「${proxy.name}」` : `已停用「${proxy.name}」`)
}

function formatAddress(proxy) {
  return `${proxy.host}:${proxy.port}`
}

async function copyAddress(proxy) {
  const ok = await copyText(formatAddress(proxy))
  ElMessage[ok ? 'success' : 'warning'](ok ? '代理地址已复制' : '复制失败，请手动选择')
}

function protocolMeta(proxy) {
  return PROTOCOLS[proxy.protocol] || PROTOCOLS.http
}

function clearFilters() {
  keyword.value = ''
  activeTab.value = 'all'
}
</script>

<template>
  <div class="proxies-page">
    <PageHeader
      eyebrow="PROXY POOL"
      title="代理管理"
      description="集中托管 HTTP、HTTPS 与 SOCKS5 出口配置，统一维护地址、端口与认证信息。"
    >
      <template #actions>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建代理
        </el-button>
      </template>
    </PageHeader>

    <div class="info-strip">
      <span class="info-strip-icon">
        <el-icon><Connection /></el-icon>
      </span>
      <div class="info-strip-copy">
        <strong>代理配置托管</strong>
        <span>当前采集由本地服务端代理转发，不受浏览器 CORS 限制；代理管理中的出口代理尚未接入服务端转发，凭据仅保存在本地。</span>
      </div>
      <div class="info-strip-stats">
        <div class="info-strip-stat">
          <strong>{{ store.proxies.length }}</strong>
          <span>代理总数</span>
        </div>
        <div class="info-strip-stat">
          <strong>{{ enabledCount }}</strong>
          <span>已启用</span>
        </div>
        <div class="info-strip-stat">
          <strong>{{ authenticatedCount }}</strong>
          <span>需认证</span>
        </div>
      </div>
    </div>

    <section class="data-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>代理出口</h2>
          <p>维护可复用的出口配置，敏感凭据保存在服务端工作区</p>
        </div>
        <div class="toolbar-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="tab-btn"
            :class="{ 'is-active': activeTab === tab.key }"
            type="button"
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
          placeholder="搜索代理名称、主机或协议"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <div class="filter-spacer" />
        <span class="filter-result">筛选结果 <strong>{{ filteredProxies.length }}</strong> 条</span>
      </div>

      <BulkActionBar
        :count="selectedRows.length"
        noun="代理"
        :busy="bulkBusy"
        @delete="deleteSelectedProxies"
        @clear="clearSelection"
      >
        <template #actions>
          <button class="bulk-action" type="button" @click="setSelectedProxiesEnabled(true)">
            批量启用
          </button>
          <button class="bulk-action" type="button" @click="setSelectedProxiesEnabled(false)">
            批量停用
          </button>
        </template>
      </BulkActionBar>

      <div class="table-wrap">
        <el-table
          ref="tableRef"
          :data="filteredProxies"
          class="cf-table"
          table-layout="fixed"
          row-key="id"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="43" />
          <el-table-column label="代理名称" min-width="238">
            <template #default="{ row }">
              <div class="entity-cell">
                <div class="entity-avatar is-soft">
                  <el-icon><Connection /></el-icon>
                </div>
                <div class="entity-copy">
                  <span class="entity-name">{{ row.name }}</span>
                  <span class="entity-sub">{{ row.description || '暂无描述' }}</span>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="协议" width="100">
            <template #default="{ row }">
              <span class="proxy-protocol" :class="`is-${protocolMeta(row).tone}`">
                {{ protocolMeta(row).label }}
              </span>
            </template>
          </el-table-column>

          <el-table-column label="代理地址" min-width="205">
            <template #default="{ row }">
              <div class="copy-value">
                <span class="code-text" style="max-width: 175px">{{ formatAddress(row) }}</span>
                <button class="copy-btn" type="button" title="复制代理地址" @click="copyAddress(row)">
                  <el-icon><CopyDocument /></el-icon>
                </button>
              </div>
              <span class="entity-sub">{{ row.enabled ? '已加入可用出口池' : '已停用，不参与路由' }}</span>
            </template>
          </el-table-column>

          <el-table-column label="认证" width="150">
            <template #default="{ row }">
              <div v-if="row.username" class="proxy-auth">
                <el-icon><Lock /></el-icon>
                <span>{{ row.username }}</span>
                <em>{{ row.password ? '密码已配置' : '无密码' }}</em>
              </div>
              <span v-else class="soft-chip is-empty">无认证</span>
            </template>
          </el-table-column>

          <el-table-column label="状态" width="116">
            <template #default="{ row }">
              <div class="editable-switch">
                <el-switch v-model="row.enabled" @change="(value) => handleToggle(row, value)" />
                <span :style="{ color: row.enabled ? '#475467' : '#9a9eab' }">
                  {{ row.enabled ? '已启用' : '已停用' }}
                </span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="最近更新" width="126">
            <template #default="{ row }">
              <span class="mono-text" style="color: #5d6372">{{ formatDateTime(row.updatedAt) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="82" align="right">
            <template #default="{ row }">
              <div class="action-cluster">
                <button class="row-action" type="button" title="编辑代理" @click="openEdit(row)">
                  <el-icon><EditPen /></el-icon>
                </button>
                <button class="row-action is-danger" type="button" title="删除代理" @click="deleteProxy(row)">
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
            </template>
          </el-table-column>

          <template #empty>
            <EmptyState
              :icon="Connection"
              :title="store.proxies.length ? '没有匹配的代理' : '还没有代理配置'"
              :description="
                store.proxies.length
                  ? '换个关键词，或切换代理状态筛选。'
                  : '添加第一个代理出口，统一维护地址与认证信息。'
              "
            >
              <el-button v-if="store.proxies.length" @click="clearFilters">清除筛选</el-button>
              <el-button v-else type="primary" @click="openCreate">
                <el-icon><Plus /></el-icon>
                新建代理
              </el-button>
            </EmptyState>
          </template>
        </el-table>
      </div>

      <div class="table-footer">
        <span class="footer-summary">
          共 <strong>{{ filteredProxies.length }}</strong> 个代理 · {{ enabledCount }} 个已启用
        </span>
        <span class="table-service" :class="{ 'is-off': !enabledCount }">
          <span class="service-dot" />
          {{ enabledCount ? '出口池可配置' : '暂无可用代理' }}
        </span>
      </div>
    </section>

    <el-dialog
      v-model="dialogVisible"
      class="cf-dialog"
      width="min(600px, 94vw)"
      :close-on-click-modal="false"
      append-to-body
    >
      <template #header>
        <div class="dialog-heading">
          <span class="dialog-heading-icon">
            <el-icon><Connection /></el-icon>
          </span>
          <div class="dialog-heading-copy">
            <h3>{{ editingProxy ? '编辑代理配置' : '新建代理配置' }}</h3>
            <p>维护代理出口的协议、地址与认证信息。</p>
          </div>
        </div>
      </template>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent>
        <section class="form-section">
          <div class="form-section-head">
            <span class="section-index">01</span>
            <h4>基本信息</h4>
            <span class="section-note">名称与代理协议</span>
          </div>
          <div class="form-grid">
            <el-form-item class="span-2" label="代理名称" prop="name">
              <el-input v-model="form.name" maxlength="30" placeholder="例如 香港出口 · 01" />
            </el-form-item>
            <el-form-item class="span-2" label="代理协议">
              <div class="segmented-control">
                <button
                  v-for="(meta, key) in PROTOCOLS"
                  :key="key"
                  type="button"
                  :class="{ 'is-active': form.protocol === key }"
                  @click="form.protocol = key"
                >
                  {{ meta.label }}
                </button>
              </div>
            </el-form-item>
            <el-form-item class="span-2" label="用途说明">
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="2"
                maxlength="80"
                resize="none"
                placeholder="说明代理出口的用途或地区（可选）"
              />
            </el-form-item>
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <span class="section-index">02</span>
            <h4>连接与认证</h4>
            <span class="section-note">认证信息可选</span>
          </div>
          <div class="form-grid">
            <el-form-item label="代理主机" prop="host">
              <el-input v-model="form.host" placeholder="198.51.100.24 或 proxy.example.com" />
            </el-form-item>
            <el-form-item label="端口" prop="port">
              <el-input v-model="form.port" inputmode="numeric" placeholder="8080">
                <template #prefix>
                  <span class="input-prefix-path">PORT</span>
                </template>
              </el-input>
            </el-form-item>
            <el-form-item label="用户名">
              <el-input v-model="form.username" autocomplete="off" placeholder="可选，无认证可留空" />
            </el-form-item>
            <el-form-item label="密码">
              <el-input
                v-model="form.password"
                type="password"
                show-password
                autocomplete="new-password"
                placeholder="可选"
              />
            </el-form-item>
            <div class="span-2 toggle-row">
              <div>
                <strong>启用代理</strong>
                <span>停用后，该出口不参与后续服务端采集路由</span>
              </div>
              <el-switch v-model="form.enabled" />
            </div>
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <span class="section-index">03</span>
            <h4>出口预览</h4>
            <span class="section-note">认证信息将自动脱敏</span>
          </div>
          <div class="request-preview">
            <div class="preview-head">
              <span class="preview-label">
                <el-icon><Connection /></el-icon>
                代理出口
              </span>
              <span class="preview-state">{{ form.enabled ? 'ENABLED' : 'DISABLED' }}</span>
            </div>
            <div class="request-url">{{ addressPreview }}</div>
            <div class="preview-meta">
              <span class="proxy-protocol" :class="`is-${PROTOCOLS[form.protocol]?.tone}`">
                {{ PROTOCOLS[form.protocol]?.label }}
              </span>
              <span class="soft-chip" :class="{ 'is-empty': !form.username }">
                {{ form.username ? '用户名 / 密码认证' : '无认证' }}
              </span>
            </div>
          </div>
          <p class="form-hint">
            <el-icon><InfoFilled /></el-icon>
            凭据保存在服务端工作区数据库中，请勿在共享环境中填写真实生产密码。
          </p>
        </section>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">出口代理尚未接入服务端请求转发</span>
          <div class="dialog-footer-actions">
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" @click="saveProxy">
              <el-icon><CircleCheck /></el-icon>
              {{ editingProxy ? '保存修改' : '创建代理' }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
