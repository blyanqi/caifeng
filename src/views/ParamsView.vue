<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCheck,
  Delete,
  EditPen,
  InfoFilled,
  Operation,
  Plus,
  Search,
} from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ParamRowsEditor from '../components/ParamRowsEditor.vue'
import BulkActionBar from '../components/BulkActionBar.vue'
import { useBulkSelection } from '../composables/useBulkSelection'
import {
  createParam,
  removeParam,
  store,
  updateParam,
  usageCount,
} from '../stores/collector'
import { formatDateTime, uid } from '../utils/format'
import {
  TIMESTAMP_FORMATS,
  listCount,
  listValues,
  normalizeParamRow,
  resolveTimestamp,
} from '../utils/params'

const activeTab = ref('all')
const keyword = ref('')
const drawerVisible = ref(false)
const editingParam = ref(null)
const formRef = ref(null)
const { tableRef, selectedRows, bulkBusy, handleSelectionChange, clearSelection } =
  useBulkSelection()

const form = reactive({
  name: '',
  description: '',
  rows: [],
})

const rules = {
  name: [
    { required: true, message: '请填写参数项名称', trigger: 'blur' },
    { max: 30, message: '名称不能超过 30 个字符', trigger: 'blur' },
  ],
  rows: [
    {
      validator: (_rule, rows, callback) => {
        const normalized = (rows || []).map(normalizeParamRow)
        const validRows = normalized.filter((row) => row.key?.trim())
        if (!validRows.length) return callback(new Error('请至少添加一个请求参数'))
        const keys = validRows.map((row) => row.key.trim())
        if (new Set(keys).size !== keys.length) return callback(new Error('参数名不能重复'))
        const emptyList = validRows.find(
          (row) =>
            row.enabled !== false && row.valueType === 'list' && listCount(row) === 0,
        )
        if (emptyList) {
          return callback(new Error(`列表参数「${emptyList.key}」至少需要填写一个值`))
        }
        callback()
      },
      trigger: 'change',
    },
  ],
}

const tabs = computed(() => [
  { key: 'all', label: '全部参数项', count: store.params.length },
  {
    key: 'partial',
    label: '含停用参数',
    count: store.params.filter((param) => (param.rows || []).some((row) => row.enabled === false)).length,
  },
  {
    key: 'lists',
    label: '含列表参数',
    count: store.params.filter((param) =>
      (param.rows || []).some(
        (row) => normalizeParamRow(row).valueType === 'list' && listCount(row) > 0,
      ),
    ).length,
  },
])

const totalFields = computed(() =>
  store.params.reduce((sum, param) => sum + (param.rows || []).length, 0),
)
const enabledFields = computed(() =>
  store.params.reduce(
    (sum, param) => sum + (param.rows || []).filter((row) => row.enabled !== false).length,
    0,
  ),
)
const linkedTaskCount = computed(() => store.tasks.filter((task) => task.paramId).length)
const listParamCount = computed(() =>
  store.params.reduce(
    (sum, param) =>
      sum +
      (param.rows || []).filter(
        (row) => normalizeParamRow(row).valueType === 'list' && listCount(row) > 0,
      ).length,
    0,
  ),
)

const filteredParams = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return store.params.filter((param) => {
    if (activeTab.value === 'partial' && !(param.rows || []).some((row) => row.enabled === false)) {
      return false
    }
    if (
      activeTab.value === 'lists' &&
      !(param.rows || []).some(
        (row) => normalizeParamRow(row).valueType === 'list' && listCount(row) > 0,
      )
    ) {
      return false
    }
    if (!query) return true
    return [param.name, param.description, ...(param.rows || []).map((row) => row.key)]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  })
})

watch(
  () => drawerVisible.value,
  (open) => {
    if (!open) return
    if (editingParam.value) {
      Object.assign(form, {
        name: editingParam.value.name,
        description: editingParam.value.description || '',
        rows: (editingParam.value.rows || []).map(normalizeParamRow),
      })
    } else {
      Object.assign(form, {
        name: '',
        description: '',
        rows: [
          normalizeParamRow({
            id: uid('row'),
            key: 'page',
            value: '1',
            enabled: true,
            valueType: 'text',
          }),
        ],
      })
    }
    nextTick(() => formRef.value?.clearValidate())
  },
)

function openCreate() {
  editingParam.value = null
  drawerVisible.value = true
}

function openEdit(param) {
  editingParam.value = param
  drawerVisible.value = true
}

async function saveParam() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  const duplicate = store.params.some(
    (param) => param.id !== editingParam.value?.id && param.name.trim() === form.name.trim(),
  )
  if (duplicate) {
    ElMessage.warning('已存在同名参数项')
    return
  }
  const payload = {
    name: form.name.trim(),
    description: form.description.trim(),
    rows: (form.rows || [])
      .filter((row) => row.key?.trim())
      .map((row) => {
        const normalized = normalizeParamRow(row)
        return {
          ...normalized,
          id: normalized.id || uid('row'),
          key: normalized.key.trim(),
          enabled: normalized.enabled !== false,
        }
      }),
  }
  if (editingParam.value) {
    updateParam(editingParam.value.id, payload)
    ElMessage.success('参数项已更新')
  } else {
    createParam(payload)
    ElMessage.success('参数项已创建')
  }
  drawerVisible.value = false
}

async function deleteParam(param) {
  const count = usageCount('params', param.id)
  if (count > 0) {
    await ElMessageBox.alert(
      `参数项「${param.name}」正被 ${count} 个采集任务使用。请先调整相关任务，再删除该参数项。`,
      '无法删除参数项',
      { confirmButtonText: '知道了', type: 'warning' },
    )
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除参数项「${param.name}」？此操作不可撤销。`,
      '删除采集参数项',
      { confirmButtonText: '删除参数项', cancelButtonText: '取消', type: 'warning' },
    )
    removeParam(param.id)
    ElMessage.success('参数项已删除')
  } catch {
    // 用户取消
  }
}

async function deleteSelectedParams() {
  if (!selectedRows.value.length || bulkBusy.value) return
  const blocked = selectedRows.value.filter(
    (param) => usageCount('params', param.id) > 0,
  )
  const deletable = selectedRows.value.filter(
    (param) => usageCount('params', param.id) === 0,
  )
  if (!deletable.length) {
    await ElMessageBox.alert(
      `选中的参数项都正被采集任务使用：${blocked
        .slice(0, 3)
        .map((param) => `「${param.name}」`)
        .join('、')}${blocked.length > 3 ? ' 等' : ''}。请先调整相关任务。`,
      '无法批量删除',
      { confirmButtonText: '知道了', type: 'warning' },
    )
    return
  }
  try {
    await ElMessageBox.confirm(
      blocked.length
        ? `选中的 ${selectedRows.value.length} 个参数项中，${blocked.length} 个正被任务使用将跳过。确认删除其余 ${deletable.length} 个？`
        : `确认删除选中的 ${deletable.length} 个参数项？此操作不可撤销。`,
      '批量删除采集参数项',
      { confirmButtonText: '删除参数项', cancelButtonText: '取消', type: 'warning' },
    )
    bulkBusy.value = true
    deletable.forEach((param) => removeParam(param.id))
    clearSelection()
    ElMessage.success(
      `已删除 ${deletable.length} 个参数项${blocked.length ? `，跳过 ${blocked.length} 个被引用项` : ''}`,
    )
  } catch {
    // 用户取消
  } finally {
    bulkBusy.value = false
  }
}

function enabledCountOf(param) {
  return (param.rows || []).filter((row) => row.enabled !== false).length
}

function fieldTypeOf(field) {
  const type = normalizeParamRow(field).valueType
  return { text: '文本', timestamp: '时间戳', list: '列表' }[type] || '文本'
}

function fieldTypeKey(field) {
  return normalizeParamRow(field).valueType
}

function fieldPreview(field) {
  const normalized = normalizeParamRow(field)
  if (normalized.valueType === 'list') {
    return `${listCount(normalized)} 项 · ${listValues(normalized).slice(0, 2).join(' / ') || '空列表'}`
  }
  if (normalized.valueType === 'timestamp') {
    const format =
      TIMESTAMP_FORMATS.find((item) => item.value === normalized.timestamp.format)?.label ||
      'Unix 毫秒'
    return `${format} · ${resolveTimestamp(normalized.timestamp)}`
  }
  return normalized.value || '空值'
}

function clearFilters() {
  keyword.value = ''
  activeTab.value = 'all'
}
</script>

<template>
  <div class="params-page">
    <PageHeader
      eyebrow="QUERY PARAMETERS"
      title="采集参数项管理"
      description="管理分页、筛选与检索参数，支持静态文本、实时时间戳与列表遍历值。参数会自动拼接到请求地址。"
    >
      <template #actions>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建参数项
        </el-button>
      </template>
    </PageHeader>

    <div class="info-strip">
      <span class="info-strip-icon">
        <el-icon><Operation /></el-icon>
      </span>
      <div class="info-strip-copy">
        <strong>值类型 · 动态参数</strong>
        <span>每个参数可选择文本、时间戳或列表；列表值可在任务中配置为逐项遍历。</span>
      </div>
      <div class="info-strip-stats">
        <div class="info-strip-stat">
          <strong>{{ store.params.length }}</strong>
          <span>参数项</span>
        </div>
        <div class="info-strip-stat">
          <strong>{{ enabledFields }}</strong>
          <span>启用参数</span>
        </div>
        <div class="info-strip-stat">
          <strong>{{ listParamCount }}</strong>
          <span>列表参数</span>
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
          <h2>参数项目录</h2>
          <p>{{ totalFields }} 个参数分散在 {{ store.params.length }} 个模板中 · 展开行查看详情</p>
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
          placeholder="搜索参数项名称或参数名"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <div class="filter-spacer" />
        <span class="filter-result">筛选结果 <strong>{{ filteredParams.length }}</strong> 条</span>
      </div>

      <BulkActionBar
        :count="selectedRows.length"
        noun="参数项"
        :busy="bulkBusy"
        @delete="deleteSelectedParams"
        @clear="clearSelection"
      />

      <div class="table-wrap">
        <el-table
          ref="tableRef"
          :data="filteredParams"
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
                  <span>完整参数</span>
                  <span>{{ enabledCountOf(row) }} / {{ (row.rows || []).length }} 个启用</span>
                </div>
                <div class="kv-preview-list">
                  <div
                    v-for="field in row.rows"
                    :key="field.id || field.key"
                    class="kv-preview-item is-param"
                    :class="{ 'is-disabled': field.enabled === false }"
                  >
                    <span class="kv-preview-key">{{ field.key || '未命名参数' }}</span>
                    <span
                      class="param-field-type"
                      :class="`is-${fieldTypeKey(field)}`"
                    >{{ fieldTypeOf(field) }}</span>
                    <span class="kv-preview-value" :title="fieldPreview(field)">{{ fieldPreview(field) }}</span>
                    <span class="kv-preview-state">{{ field.enabled === false ? '停用' : '启用' }}</span>
                  </div>
                  <div v-if="!(row.rows || []).length" class="kv-preview-empty">暂无参数</div>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="参数项名称" min-width="230">
            <template #default="{ row }">
              <div class="entity-cell">
                <div class="entity-avatar is-soft">
                  <el-icon><Operation /></el-icon>
                </div>
                <div class="entity-copy">
                  <span class="entity-name">{{ row.name }}</span>
                  <span class="entity-sub">{{ row.description || '暂无描述' }}</span>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="参数预览" min-width="230">
            <template #default="{ row }">
              <div class="field-chip-row">
                <span
                  v-for="field in (row.rows || []).slice(0, 2)"
                  :key="field.id || field.key"
                  class="soft-chip"
                >
                  {{ field.key || '—' }}
                  <template v-if="fieldTypeKey(field) === 'list'"> · {{ listCount(field) }} 项</template>
                  <template v-else-if="fieldTypeKey(field) === 'timestamp'"> · 时间戳</template>
                  <template v-else-if="normalizeParamRow(field).value !== ''">={{ normalizeParamRow(field).value }}</template>
                </span>
                <span v-if="(row.rows || []).length > 2" class="soft-chip">
                  +{{ (row.rows || []).length - 2 }}
                </span>
                <span v-if="!(row.rows || []).length" class="soft-chip is-empty">暂无参数</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="启用参数" width="104">
            <template #default="{ row }">
              <span class="soft-chip is-accent">{{ enabledCountOf(row) }} / {{ (row.rows || []).length }}</span>
            </template>
          </el-table-column>

          <el-table-column label="关联任务" width="98">
            <template #default="{ row }">
              <span class="soft-chip" :class="{ 'is-empty': !usageCount('params', row.id) }">
                {{ usageCount('params', row.id) }} 个任务
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
                <button class="row-action" type="button" title="编辑参数项" @click="openEdit(row)">
                  <el-icon><EditPen /></el-icon>
                </button>
                <button class="row-action is-danger" type="button" title="删除参数项" @click="deleteParam(row)">
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
            </template>
          </el-table-column>

          <template #empty>
            <EmptyState
              :icon="Operation"
              :title="store.params.length ? '没有匹配的参数项' : '还没有采集参数项'"
              :description="
                store.params.length
                  ? '换个关键词，或查看全部参数项。'
                  : '创建第一个参数项，管理分页与筛选参数。'
              "
            >
              <el-button v-if="store.params.length" @click="clearFilters">清除筛选</el-button>
              <el-button v-else type="primary" @click="openCreate">
                <el-icon><Plus /></el-icon>
                新建参数项
              </el-button>
            </EmptyState>
          </template>
        </el-table>
      </div>

      <div class="table-footer">
        <span class="footer-summary">
          共 <strong>{{ filteredParams.length }}</strong> 个参数项 · {{ enabledFields }} 个启用参数
        </span>
        <span class="table-service">
          <span class="service-dot" />
          自动拼接 Query String
        </span>
      </div>
    </section>

    <el-drawer
      v-model="drawerVisible"
      class="cf-drawer"
      size="min(720px, 100vw)"
      :close-on-click-modal="false"
      append-to-body
    >
      <template #header>
        <div class="drawer-heading">
          <span class="drawer-heading-icon">
            <el-icon><Operation /></el-icon>
          </span>
          <div class="drawer-heading-copy">
            <h3>{{ editingParam ? '编辑参数项' : '新建参数项' }}</h3>
            <p>支持静态文本、运行时时间戳和列表遍历值。</p>
          </div>
        </div>
      </template>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent>
        <section class="form-section">
          <div class="form-section-head">
            <span class="section-index">01</span>
            <h4>参数项信息</h4>
            <span class="section-note">名称与用途</span>
          </div>
          <el-form-item label="参数项名称" prop="name">
            <el-input v-model="form.name" maxlength="30" placeholder="例如 分页 · 前 20 条" />
          </el-form-item>
          <el-form-item label="用途说明">
            <el-input
              v-model="form.description"
              type="textarea"
              :rows="2"
              maxlength="80"
              resize="none"
              placeholder="说明参数模板适用场景（可选）"
            />
          </el-form-item>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <span class="section-index">02</span>
            <h4>请求参数</h4>
            <span class="section-note">参数名 / 值类型 / 值 / 启用</span>
          </div>
          <el-form-item prop="rows" label="Query 参数">
            <ParamRowsEditor :rows="form.rows" />
          </el-form-item>
          <p class="form-hint">
            <el-icon><InfoFilled /></el-icon>
            文本值会原样发送；时间戳在每次采集开始时生成；列表值第一项作为默认值，可在任务中配置逐项遍历。
          </p>
        </section>
      </el-form>

      <template #footer>
        <div class="drawer-footer">
          <el-button @click="drawerVisible = false">取消</el-button>
          <el-button type="primary" @click="saveParam">
            <el-icon><CircleCheck /></el-icon>
            {{ editingParam ? '保存修改' : '创建参数项' }}
          </el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>
