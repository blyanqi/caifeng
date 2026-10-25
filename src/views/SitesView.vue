<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCheck,
  CopyDocument,
  Delete,
  EditPen,
  InfoFilled,
  Link,
  Plus,
  Search,
  SetUp,
} from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import SiteRuleDrawer from '../components/SiteRuleDrawer.vue'
import BulkActionBar from '../components/BulkActionBar.vue'
import { useBulkSelection } from '../composables/useBulkSelection'
import {
  createSite,
  removeSite,
  store,
  updateSite,
  usageCount,
} from '../stores/collector'
import { formatDateTime, hostOf } from '../utils/format'
import { copyText } from '../utils/clipboard'

const activeTab = ref('all')
const keyword = ref('')
const dialogVisible = ref(false)
const editingSite = ref(null)
const formRef = ref(null)
const ruleDrawerVisible = ref(false)
const ruleSite = ref(null)
const { tableRef, selectedRows, bulkBusy, handleSelectionChange, clearSelection } =
  useBulkSelection()

const form = reactive({
  name: '',
  baseUrl: '',
  description: '',
  enabled: true,
})

const rules = {
  name: [
    { required: true, message: '请填写站点名称', trigger: 'blur' },
    { max: 30, message: '名称不能超过 30 个字符', trigger: 'blur' },
  ],
  baseUrl: [
    { required: true, message: '请填写站点地址', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (!value) return callback()
        if (/\s/.test(value)) return callback(new Error('地址中不能包含空格'))
        if (/^https?:\/\/.+/i.test(value) || /^\/[^\s]*$/.test(value)) return callback()
        callback(new Error('请输入 http(s):// 完整地址，或以 / 开头的本地路径'))
      },
      trigger: 'blur',
    },
  ],
}

const tabs = computed(() => [
  { key: 'all', label: '全部站点', count: store.sites.length },
  { key: 'enabled', label: '已启用', count: store.sites.filter((site) => site.enabled).length },
  { key: 'disabled', label: '已停用', count: store.sites.filter((site) => !site.enabled).length },
])

const enabledCount = computed(() => store.sites.filter((site) => site.enabled).length)
const pageRuleCount = computed(
  () =>
    store.sites.filter(
      (site) => site.pageRule?.enabled && site.pageRule?.itemSelector?.trim(),
    ).length,
)
const linkedTaskCount = computed(() => store.tasks.filter((task) => task.siteId).length)

const filteredSites = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return store.sites.filter((site) => {
    if (activeTab.value === 'enabled' && !site.enabled) return false
    if (activeTab.value === 'disabled' && site.enabled) return false
    if (!query) return true
    return [site.name, site.baseUrl, site.description]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  })
})

watch(
  () => dialogVisible.value,
  (open) => {
    if (!open) return
    if (editingSite.value) {
      Object.assign(form, {
        name: editingSite.value.name,
        baseUrl: editingSite.value.baseUrl,
        description: editingSite.value.description || '',
        enabled: editingSite.value.enabled !== false,
      })
    } else {
      Object.assign(form, { name: '', baseUrl: '', description: '', enabled: true })
    }
    nextTick(() => formRef.value?.clearValidate())
  },
)

function openCreate() {
  editingSite.value = null
  dialogVisible.value = true
}

function openEdit(site) {
  editingSite.value = site
  dialogVisible.value = true
}

function openRule(site) {
  ruleSite.value = site
  ruleDrawerVisible.value = true
}

function pageRuleFieldCount(site) {
  return (site.pageRule?.fields || []).filter(
    (field) => field.enabled !== false && field.key?.trim(),
  ).length
}

function pageRuleLevelCount(site) {
  if (!site.pageRule?.crawl?.enabled) return 1
  return 1 + (site.pageRule.crawl.levels || []).filter((level) => level.enabled !== false).length
}

function pageRulePaginationLabel(site) {
  const mode = site.pageRule?.pagination?.mode
  if (!site.pageRule?.enabled) return '未启用页面采集'
  if (site.pageRule?.crawl?.enabled) {
    return `多级采集 · ${pageRuleLevelCount(site)} 级`
  }
  if (mode === 'pageParam') return `分页参数 · ${site.pageRule.pagination?.param || 'page'}`
  if (mode === 'nextLink') return '跟随下一页链接'
  return '单页采集'
}

async function saveSite() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  const duplicate = store.sites.some(
    (site) => site.id !== editingSite.value?.id && site.name.trim() === form.name.trim(),
  )
  if (duplicate) {
    ElMessage.warning('已存在同名站点')
    return
  }
  const payload = {
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim(),
    description: form.description.trim(),
    enabled: form.enabled,
  }
  if (editingSite.value) {
    updateSite(editingSite.value.id, payload)
    ElMessage.success('站点已更新')
  } else {
    createSite(payload)
    ElMessage.success('站点已创建')
  }
  dialogVisible.value = false
}

async function deleteSite(site) {
  const count = usageCount('sites', site.id)
  if (count > 0) {
    await ElMessageBox.alert(
      `站点「${site.name}」正被 ${count} 个采集任务使用。请先在采集列表中调整这些任务，再删除站点。`,
      '无法删除站点',
      { confirmButtonText: '知道了', type: 'warning' },
    )
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除站点「${site.name}」？此操作不可撤销。`,
      '删除采集站点',
      { confirmButtonText: '删除站点', cancelButtonText: '取消', type: 'warning' },
    )
    removeSite(site.id)
    ElMessage.success('站点已删除')
  } catch {
    // 用户取消
  }
}

function blockedSiteNames(sites) {
  return sites
    .slice(0, 3)
    .map((site) => `「${site.name}」`)
    .join('、')
}

async function deleteSelectedSites() {
  if (!selectedRows.value.length || bulkBusy.value) return
  const blocked = selectedRows.value.filter((site) => usageCount('sites', site.id) > 0)
  const deletable = selectedRows.value.filter((site) => usageCount('sites', site.id) === 0)
  if (!deletable.length) {
    await ElMessageBox.alert(
      `选中的站点都正被采集任务使用：${blockedSiteNames(blocked)}${blocked.length > 3 ? ' 等' : ''}。请先调整相关任务。`,
      '无法批量删除',
      { confirmButtonText: '知道了', type: 'warning' },
    )
    return
  }
  try {
    await ElMessageBox.confirm(
      blocked.length
        ? `选中的 ${selectedRows.value.length} 个站点中，${blocked.length} 个正被任务使用将跳过。确认删除其余 ${deletable.length} 个站点？`
        : `确认删除选中的 ${deletable.length} 个站点？此操作不可撤销。`,
      '批量删除站点',
      { confirmButtonText: '删除站点', cancelButtonText: '取消', type: 'warning' },
    )
    bulkBusy.value = true
    deletable.forEach((site) => removeSite(site.id))
    clearSelection()
    ElMessage.success(
      `已删除 ${deletable.length} 个站点${blocked.length ? `，跳过 ${blocked.length} 个被引用项` : ''}`,
    )
  } catch {
    // 用户取消
  } finally {
    bulkBusy.value = false
  }
}

function setSelectedSitesEnabled(enabled) {
  if (!selectedRows.value.length) return
  selectedRows.value.forEach((site) => updateSite(site.id, { enabled }))
  ElMessage.success(`已${enabled ? '启用' : '停用'} ${selectedRows.value.length} 个站点`)
  clearSelection()
}

function handleToggle(site, value) {
  ElMessage.success(value ? `已启用「${site.name}」` : `已停用「${site.name}」`)
}

async function copyUrl(url) {
  const ok = await copyText(url)
  ElMessage[ok ? 'success' : 'warning'](ok ? '站点地址已复制' : '复制失败，请手动选择地址')
}

function clearFilters() {
  keyword.value = ''
  activeTab.value = 'all'
}
</script>

<template>
  <div class="sites-page">
    <PageHeader
      eyebrow="DATA SOURCES"
      title="采集站点"
      description="管理数据源入口，维护站点地址、页面规则与连接状态。支持对真实网页做 CSS 选择器采集。"
    >
      <template #actions>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建站点
        </el-button>
      </template>
    </PageHeader>

    <div class="info-strip">
      <span class="info-strip-icon">
        <el-icon><Link /></el-icon>
      </span>
      <div class="info-strip-copy">
        <strong>服务端代理 · 页面解析</strong>
        <span>支持 CSS 选择器、字段映射与分页规则；页面请求经本地服务端代理转发，可携带完整 Header。</span>
      </div>
      <div class="info-strip-stats">
        <div class="info-strip-stat">
          <strong>{{ store.sites.length }}</strong>
          <span>全部站点</span>
        </div>
        <div class="info-strip-stat">
          <strong>{{ enabledCount }}</strong>
          <span>启用中</span>
        </div>
        <div class="info-strip-stat">
          <strong>{{ pageRuleCount }}</strong>
          <span>页面规则</span>
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
          <h2>站点目录</h2>
          <p>一个站点可以被多个采集任务复用</p>
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
          placeholder="搜索站点名称或地址"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <div class="filter-spacer" />
        <span class="filter-result">筛选结果 <strong>{{ filteredSites.length }}</strong> 条</span>
      </div>

      <BulkActionBar
        :count="selectedRows.length"
        noun="站点"
        :busy="bulkBusy"
        @delete="deleteSelectedSites"
        @clear="clearSelection"
      >
        <template #actions>
          <button class="bulk-action" type="button" @click="setSelectedSitesEnabled(true)">
            批量启用
          </button>
          <button class="bulk-action" type="button" @click="setSelectedSitesEnabled(false)">
            批量停用
          </button>
        </template>
      </BulkActionBar>

      <div class="table-wrap">
        <el-table
          ref="tableRef"
          :data="filteredSites"
          class="cf-table"
          table-layout="fixed"
          row-key="id"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="43" />
          <el-table-column label="站点" min-width="218">
            <template #default="{ row }">
              <div class="entity-cell">
                <div class="entity-avatar is-soft">
                  <el-icon><Link /></el-icon>
                </div>
                <div class="entity-copy">
                  <span class="entity-name">{{ row.name }}</span>
                  <span class="entity-sub">{{ row.description || '暂无描述' }}</span>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="站点地址" min-width="205">
            <template #default="{ row }">
              <div class="copy-value">
                <span class="code-text" style="max-width: 175px">{{ row.baseUrl }}</span>
                <button class="copy-btn" type="button" title="复制地址" @click="copyUrl(row.baseUrl)">
                  <el-icon><CopyDocument /></el-icon>
                </button>
              </div>
              <span class="entity-sub">{{ hostOf(row.baseUrl) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="页面规则" width="142">
            <template #default="{ row }">
              <div class="stack">
                <span
                  class="soft-chip"
                  :class="row.pageRule?.enabled ? 'is-accent' : 'is-empty'"
                >
                  {{ row.pageRule?.enabled ? `${pageRuleFieldCount(row)} 个字段${pageRuleLevelCount(row) > 1 ? ` · ${pageRuleLevelCount(row)} 级` : ''}` : '未启用' }}
                </span>
                <span class="entity-sub">{{ pageRulePaginationLabel(row) }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="关联任务" width="90">
            <template #default="{ row }">
              <span class="soft-chip" :class="{ 'is-empty': !usageCount('sites', row.id) }">
                {{ usageCount('sites', row.id) }} 个
              </span>
            </template>
          </el-table-column>

          <el-table-column label="连接状态" width="110">
            <template #default="{ row }">
              <div class="editable-switch">
                <el-switch v-model="row.enabled" @change="(value) => handleToggle(row, value)" />
                <span :style="{ color: row.enabled ? '#475467' : '#9a9eab' }">
                  {{ row.enabled ? '已启用' : '已停用' }}
                </span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="最近更新" width="118">
            <template #default="{ row }">
              <span class="mono-text" style="color: #5d6372">{{ formatDateTime(row.updatedAt) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="106" align="right">
            <template #default="{ row }">
              <div class="action-cluster">
                <button class="row-action" type="button" title="页面规则与连接测试" @click="openRule(row)">
                  <el-icon><SetUp /></el-icon>
                </button>
                <button class="row-action" type="button" title="编辑站点" @click="openEdit(row)">
                  <el-icon><EditPen /></el-icon>
                </button>
                <button class="row-action is-danger" type="button" title="删除站点" @click="deleteSite(row)">
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
            </template>
          </el-table-column>

          <template #empty>
            <EmptyState
              :icon="Link"
              :title="store.sites.length ? '没有匹配的站点' : '还没有采集站点'"
              :description="
                store.sites.length
                  ? '换一个关键词，或切换站点状态筛选。'
                  : '添加第一个数据源站点，开始配置采集。'
              "
            >
              <el-button v-if="store.sites.length" @click="clearFilters">清除筛选</el-button>
              <el-button v-else type="primary" @click="openCreate">
                <el-icon><Plus /></el-icon>
                新建站点
              </el-button>
            </EmptyState>
          </template>
        </el-table>
      </div>

      <div class="table-footer">
        <span class="footer-summary">
          共 <strong>{{ filteredSites.length }}</strong> 个站点 · {{ enabledCount }} 个已启用 ·
          {{ pageRuleCount }} 个页面规则
        </span>
        <span class="table-service" :class="{ 'is-off': !enabledCount }">
          <span class="service-dot" />
          {{ enabledCount ? '数据源连接正常' : '暂无启用站点' }}
        </span>
      </div>
    </section>

    <el-dialog
      v-model="dialogVisible"
      class="cf-dialog"
      width="min(570px, 94vw)"
      :close-on-click-modal="false"
      append-to-body
    >
      <template #header>
        <div class="dialog-heading">
          <span class="dialog-heading-icon">
            <el-icon><Link /></el-icon>
          </span>
          <div class="dialog-heading-copy">
            <h3>{{ editingSite ? '编辑采集站点' : '新建采集站点' }}</h3>
            <p>保存数据源的基础地址，供采集配置与任务关联。</p>
          </div>
        </div>
      </template>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent>
        <section class="form-section">
          <div class="form-section-head">
            <span class="section-index">01</span>
            <h4>站点信息</h4>
            <span class="section-note">基础地址与状态</span>
          </div>
          <div class="form-grid">
            <el-form-item class="span-2" label="站点名称" prop="name">
              <el-input v-model="form.name" maxlength="30" placeholder="例如 商品数据 API" />
            </el-form-item>
            <el-form-item class="span-2" label="站点地址" prop="baseUrl">
              <el-input v-model="form.baseUrl" placeholder="https://api.example.com 或 /api" />
            </el-form-item>
            <el-form-item class="span-2" label="站点描述">
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="2"
                maxlength="80"
                resize="none"
                placeholder="简单说明数据源用途（可选）"
              />
            </el-form-item>
            <div class="span-2 toggle-row">
              <div>
                <strong>启用站点</strong>
                <span>停用后，关联任务将无法发起采集请求</span>
              </div>
              <el-switch v-model="form.enabled" />
            </div>
          </div>
          <p class="form-hint">
            <el-icon><InfoFilled /></el-icon>
            支持完整 HTTP(S) 地址或以 / 开头的站内路径；页面选择器与分页规则请在列表的「页面规则」中单独配置。
          </p>
        </section>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">站点地址修改后，关联任务立即使用新地址</span>
          <div class="dialog-footer-actions">
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" @click="saveSite">
              <el-icon><CircleCheck /></el-icon>
              {{ editingSite ? '保存修改' : '创建站点' }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <SiteRuleDrawer v-model="ruleDrawerVisible" :site="ruleSite" />
  </div>
</template>
