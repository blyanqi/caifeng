<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCheck,
  CopyDocument,
  Delete,
  Download,
  EditPen,
  Files,
  FolderOpened,
  InfoFilled,
  Loading,
  Plus,
  Search,
  View,
} from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import BulkActionBar from '../components/BulkActionBar.vue'
import { useBulkSelection } from '../composables/useBulkSelection'
import {
  createStorage,
  removeStorage,
  store,
  updateStorage,
  usageCount,
} from '../stores/collector'
import { formatDateTime, formatNumber, fromNow } from '../utils/format'
import { copyText } from '../utils/clipboard'
import {
  downloadStorageFile,
  openStorageFolder,
  previewStorageFile,
  storageSupportsFile,
  storageSupportsFolder,
} from '../utils/storageFiles'

const TYPE_META = {
  json: {
    label: 'JSON 文件',
    short: 'JSON',
    description: '保留嵌套结构，适合 API 快照',
    prefix: 'FILE',
    placeholder: 'data/collections/products.json',
  },
  csv: {
    label: 'CSV 文件',
    short: 'CSV',
    description: '按行展开，适合表格分析',
    prefix: 'FILE',
    placeholder: 'data/exports/products.csv',
  },
  html: {
    label: 'HTML 文件',
    short: 'HTML',
    description: '保存原始页面或 HTML 快照',
    prefix: 'FILE',
    placeholder: 'data/pages/products.html',
  },
  image_folder: {
    label: '图片文件夹',
    short: 'IMG',
    description: '采集图片并下载到目录',
    prefix: 'FOLDER',
    placeholder: 'data/media/images',
  },
  video_folder: {
    label: '视频文件夹',
    short: 'VID',
    description: '采集视频并下载到目录',
    prefix: 'FOLDER',
    placeholder: 'data/media/videos',
  },
  html_folder: {
    label: 'HTML 文件夹',
    short: 'HTML',
    description: '保存 HTML 页面快照',
    prefix: 'FOLDER',
    placeholder: 'data/pages',
  },
  db: {
    label: '数据库',
    short: 'DB',
    description: '保存数据库连接配置',
    prefix: 'DB',
    placeholder: 'mysql://127.0.0.1:3306/analytics',
  },
}

const activeType = ref('all')
const keyword = ref('')
const dialogVisible = ref(false)
const editingStorage = ref(null)
const formRef = ref(null)
const openingFolderId = ref('')
const downloadingFileId = ref('')
const previewVisible = ref(false)
const previewLoading = ref(false)
const previewData = ref(null)
const previewStorage = ref(null)
const previewMode = ref('source')
const { tableRef, selectedRows, bulkBusy, handleSelectionChange, clearSelection } =
  useBulkSelection()

const form = reactive({
  name: '',
  type: 'json',
  target: '',
  description: '',
  dbUsername: '',
  dbPassword: '',
  dbTable: '',
})

const rules = {
  name: [
    { required: true, message: '请填写存储名称', trigger: 'blur' },
    { max: 30, message: '名称不能超过 30 个字符', trigger: 'blur' },
  ],
  target: [
    { required: true, message: '请填写存储位置', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (!value) return callback()
        if (/\s/.test(value)) return callback(new Error('存储位置中不能包含空格'))
        callback()
      },
      trigger: 'blur',
    },
  ],
}

function recordsOf(storageId) {
  return Number(store.collected[storageId]?.total || 0)
}

function updatedAtOf(storageId) {
  return store.collected[storageId]?.updatedAt || ''
}

const totalRecords = computed(() =>
  store.storages.reduce((sum, storage) => sum + recordsOf(storage.id), 0),
)
const linkedTaskCount = computed(() => store.tasks.filter((task) => task.storageId).length)

const summaries = computed(() =>
  Object.keys(TYPE_META).map((type) => {
    const storages = store.storages.filter((storage) => storage.type === type)
    return {
      type,
      ...TYPE_META[type],
      count: storages.length,
      records: storages.reduce((sum, storage) => sum + recordsOf(storage.id), 0),
    }
  }),
)

const maxRecords = computed(() =>
  Math.max(1, ...store.storages.map((storage) => recordsOf(storage.id))),
)

const filteredStorages = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return store.storages.filter((storage) => {
    if (activeType.value !== 'all' && storage.type !== activeType.value) return false
    if (!query) return true
    return [storage.name, storage.target, storage.description, TYPE_META[storage.type]?.label]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  })
})

const activeTypeLabel = computed(() =>
  activeType.value === 'all' ? '全部存储' : TYPE_META[activeType.value].label,
)

watch(
  () => dialogVisible.value,
  (open) => {
    if (!open) return
    if (editingStorage.value) {
      Object.assign(form, {
        name: editingStorage.value.name,
        type: editingStorage.value.type || 'json',
        target: editingStorage.value.target || '',
        description: editingStorage.value.description || '',
        dbUsername: editingStorage.value.db?.username || '',
        dbPassword: editingStorage.value.db?.password || '',
        dbTable: editingStorage.value.db?.table || '',
      })
    } else {
      Object.assign(form, {
        name: '',
        type: 'json',
        target: '',
        description: '',
        dbUsername: '',
        dbPassword: '',
        dbTable: '',
      })
    }
    nextTick(() => formRef.value?.clearValidate())
  },
)

function openCreate() {
  editingStorage.value = null
  dialogVisible.value = true
}

function openEdit(storage) {
  editingStorage.value = storage
  dialogVisible.value = true
}

function setTypeFilter(type) {
  activeType.value = activeType.value === type ? 'all' : type
}

async function saveStorage() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  const duplicate = store.storages.some(
    (storage) =>
      storage.id !== editingStorage.value?.id && storage.name.trim() === form.name.trim(),
  )
  if (duplicate) {
    ElMessage.warning('已存在同名存储')
    return
  }
  const payload = {
    name: form.name.trim(),
    type: form.type,
    target: form.target.trim(),
    description: form.description.trim(),
    db:
      form.type === 'db'
        ? {
            username: form.dbUsername.trim(),
            password: form.dbPassword,
            table: form.dbTable.trim(),
          }
        : null,
  }
  if (editingStorage.value) {
    updateStorage(editingStorage.value.id, payload)
    ElMessage.success('存储已更新')
  } else {
    createStorage(payload)
    ElMessage.success('存储已创建')
  }
  dialogVisible.value = false
}

async function deleteStorage(storage) {
  const count = usageCount('storages', storage.id)
  if (count > 0) {
    await ElMessageBox.alert(
      `存储「${storage.name}」正被 ${count} 个采集任务使用。请先调整相关任务，再删除该存储。`,
      '无法删除存储',
      { confirmButtonText: '知道了', type: 'warning' },
    )
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除存储「${storage.name}」？本地归档记录也会被清除，此操作不可撤销。`,
      '删除存储',
      { confirmButtonText: '删除存储', cancelButtonText: '取消', type: 'warning' },
    )
    removeStorage(storage.id)
    ElMessage.success('存储已删除')
  } catch {
    // 用户取消
  }
}

async function deleteSelectedStorages() {
  if (!selectedRows.value.length || bulkBusy.value) return
  const blocked = selectedRows.value.filter(
    (storage) => usageCount('storages', storage.id) > 0,
  )
  const deletable = selectedRows.value.filter(
    (storage) => usageCount('storages', storage.id) === 0,
  )
  if (!deletable.length) {
    await ElMessageBox.alert(
      `选中的存储都正被采集任务使用：${blocked
        .slice(0, 3)
        .map((storage) => `「${storage.name}」`)
        .join('、')}${blocked.length > 3 ? ' 等' : ''}。请先调整相关任务。`,
      '无法批量删除',
      { confirmButtonText: '知道了', type: 'warning' },
    )
    return
  }
  try {
    await ElMessageBox.confirm(
      blocked.length
        ? `选中的 ${selectedRows.value.length} 个存储中，${blocked.length} 个正被任务使用将跳过。确认删除其余 ${deletable.length} 个？本地归档记录也会清除。`
        : `确认删除选中的 ${deletable.length} 个存储？本地归档记录也会清除，此操作不可撤销。`,
      '批量删除存储',
      { confirmButtonText: '删除存储', cancelButtonText: '取消', type: 'warning' },
    )
    bulkBusy.value = true
    deletable.forEach((storage) => removeStorage(storage.id))
    clearSelection()
    ElMessage.success(
      `已删除 ${deletable.length} 个存储${blocked.length ? `，跳过 ${blocked.length} 个被引用项` : ''}`,
    )
  } catch {
    // 用户取消
  } finally {
    bulkBusy.value = false
  }
}

async function copyTarget(target) {
  const ok = await copyText(target)
  ElMessage[ok ? 'success' : 'warning'](ok ? '存储位置已复制' : '复制失败，请手动选择')
}

function fileActionHint(storage) {
  if (!storageSupportsFolder(storage.type)) return '数据库连接配置不提供本地文件'
  if (!storageSupportsFile(storage.type)) return `文件夹 · ${storage.target}`
  return `data/ 目录 · ${storage.target}`
}

async function openFolder(storage) {
  if (!storageSupportsFolder(storage.type) || openingFolderId.value) return
  openingFolderId.value = storage.id
  try {
    await openStorageFolder(storage)
    ElMessage.success('已打开存储文件夹')
  } catch (error) {
    ElMessage.error(error?.message || '打开文件夹失败')
  } finally {
    openingFolderId.value = ''
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

async function previewFile(storage) {
  if (!storageSupportsFile(storage.type)) {
    ElMessage.warning('该存储类型没有可预览的文件')
    return
  }
  previewStorage.value = storage
  previewData.value = null
  previewMode.value = storage.type === 'html' ? 'render' : 'source'
  previewVisible.value = true
  previewLoading.value = true
  try {
    previewData.value = await previewStorageFile(storage)
  } catch (error) {
    ElMessage.error(error?.message || '文件预览失败')
    previewVisible.value = false
  } finally {
    previewLoading.value = false
  }
}

async function downloadPreviewFile() {
  if (!previewStorage.value) return
  try {
    await downloadStorageFile(previewStorage.value)
  } catch (error) {
    ElMessage.error(error?.message || '下载文件失败')
  }
}

async function downloadFile(storage) {
  if (!storageSupportsFile(storage.type) || downloadingFileId.value) return
  downloadingFileId.value = storage.id
  try {
    await downloadStorageFile(storage)
    ElMessage.success('文件已开始下载')
  } catch (error) {
    ElMessage.error(error?.message || '下载文件失败')
  } finally {
    downloadingFileId.value = ''
  }
}

function clearFilters() {
  activeType.value = 'all'
  keyword.value = ''
}
</script>

<template>
  <div class="storages-page">
    <PageHeader
      eyebrow="DESTINATIONS"
      title="存储管理"
      description="配置 JSON / CSV、图片 / 视频 / HTML 文件夹或数据库连接，查看归档规模并管理本地文件。"
    >
      <template #actions>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建存储
        </el-button>
      </template>
    </PageHeader>

    <div class="info-strip">
      <span class="info-strip-icon">
        <el-icon><Files /></el-icon>
      </span>
      <div class="info-strip-copy">
        <strong>多类型存储目标</strong>
        <span>支持 JSON / CSV、图片 / 视频 / HTML 文件夹与数据库连接配置；文件类存储可直接打开文件夹或下载。</span>
      </div>
      <div class="info-strip-stats">
        <div class="info-strip-stat">
          <strong>{{ store.storages.length }}</strong>
          <span>存储目标</span>
        </div>
        <div class="info-strip-stat">
          <strong>{{ formatNumber(totalRecords) }}</strong>
          <span>累计记录</span>
        </div>
        <div class="info-strip-stat">
          <strong>{{ linkedTaskCount }}</strong>
          <span>关联任务</span>
        </div>
      </div>
    </div>

    <div class="storage-summary">
      <button
        v-for="summary in summaries"
        :key="summary.type"
        class="storage-type-card"
        :class="{ 'is-active': activeType === summary.type }"
        type="button"
        @click="setTypeFilter(summary.type)"
      >
        <span class="storage-type-icon-lg" :class="`is-${summary.type}`">{{ summary.short }}</span>
        <span class="storage-type-copy">
          <strong>{{ summary.label }}</strong>
          <span>{{ summary.description }}</span>
        </span>
        <span class="storage-type-count">
          {{ summary.count }}
          <small>{{ formatNumber(summary.records) }} 条</small>
        </span>
      </button>
    </div>

    <section class="data-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>{{ activeTypeLabel }}</h2>
          <p>每个存储都可以被多个采集任务复用；文件写入 data/ 目录，数据库为连接配置</p>
        </div>
        <div class="toolbar-filter-note">
          <span>筛选 · {{ activeTypeLabel }}</span>
          <button v-if="activeType !== 'all'" type="button" @click="activeType = 'all'">查看全部</button>
        </div>
      </div>

      <div class="toolbar-filters">
        <el-input
          v-model="keyword"
          class="filter-search"
          clearable
          placeholder="搜索存储名称或位置"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <div class="filter-spacer" />
        <span class="filter-result">筛选结果 <strong>{{ filteredStorages.length }}</strong> 条</span>
      </div>

      <BulkActionBar
        :count="selectedRows.length"
        noun="存储"
        :busy="bulkBusy"
        @delete="deleteSelectedStorages"
        @clear="clearSelection"
      />

      <div class="table-wrap">
        <el-table
          ref="tableRef"
          :data="filteredStorages"
          class="cf-table"
          table-layout="fixed"
          row-key="id"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="43" />
          <el-table-column label="存储名称" min-width="215">
            <template #default="{ row }">
              <div class="entity-cell">
                <span class="storage-type-icon" :class="`type-${row.type}`">
                  {{ TYPE_META[row.type]?.short || row.type }}
                </span>
                <div class="entity-copy">
                  <span class="entity-name">{{ row.name }}</span>
                  <span class="entity-sub">{{ row.description || '暂无描述' }}</span>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="类型" width="90">
            <template #default="{ row }">
              <span class="type-tag" :class="`is-${row.type}`">
                {{ TYPE_META[row.type]?.label || row.type }}
              </span>
            </template>
          </el-table-column>

          <el-table-column label="存储位置" min-width="205">
            <template #default="{ row }">
              <div class="copy-value">
                <span class="code-text" style="max-width: 160px" :title="row.target">{{ row.target }}</span>
                <button class="copy-btn" type="button" title="复制存储位置" @click="copyTarget(row.target)">
                  <el-icon><CopyDocument /></el-icon>
                </button>
              </div>
              <span v-if="row.type === 'db'" class="entity-sub">
                用户名 {{ row.db?.username || '未配置' }}{{ row.db?.table ? ` · 表 ${row.db.table}` : '' }}
              </span>
              <span v-else-if="!storageSupportsFile(row.type)" class="entity-sub">文件夹存储</span>
            </template>
          </el-table-column>

          <el-table-column label="累计归档" width="145">
            <template #default="{ row }">
              <div class="usage-cell">
                <div class="usage-cell-top">
                  <span class="mono-text" style="color: #454b59">{{ formatNumber(recordsOf(row.id)) }}</span>
                  <span>条</span>
                </div>
                <div class="usage-bar">
                  <i :style="{ width: `${Math.max(4, (recordsOf(row.id) / maxRecords) * 100)}%` }" />
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="最近写入" width="122">
            <template #default="{ row }">
              <div class="stack">
                <span class="mono-text" style="color: #5d6372">
                  {{ updatedAtOf(row.id) ? formatDateTime(updatedAtOf(row.id)) : '尚未写入' }}
                </span>
                <span class="entity-sub">
                  {{ updatedAtOf(row.id) ? fromNow(updatedAtOf(row.id)) : '等待首次采集' }}
                </span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="关联任务" width="88">
            <template #default="{ row }">
              <span class="soft-chip" :class="{ 'is-empty': !usageCount('storages', row.id) }">
                {{ usageCount('storages', row.id) }} 个任务
              </span>
            </template>
          </el-table-column>

          <el-table-column label="文件操作" width="220">
            <template #default="{ row }">
              <div class="storage-file-actions">
                <button
                  class="storage-file-action"
                  type="button"
                  :disabled="!storageSupportsFile(row.type)"
                  :title="storageSupportsFile(row.type) ? '预览文件内容' : '文件夹类型请打开文件夹'"
                  @click="previewFile(row)"
                >
                  <el-icon><View /></el-icon>
                  预览
                </button>
                <button
                  class="storage-file-action"
                  type="button"
                  :disabled="!storageSupportsFolder(row.type) || Boolean(openingFolderId)"
                  :title="fileActionHint(row)"
                  @click="openFolder(row)"
                >
                  <el-icon><FolderOpened /></el-icon>
                  打开文件夹
                </button>
                <button
                  class="storage-file-action"
                  type="button"
                  :disabled="!storageSupportsFile(row.type) || Boolean(downloadingFileId)"
                  :title="storageSupportsFile(row.type) ? fileActionHint(row) : '文件夹类型请使用打开文件夹'"
                  @click="downloadFile(row)"
                >
                  <el-icon><Download /></el-icon>
                  下载文件
                </button>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="80" align="right">
            <template #default="{ row }">
              <div class="action-cluster">
                <button class="row-action" type="button" title="编辑存储" @click="openEdit(row)">
                  <el-icon><EditPen /></el-icon>
                </button>
                <button class="row-action is-danger" type="button" title="删除存储" @click="deleteStorage(row)">
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
            </template>
          </el-table-column>

          <template #empty>
            <EmptyState
              :icon="Files"
              :title="store.storages.length ? '没有匹配的存储' : '还没有存储目标'"
              :description="
                store.storages.length
                  ? '清除类型筛选或换个关键词试试。'
                  : '创建第一个存储目标，让采集结果有处可去。'
              "
            >
              <el-button v-if="store.storages.length" @click="clearFilters">清除筛选</el-button>
              <el-button v-else type="primary" @click="openCreate">
                <el-icon><Plus /></el-icon>
                新建存储
              </el-button>
            </EmptyState>
          </template>
        </el-table>
      </div>

      <div class="table-footer">
        <span class="footer-summary">
          共 <strong>{{ filteredStorages.length }}</strong> 个存储 · 累计
          <strong>{{ formatNumber(totalRecords) }}</strong> 条记录
        </span>
        <span class="table-service">
          <span class="service-dot" />
          本地文件与媒体归档可用
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
            <el-icon><Files /></el-icon>
          </span>
          <div class="dialog-heading-copy">
            <h3>{{ editingStorage ? '编辑存储目标' : '新建存储目标' }}</h3>
            <p>指定采集结果的落点，任务成功运行后会写入这里。</p>
          </div>
        </div>
      </template>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent>
        <section class="form-section">
          <div class="form-section-head">
            <span class="section-index">01</span>
            <h4>存储类型</h4>
            <span class="section-note">文件 / 文件夹 / 数据库</span>
          </div>
          <div class="type-choice-grid">
            <button
              v-for="(meta, type) in TYPE_META"
              :key="type"
              class="type-choice"
              :class="{ 'is-active': form.type === type }"
              type="button"
              @click="form.type = type"
            >
              <span class="storage-type-icon-lg" :class="`is-${type}`">{{ meta.short }}</span>
              <span class="type-choice-copy">
                <strong>{{ meta.label }}</strong>
                <small>{{ meta.description }}</small>
              </span>
              <span v-if="form.type === type" class="type-choice-check">✓</span>
            </button>
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <span class="section-index">02</span>
            <h4>目标信息</h4>
            <span class="section-note">名称与存储位置</span>
          </div>
          <div class="form-grid">
            <el-form-item class="span-2" label="存储名称" prop="name">
              <el-input v-model="form.name" maxlength="30" placeholder="例如 商品快照 · JSON" />
            </el-form-item>
            <el-form-item
              class="span-2"
              :label="
                form.type === 'db'
                  ? '连接配置'
                  : ['image_folder', 'video_folder', 'html_folder'].includes(form.type)
                    ? '文件夹位置'
                    : '文件位置'
              "
              prop="target"
            >
              <el-input v-model="form.target" :placeholder="TYPE_META[form.type]?.placeholder">
                <template #prefix>
                  <span class="input-prefix-path">{{ TYPE_META[form.type]?.prefix }}</span>
                </template>
              </el-input>
            </el-form-item>
            <template v-if="form.type === 'db'">
              <el-form-item label="用户名">
                <el-input
                  v-model="form.dbUsername"
                  autocomplete="off"
                  placeholder="数据库用户名（可选）"
                />
              </el-form-item>
              <el-form-item label="密码">
                <el-input
                  v-model="form.dbPassword"
                  type="password"
                  show-password
                  autocomplete="new-password"
                  placeholder="数据库密码（可选）"
                />
              </el-form-item>
              <el-form-item class="span-2" label="数据表">
                <el-input v-model="form.dbTable" placeholder="例如 collected_items（可选）" />
              </el-form-item>
            </template>
            <el-form-item class="span-2" label="存储说明">
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="2"
                maxlength="80"
                resize="none"
                placeholder="说明数据用途或保留策略（可选）"
              />
            </el-form-item>
          </div>
          <p class="form-hint">
            <el-icon><InfoFilled /></el-icon>
            <template v-if="form.type === 'db'">
              连接配置、用户名和密码会保存在本地工作区；数据库写入适配器需由服务端提供。
            </template>
            <template v-else-if="['image_folder', 'video_folder'].includes(form.type)">
              媒体采集任务会把图片 / 视频文件下载到此文件夹，并写入 _manifest.json 清单。
            </template>
            <template v-else-if="form.type === 'html_folder'">
              HTML / 网页片段任务会把原始页面保存到此文件夹，并写入 _manifest.json 清单。
            </template>
            <template v-else-if="form.type === 'html'">
              HTML / 网页片段任务会把页面源码写入单个 HTML 文件；JSON 等模式会生成可预览的 HTML 快照。
            </template>
            <template v-else>
              运行记录会归档到服务端工作区，结果同步写入项目 data/ 目录；可在存储列表打开文件夹或下载文件。
            </template>
          </p>
        </section>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">
            {{
              form.type === 'db'
                ? '数据库凭据仅保存在本地浏览器'
                : '存储位置相对项目 data/ 目录'
            }}
          </span>
          <div class="dialog-footer-actions">
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" @click="saveStorage">
              <el-icon><CircleCheck /></el-icon>
              {{ editingStorage ? '保存修改' : '创建存储' }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="previewVisible"
      class="cf-dialog file-preview-dialog"
      width="min(980px, 96vw)"
      append-to-body
    >
      <template #header>
        <div class="dialog-heading">
          <span class="dialog-heading-icon"><el-icon><View /></el-icon></span>
          <div class="dialog-heading-copy">
            <h3>{{ previewStorage?.name || '文件预览' }}</h3>
            <p>{{ previewStorage?.target }}</p>
          </div>
        </div>
      </template>

      <div v-if="previewLoading" class="preview-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
        正在读取文件…
      </div>
      <template v-else-if="previewData">
        <div class="preview-meta-row">
          <span>{{ formatBytes(previewData.bytes) }}</span>
          <span>{{ formatDateTime(previewData.updatedAt) }}</span>
          <span v-if="previewData.truncated" class="preview-truncated">仅显示前 200KB</span>
          <div v-if="previewStorage?.type === 'html'" class="preview-mode">
            <button
              type="button"
              :class="{ 'is-active': previewMode === 'render' }"
              @click="previewMode = 'render'"
            >
              渲染预览
            </button>
            <button
              type="button"
              :class="{ 'is-active': previewMode === 'source' }"
              @click="previewMode = 'source'"
            >
              源码
            </button>
          </div>
        </div>
        <pre v-if="previewMode === 'source'" class="file-preview-code">{{ previewData.content }}</pre>
        <iframe
          v-else
          class="file-preview-frame"
          sandbox=""
          :srcdoc="previewData.content"
          title="HTML preview"
        />
      </template>

      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">{{ previewData?.path || '' }}</span>
          <div class="dialog-footer-actions">
            <el-button @click="previewVisible = false">关闭</el-button>
            <el-button type="primary" @click="downloadPreviewFile">
              <el-icon><Download /></el-icon>
              下载文件
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
