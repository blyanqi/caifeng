<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCheck,
  Delete,
  Document,
  EditPen,
  InfoFilled,
  Plus,
  Search,
} from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import KvEditor from '../components/KvEditor.vue'
import BulkActionBar from '../components/BulkActionBar.vue'
import { useBulkSelection } from '../composables/useBulkSelection'
import {
  createHeader,
  removeHeader,
  store,
  updateHeader,
  usageCount,
} from '../stores/collector'
import { formatDateTime, uid } from '../utils/format'

const activeTab = ref('all')
const keyword = ref('')
const drawerVisible = ref(false)
const editingHeader = ref(null)
const formRef = ref(null)
const { tableRef, selectedRows, bulkBusy, handleSelectionChange, clearSelection } =
  useBulkSelection()

const form = reactive({
  name: '',
  description: '',
  rows: [],
})

function emptyRow() {
  return { id: uid('row'), key: '', value: '', enabled: true }
}

const rules = {
  name: [
    { required: true, message: '请填写 Header 名称', trigger: 'blur' },
    { max: 30, message: '名称不能超过 30 个字符', trigger: 'blur' },
  ],
  rows: [
    {
      validator: (_rule, rows, callback) => {
        const validRows = (rows || []).filter((row) => row.key?.trim())
        if (!validRows.length) return callback(new Error('请至少添加一个 Header 字段'))
        const keys = validRows.map((row) => row.key.trim().toLowerCase())
        if (new Set(keys).size !== keys.length) return callback(new Error('Header 字段名不能重复'))
        callback()
      },
      trigger: 'change',
    },
  ],
}

const tabs = computed(() => [
  { key: 'all', label: '全部 Header', count: store.headers.length },
  {
    key: 'partial',
    label: '含停用字段',
    count: store.headers.filter((header) => (header.rows || []).some((row) => row.enabled === false)).length,
  },
])

const totalFields = computed(() =>
  store.headers.reduce((sum, header) => sum + (header.rows || []).length, 0),
)
const enabledFields = computed(() =>
  store.headers.reduce(
    (sum, header) => sum + (header.rows || []).filter((row) => row.enabled !== false).length,
    0,
  ),
)
const linkedTaskCount = computed(() => store.tasks.filter((task) => task.headerId).length)

const filteredHeaders = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return store.headers.filter((header) => {
    if (
      activeTab.value === 'partial' &&
      !(header.rows || []).some((row) => row.enabled === false)
    ) {
      return false
    }
    if (!query) return true
    return [header.name, header.description, ...(header.rows || []).map((row) => row.key)]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  })
})

watch(
  () => drawerVisible.value,
  (open) => {
    if (!open) return
    if (editingHeader.value) {
      Object.assign(form, {
        name: editingHeader.value.name,
        description: editingHeader.value.description || '',
        rows: (editingHeader.value.rows || []).map((row) => ({ ...row })),
      })
    } else {
      Object.assign(form, {
        name: '',
        description: '',
        rows: [{ id: uid('row'), key: 'Accept', value: 'application/json', enabled: true }],
      })
    }
    nextTick(() => formRef.value?.clearValidate())
  },
)

function openCreate() {
  editingHeader.value = null
  drawerVisible.value = true
}

function openEdit(header) {
  editingHeader.value = header
  drawerVisible.value = true
}

function validateRowsOnChange() {
  nextTick(() => {
    const result = formRef.value?.validateField('rows')
    if (result?.catch) result.catch(() => {})
  })
}

async function saveHeader() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  const duplicate = store.headers.some(
    (header) => header.id !== editingHeader.value?.id && header.name.trim() === form.name.trim(),
  )
  if (duplicate) {
    ElMessage.warning('已存在同名 Header')
    return
  }
  const payload = {
    name: form.name.trim(),
    description: form.description.trim(),
    rows: (form.rows || [])
      .filter((row) => row.key?.trim())
      .map((row) => ({
        id: row.id || uid('row'),
        key: row.key.trim(),
        value: row.value ?? '',
        enabled: row.enabled !== false,
      })),
  }
  if (editingHeader.value) {
    updateHeader(editingHeader.value.id, payload)
    ElMessage.success('Header 已更新')
  } else {
    createHeader(payload)
    ElMessage.success('Header 已创建')
  }
  drawerVisible.value = false
}

async function deleteHeader(header) {
  const count = usageCount('headers', header.id)
  if (count > 0) {
    await ElMessageBox.alert(
      `Header「${header.name}」正被 ${count} 个采集任务使用。请先调整相关任务，再删除该 Header。`,
      '无法删除 Header',
      { confirmButtonText: '知道了', type: 'warning' },
    )
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除 Header「${header.name}」？此操作不可撤销。`,
      '删除 Header',
      { confirmButtonText: '删除 Header', cancelButtonText: '取消', type: 'warning' },
    )
    removeHeader(header.id)
    ElMessage.success('Header 已删除')
  } catch {
    // 用户取消
  }
}

async function deleteSelectedHeaders() {
  if (!selectedRows.value.length || bulkBusy.value) return
  const blocked = selectedRows.value.filter(
    (header) => usageCount('headers', header.id) > 0,
  )
  const deletable = selectedRows.value.filter(
    (header) => usageCount('headers', header.id) === 0,
  )
  if (!deletable.length) {
    await ElMessageBox.alert(
      `选中的 Header 都正被采集任务使用：${blocked
        .slice(0, 3)
        .map((header) => `「${header.name}」`)
        .join('、')}${blocked.length > 3 ? ' 等' : ''}。请先调整相关任务。`,
      '无法批量删除',
      { confirmButtonText: '知道了', type: 'warning' },
    )
    return
  }
  try {
    await ElMessageBox.confirm(
      blocked.length
        ? `选中的 ${selectedRows.value.length} 个 Header 中，${blocked.length} 个正被任务使用将跳过。确认删除其余 ${deletable.length} 个？`
        : `确认删除选中的 ${deletable.length} 个 Header？此操作不可撤销。`,
      '批量删除 Header',
      { confirmButtonText: '删除 Header', cancelButtonText: '取消', type: 'warning' },
    )
    bulkBusy.value = true
    deletable.forEach((header) => removeHeader(header.id))
    clearSelection()
    ElMessage.success(
      `已删除 ${deletable.length} 个 Header${blocked.length ? `，跳过 ${blocked.length} 个被引用项` : ''}`,
    )
  } catch {
    // 用户取消
  } finally {
    bulkBusy.value = false
  }
}

function enabledCountOf(header) {
  return (header.rows || []).filter((row) => row.enabled !== false).length
}

function clearFilters() {
  keyword.value = ''
  activeTab.value = 'all'
}
</script>

<template>
  <div class="headers-page">
    <PageHeader
      eyebrow="HEADER PROFILES"
      title="采集Header管理"
      description="集中维护请求头模板，在多个采集任务之间复用。字段可单独启用或停用。"
    >
      <template #actions>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建 Header
        </el-button>
      </template>
    </PageHeader>

    <div class="info-strip">
      <span class="info-strip-icon">
        <el-icon><Document /></el-icon>
      </span>
      <div class="info-strip-copy">
        <strong>可复用的请求头模板</strong>
        <span>服务端代理会转发 Referer、User-Agent 等受限 Header；请勿在此存放真实生产密钥。</span>
      </div>
      <div class="info-strip-stats">
        <div class="info-strip-stat">
          <strong>{{ store.headers.length }}</strong>
          <span>Header 模板</span>
        </div>
        <div class="info-strip-stat">
          <strong>{{ enabledFields }}</strong>
          <span>启用字段</span>
        </div>
        <div class="info-strip-stat">
          <strong>{{ linkedTaskCount }}</strong>
          <span>关联任务</span>
        </div>
      </div>
    </div>

    <section class="data-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>Header 列表</h2>
          <p>{{ totalFields }} 个字段分散在 {{ store.headers.length }} 个模板中 · 展开行查看完整内容</p>
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
          placeholder="搜索 Header 名称或字段名"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <div class="filter-spacer" />
        <span class="filter-result">筛选结果 <strong>{{ filteredHeaders.length }}</strong> 条</span>
      </div>

      <BulkActionBar
        :count="selectedRows.length"
        noun="Header"
        :busy="bulkBusy"
        @delete="deleteSelectedHeaders"
        @clear="clearSelection"
      />

      <div class="table-wrap">
        <el-table
          ref="tableRef"
          :data="filteredHeaders"
          class="cf-table"
          table-layout="fixed"
          row-key="id"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="43" />
          <el-table-column type="expand" width="38">
            <template #default="{ row }">
              <div class="expand-kv-panel">
                <div class="expand-kv-head">
                  <span>完整字段</span>
                  <span>{{ enabledCountOf(row) }} / {{ (row.rows || []).length }} 个启用</span>
                </div>
                <div class="kv-preview-list">
                  <div
                    v-for="field in row.rows"
                    :key="field.id || field.key"
                    class="kv-preview-item"
                    :class="{ 'is-disabled': field.enabled === false }"
                  >
                    <span class="kv-preview-key">{{ field.key || '未命名字段' }}</span>
                    <span class="kv-preview-value" :title="field.value">{{ field.value || '空值' }}</span>
                    <span class="kv-preview-state">{{ field.enabled === false ? '停用' : '启用' }}</span>
                  </div>
                  <div v-if="!(row.rows || []).length" class="kv-preview-empty">暂无字段</div>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="Header 名称" min-width="230">
            <template #default="{ row }">
              <div class="entity-cell">
                <div class="entity-avatar is-soft">
                  <el-icon><Document /></el-icon>
                </div>
                <div class="entity-copy">
                  <span class="entity-name">{{ row.name }}</span>
                  <span class="entity-sub">{{ row.description || '暂无描述' }}</span>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="字段预览" min-width="220">
            <template #default="{ row }">
              <div class="field-chip-row">
                <span
                  v-for="field in (row.rows || []).slice(0, 2)"
                  :key="field.id || field.key"
                  class="soft-chip"
                >
                  {{ field.key || '—' }}
                </span>
                <span v-if="(row.rows || []).length > 2" class="soft-chip">
                  +{{ (row.rows || []).length - 2 }}
                </span>
                <span v-if="!(row.rows || []).length" class="soft-chip is-empty">暂无字段</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="启用字段" width="104">
            <template #default="{ row }">
              <span class="soft-chip is-accent">{{ enabledCountOf(row) }} / {{ (row.rows || []).length }}</span>
            </template>
          </el-table-column>

          <el-table-column label="关联任务" width="98">
            <template #default="{ row }">
              <span class="soft-chip" :class="{ 'is-empty': !usageCount('headers', row.id) }">
                {{ usageCount('headers', row.id) }} 个任务
              </span>
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
                <button class="row-action" type="button" title="编辑 Header" @click="openEdit(row)">
                  <el-icon><EditPen /></el-icon>
                </button>
                <button class="row-action is-danger" type="button" title="删除 Header" @click="deleteHeader(row)">
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
            </template>
          </el-table-column>

          <template #empty>
            <EmptyState
              :icon="Document"
              :title="store.headers.length ? '没有匹配的 Header' : '还没有 Header 模板'"
              :description="
                store.headers.length
                  ? '换个关键词，或查看全部 Header。'
                  : '创建第一个请求头模板，集中管理鉴权与通用字段。'
              "
            >
              <el-button v-if="store.headers.length" @click="clearFilters">清除筛选</el-button>
              <el-button v-else type="primary" @click="openCreate">
                <el-icon><Plus /></el-icon>
                新建 Header
              </el-button>
            </EmptyState>
          </template>
        </el-table>
      </div>

      <div class="table-footer">
        <span class="footer-summary">
          共 <strong>{{ filteredHeaders.length }}</strong> 个 Header · {{ enabledFields }} 个启用字段
        </span>
        <span class="table-service">
          <span class="service-dot" />
          可被任务复用
        </span>
      </div>
    </section>

    <el-drawer
      v-model="drawerVisible"
      class="cf-drawer"
      size="min(560px, 100vw)"
      :close-on-click-modal="false"
      append-to-body
    >
      <template #header>
        <div class="drawer-heading">
          <span class="drawer-heading-icon">
            <el-icon><Document /></el-icon>
          </span>
          <div class="drawer-heading-copy">
            <h3>{{ editingHeader ? '编辑 Header' : '新建 Header' }}</h3>
            <p>配置会按启用状态附加到每一次采集请求。</p>
          </div>
        </div>
      </template>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent>
        <section class="form-section">
          <div class="form-section-head">
            <span class="section-index">01</span>
            <h4>模板信息</h4>
            <span class="section-note">名称与用途</span>
          </div>
          <el-form-item label="Header 名称" prop="name">
            <el-input v-model="form.name" maxlength="30" placeholder="例如 默认请求头" />
          </el-form-item>
          <el-form-item label="用途说明">
            <el-input
              v-model="form.description"
              type="textarea"
              :rows="2"
              maxlength="80"
              resize="none"
              placeholder="说明模板适用场景（可选）"
            />
          </el-form-item>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <span class="section-index">02</span>
            <h4>Header 字段</h4>
            <span class="section-note">支持单行启用 / 停用</span>
          </div>
          <el-form-item prop="rows" label="请求头字段">
            <KvEditor
              :rows="form.rows"
              key-placeholder="例如 Authorization"
              value-placeholder="字段值"
              @change="validateRowsOnChange"
            />
          </el-form-item>
          <p class="form-hint">
            <el-icon><InfoFilled /></el-icon>
            字段名不区分大小写并会自动去重；请求经服务端代理转发，可携带 Referer、User-Agent 等受限 Header。
          </p>
        </section>
      </el-form>

      <template #footer>
        <div class="drawer-footer">
          <el-button @click="drawerVisible = false">取消</el-button>
          <el-button type="primary" @click="saveHeader">
            <el-icon><CircleCheck /></el-icon>
            {{ editingHeader ? '保存修改' : '创建 Header' }}
          </el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>
