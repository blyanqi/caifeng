<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  CircleCheck,
  Connection,
  Delete,
  InfoFilled,
  Loading,
  Plus,
  SetUp,
  VideoPlay,
  WarningFilled,
} from '@element-plus/icons-vue'
import {
  collectHtmlPages,
  fetchHtmlPage,
} from '../utils/pageCollector'
import { resolveEndpoint } from '../utils/collector'
import { updateSite } from '../stores/collector'
import {
  formatNumber,
  hostOf,
  recordKeys,
  truncate,
  uid,
} from '../utils/format'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  site: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue', 'saved'])

const ATTR_OPTIONS = [
  { value: 'text', label: '文本内容' },
  { value: 'html', label: 'HTML 内容' },
  { value: 'href', label: 'href 属性' },
  { value: 'src', label: 'src 属性' },
  { value: 'attribute', label: '自定义属性' },
]

const PAGINATION_OPTIONS = [
  { value: 'none', label: '单页采集' },
  { value: 'pageParam', label: '分页参数' },
  { value: 'nextLink', label: '跟随下一页链接' },
]

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

function emptyField(key = '') {
  return { id: uid('field'), key, selector: '', attr: 'text', attribute: '', enabled: true }
}

function emptyLevel(index = 0) {
  return {
    id: uid('level'),
    name: `第 ${index + 2} 级详情页`,
    linkField: '',
    itemSelector: '',
    fields: [emptyField('title'), emptyField('content')],
    dynamic: { enabled: false, waitMs: 1200 },
    pagination: {
      mode: 'none',
      param: 'page',
      startPage: 1,
      maxPages: 1,
      nextSelector: 'a.next-page',
    },
    enabled: true,
  }
}

function createDefaultRule() {
  return {
    enabled: false,
    listPath: '/',
    itemSelector: '',
    fields: [emptyField('title')],
    pagination: {
      mode: 'none',
      param: 'page',
      startPage: 1,
      maxPages: 1,
      nextSelector: 'a.next-page',
    },
    crawl: {
      enabled: false,
      maxItems: 100,
      concurrency: 3,
      skipErrors: true,
      childPrefix: 'detail_',
      levels: [],
    },
  }
}

const form = reactive(createDefaultRule())
const testState = reactive({
  status: 'idle',
  message: '配置好列表页地址与选择器后，可以发起一次测试采集。',
  error: '',
  httpStatus: '',
  duration: 0,
  count: 0,
  pages: 0,
  records: [],
  url: '',
  mode: '',
})

const testLoading = computed(() => testState.status === 'running')
const previewColumns = computed(() => recordKeys(testState.records).slice(0, 4))
const previewRows = computed(() => testState.records.slice(0, 5))
const hiddenColumns = computed(() => {
  const count = recordKeys(testState.records).length
  return count > previewColumns.value.length ? count - previewColumns.value.length : 0
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const rule = props.site?.pageRule
    const next = createDefaultRule()
    if (rule) {
      next.enabled = rule.enabled !== false
      next.listPath = rule.listPath || '/'
      next.itemSelector = rule.itemSelector || ''
      next.fields = (rule.fields || []).map((field) => ({ ...field, id: field.id || uid('field') }))
      next.pagination = {
        ...next.pagination,
        ...(rule.pagination || {}),
        startPage: Number(rule.pagination?.startPage || 1),
        maxPages: Number(rule.pagination?.maxPages || 1),
      }
      const crawl = rule.crawl || {}
      next.crawl = {
        ...next.crawl,
        enabled: crawl.enabled === true,
        maxItems: Number(crawl.maxItems || 100),
        concurrency: Number(crawl.concurrency || 3),
        skipErrors: crawl.skipErrors !== false,
        childPrefix: crawl.childPrefix ?? 'detail_',
        levels: (Array.isArray(crawl.levels) ? crawl.levels : []).map((level, index) => ({
          ...emptyLevel(index),
          ...level,
          id: level.id || uid('level'),
          fields: (level.fields || []).map((field) => ({
            ...field,
            id: field.id || uid('field'),
          })),
          dynamic: {
            enabled: level.dynamic?.enabled === true,
            waitMs: Number(level.dynamic?.waitMs || 1200),
          },
        })),
      }
    }
    Object.assign(form, next)
    resetTest()
  },
)

function resetTest() {
  Object.assign(testState, {
    status: 'idle',
    message: '配置好列表页地址与选择器后，可以发起一次测试采集。',
    error: '',
    httpStatus: '',
    duration: 0,
    count: 0,
    pages: 0,
    records: [],
    url: '',
    mode: '',
  })
}

function addField() {
  form.fields.push(emptyField(`field${form.fields.length + 1}`))
}

function removeField(index) {
  form.fields.splice(index, 1)
}

function validFields() {
  return (form.fields || []).filter((field) => field.enabled !== false && field.key?.trim())
}

function validLevelFields(level) {
  return (level?.fields || []).filter(
    (field) => field.enabled !== false && field.key?.trim(),
  )
}

function addLevel() {
  if (form.crawl.levels.length >= 2) {
    ElMessage.warning('最多支持三级页面采集')
    return
  }
  form.crawl.levels.push(emptyLevel(form.crawl.levels.length))
}

function removeLevel(index) {
  form.crawl.levels.splice(index, 1)
  form.crawl.levels.forEach((level, levelIndex) => {
    level.name = level.name || `第 ${levelIndex + 2} 级详情页`
  })
}

function addLevelField(level) {
  level.fields.push(emptyField(`field${level.fields.length + 1}`))
}

function removeLevelField(level, index) {
  level.fields.splice(index, 1)
}

function parentFieldsFor(levelIndex) {
  if (levelIndex === 0) return validFields()
  return validLevelFields(form.crawl.levels[levelIndex - 1])
}

function enableCrawlLevels() {
  if (form.crawl.enabled && !form.crawl.levels.length) addLevel()
}

watch(
  () => form.crawl.enabled,
  (enabled) => {
    if (enabled) enableCrawlLevels()
  },
)

function validatePagination() {
  const maxPages = Number(form.pagination.maxPages)
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) {
    return '最大页数应为 1 - 10 之间的整数'
  }
  if (form.pagination.mode === 'pageParam' && !form.pagination.param?.trim()) {
    return '使用分页参数时，请填写参数名'
  }
  if (form.pagination.mode === 'nextLink' && !form.pagination.nextSelector?.trim()) {
    return '跟随下一页链接时，请填写下一页选择器'
  }
  return ''
}

function validateForSave() {
  if (!form.enabled) return ''
  if (!form.listPath?.trim()) return '请填写列表页路径'
  if (!form.itemSelector?.trim()) return '请填写列表条目选择器'
  const fields = validFields()
  if (!fields.length) return '请至少配置一个启用的字段映射'
  const keys = fields.map((field) => field.key.trim())
  if (new Set(keys).size !== keys.length) return '字段名不能重复'
  if (fields.some((field) => field.attr === 'attribute' && !field.attribute?.trim())) {
    return '使用自定义属性时，请填写属性名'
  }
  if (form.crawl?.enabled) {
    if (!form.crawl.levels.length) return '启用多级采集后至少需要配置一个详情层'
    if (
      !Number.isInteger(Number(form.crawl.maxItems)) ||
      Number(form.crawl.maxItems) < 1 ||
      Number(form.crawl.maxItems) > 2000
    ) {
      return '详情页最大数量应为 1 - 2000'
    }
    if (
      !Number.isInteger(Number(form.crawl.concurrency)) ||
      Number(form.crawl.concurrency) < 1 ||
      Number(form.crawl.concurrency) > 5
    ) {
      return '详情页并发数应为 1 - 5'
    }
    for (let index = 0; index < form.crawl.levels.length; index += 1) {
      const level = form.crawl.levels[index]
      if (!level.linkField?.trim()) return `第 ${index + 2} 级缺少链接字段`
      const parentKeys = new Set(parentFieldsFor(index).map((field) => field.key.trim()))
      if (!parentKeys.has(level.linkField.trim())) {
        return `第 ${index + 2} 级的链接字段不在上一级字段中`
      }
      const levelFields = validLevelFields(level)
      if (!levelFields.length) return `第 ${index + 2} 级至少需要一个字段`
      const keys = levelFields.map((field) => field.key.trim())
      if (new Set(keys).size !== keys.length) return `第 ${index + 2} 级字段名不能重复`
      if (
        levelFields.some(
          (field) => field.attr === 'attribute' && !field.attribute?.trim(),
        )
      ) {
        return `第 ${index + 2} 级有字段缺少自定义属性名`
      }
    }
  }
  return validatePagination()
}

function buildPayload() {
  return {
    enabled: form.enabled,
    listPath: form.listPath.trim() || '/',
    itemSelector: form.itemSelector.trim(),
    fields: (form.fields || [])
      .filter((field) => field.key?.trim())
      .map((field) => ({
        id: field.id || uid('field'),
        key: field.key.trim(),
        selector: field.selector?.trim() || '',
        attr: field.attr || 'text',
        attribute: field.attribute?.trim() || '',
        enabled: field.enabled !== false,
      })),
    pagination: {
      mode: form.pagination.mode || 'none',
      param: form.pagination.param?.trim() || 'page',
      startPage: Number(form.pagination.startPage) || 1,
      maxPages: Number(form.pagination.maxPages) || 1,
      nextSelector: form.pagination.nextSelector?.trim() || '',
    },
    crawl: form.crawl?.enabled
      ? {
          enabled: true,
          maxItems: Math.min(Math.max(Number(form.crawl.maxItems) || 100, 1), 2000),
          concurrency: Math.min(Math.max(Number(form.crawl.concurrency) || 3, 1), 5),
          skipErrors: form.crawl.skipErrors !== false,
          childPrefix: form.crawl.childPrefix?.trim() || '',
          levels: form.crawl.levels.map((level, index) => ({
            id: level.id || uid('level'),
            key: level.id || `level${index + 2}`,
            name: level.name?.trim() || `第 ${index + 2} 级详情页`,
            linkField: level.linkField?.trim() || '',
            itemSelector: level.itemSelector?.trim() || '',
            fields: (level.fields || [])
              .filter((field) => field.key?.trim())
              .map((field) => ({
                id: field.id || uid('field'),
                key: field.key.trim(),
                selector: field.selector?.trim() || '',
                attr: field.attr || 'text',
                attribute: field.attribute?.trim() || '',
                enabled: field.enabled !== false,
              })),
            pagination: {
              mode: 'none',
              param: 'page',
              startPage: 1,
              maxPages: 1,
              nextSelector: '',
            },
            dynamic: {
              enabled: level.dynamic?.enabled === true,
              waitMs: Math.min(
                Math.max(Number(level.dynamic?.waitMs) || 1200, 300),
                10000,
              ),
            },
          })),
        }
      : null,
  }
}

function startUrl() {
  return resolveEndpoint(props.site?.baseUrl, form.listPath || '/')
}

async function testRule() {
  if (!form.listPath?.trim()) {
    ElMessage.warning('请先填写列表页路径')
    return
  }
  const paginationError = validatePagination()
  if (paginationError && form.itemSelector?.trim() && validFields().length) {
    ElMessage.warning(paginationError)
    return
  }

  let url = ''
  try {
    url = startUrl()
  } catch (error) {
    ElMessage.error(error.message)
    return
  }

  Object.assign(testState, {
    status: 'running',
    message: '正在请求页面…',
    error: '',
    httpStatus: '',
    duration: 0,
    count: 0,
    pages: 0,
    records: [],
    url,
    mode: '',
  })

  const fields = validFields()
  const parseEnabled = Boolean(form.itemSelector?.trim() && fields.length)
  try {
    if (!parseEnabled) {
      const page = await fetchHtmlPage(url, { headers: { Accept: 'text/html' } })
      Object.assign(testState, {
        status: 'success',
        message: '页面连接成功；补充条目选择器与字段映射后即可解析数据。',
        httpStatus: String(page.status),
        duration: page.duration,
        count: 0,
        pages: 1,
        url: page.url,
        mode: 'connectivity',
      })
      return
    }

    const result = await collectHtmlPages({
      startUrl: url,
      headers: { Accept: 'text/html' },
      pageRule: buildPayload(),
    })
    Object.assign(testState, {
      status: 'success',
      message: `解析成功，共获取 ${result.records.length} 条记录。`,
      httpStatus: String(result.status),
      duration: result.duration,
      count: result.records.length,
      pages: result.pageCount,
      records: result.records,
      url: result.lastUrl,
      mode: 'parse',
    })
  } catch (error) {
    Object.assign(testState, {
      status: 'error',
      message: '测试未通过，请检查页面地址、CSS 选择器、字段映射或服务端代理是否运行。',
      error: error?.message || '未知错误',
      duration: 0,
    })
  }
}

function saveRule() {
  const error = validateForSave()
  if (error) {
    ElMessage.warning(error)
    return
  }
  if (!props.site) return
  updateSite(props.site.id, { pageRule: buildPayload() })
  ElMessage.success('页面采集规则已保存')
  emit('saved')
  visible.value = false
}

function cellText(value) {
  if (value === null || value === undefined || value === '') return '—'
  return truncate(value, 40)
}
</script>

<template>
  <el-drawer
    v-model="visible"
    class="cf-drawer site-rule-drawer"
    size="min(660px, 100vw)"
    :close-on-click-modal="false"
    append-to-body
  >
    <template #header>
      <div class="drawer-heading">
        <span class="drawer-heading-icon">
          <el-icon><SetUp /></el-icon>
        </span>
        <div class="drawer-heading-copy">
          <h3>页面采集规则</h3>
          <p>{{ site?.name || '采集站点' }}</p>
        </div>
      </div>
    </template>

    <div class="site-rule-hero">
      <div class="entity-avatar is-soft">
        <el-icon><Connection /></el-icon>
      </div>
      <div class="entity-copy">
        <span class="entity-name">{{ site?.name }}</span>
        <span class="entity-sub">{{ hostOf(site?.baseUrl) }} · {{ site?.baseUrl }}</span>
      </div>
      <span class="soft-chip" :class="form.enabled ? 'is-accent' : 'is-empty'">
        {{ form.enabled ? '页面采集已启用' : '页面采集未启用' }}
      </span>
    </div>

    <section class="form-section">
      <div class="form-section-head">
        <span class="section-index">01</span>
        <h4>列表页与选择器</h4>
        <span class="section-note">HTML 页面规则</span>
      </div>
      <div class="toggle-row">
        <div>
          <strong>启用页面采集</strong>
          <span>启用后，响应类型为 HTML 的任务会使用这里的规则解析</span>
        </div>
        <el-switch v-model="form.enabled" />
      </div>
      <el-form label-position="top" @submit.prevent>
        <div class="form-grid">
          <el-form-item class="span-2" label="列表页路径">
            <el-input v-model="form.listPath" placeholder="/catalog.html">
              <template #prefix>
                <span class="input-prefix-path">PATH</span>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item class="span-2" label="条目选择器">
            <el-input v-model="form.itemSelector" placeholder="例如 .product-card 或 article.item" />
          </el-form-item>
        </div>
      </el-form>
      <p class="form-hint">
        <el-icon><InfoFilled /></el-icon>
        测试使用这里的列表页路径；在采集任务中，请求路径仍由所选采集配置决定。
      </p>
    </section>

    <section class="form-section">
      <div class="form-section-head">
        <span class="section-index">02</span>
        <h4>字段映射</h4>
        <span class="section-note">字段名 / CSS 选择器 / 取值方式</span>
      </div>
      <div class="field-map-editor">
        <div class="field-map-head">
          <span>字段名</span>
          <span>CSS 选择器</span>
          <span>取值</span>
          <span>启用</span>
          <span />
        </div>
        <div v-for="(field, index) in form.fields" :key="field.id" class="field-map-row">
          <el-input v-model="field.key" placeholder="title" spellcheck="false" />
          <el-input v-model="field.selector" placeholder=".product-title" spellcheck="false" />
          <div class="field-attr-cell">
            <el-select v-model="field.attr">
              <el-option
                v-for="option in ATTR_OPTIONS"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
            <el-input
              v-if="field.attr === 'attribute'"
              v-model="field.attribute"
              placeholder="属性名"
              spellcheck="false"
            />
          </div>
          <el-switch v-model="field.enabled" size="small" />
          <button class="kv-delete" type="button" title="删除字段" @click="removeField(index)">
            <el-icon><Delete /></el-icon>
          </button>
        </div>
        <button class="kv-add" type="button" @click="addField">
          <el-icon><Plus /></el-icon>
          添加字段
        </button>
      </div>
      <p class="form-hint">
        <el-icon><InfoFilled /></el-icon>
        字段选择器会在每个条目内部查找；选择器留空时直接读取条目本身。文本会自动去除多余空白。
      </p>
    </section>

    <section class="form-section">
      <div class="form-section-head">
        <span class="section-index">03</span>
        <h4>分页规则</h4>
        <span class="section-note">最多抓取 10 页</span>
      </div>
      <el-form label-position="top" @submit.prevent>
        <div class="form-grid">
          <el-form-item class="span-2" label="分页方式">
            <el-select v-model="form.pagination.mode">
              <el-option
                v-for="option in PAGINATION_OPTIONS"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
          <template v-if="form.pagination.mode === 'pageParam'">
            <el-form-item label="分页参数名">
              <el-input v-model="form.pagination.param" placeholder="page" />
            </el-form-item>
            <el-form-item label="起始页">
              <el-input-number v-model="form.pagination.startPage" :min="1" :max="999" controls-position="right" />
            </el-form-item>
          </template>
          <template v-if="form.pagination.mode === 'nextLink'">
            <el-form-item class="span-2" label="下一页选择器">
              <el-input v-model="form.pagination.nextSelector" placeholder="a.next-page" />
            </el-form-item>
          </template>
          <el-form-item v-if="form.pagination.mode !== 'none'" label="最大页数">
            <el-input-number v-model="form.pagination.maxPages" :min="1" :max="10" controls-position="right" />
          </el-form-item>
        </div>
      </el-form>
      <p class="form-hint">
        <el-icon><InfoFilled /></el-icon>
        “跟随下一页链接”会从当前页 DOM 中读取链接并继续请求，适合静态翻页页面。
      </p>
    </section>

    <section v-if="form.enabled" class="form-section">
      <div class="form-section-head">
        <span class="section-index">04</span>
        <h4>多级页面采集</h4>
        <span class="section-note">列表页 → 详情页</span>
      </div>
      <div class="toggle-row">
        <div>
          <strong>启用多级采集</strong>
          <span>从列表记录中读取详情链接，继续抓取详情页并合并字段</span>
        </div>
        <el-switch v-model="form.crawl.enabled" @change="enableCrawlLevels" />
      </div>

      <template v-if="form.crawl.enabled">
        <div class="form-grid multi-level-settings">
          <el-form-item label="详情页最大数量">
            <el-input-number
              v-model="form.crawl.maxItems"
              :min="1"
              :max="2000"
              :step="10"
              controls-position="right"
            />
          </el-form-item>
          <el-form-item label="详情页并发数">
            <el-input-number
              v-model="form.crawl.concurrency"
              :min="1"
              :max="5"
              controls-position="right"
            />
          </el-form-item>
          <el-form-item label="子级字段前缀">
            <el-input v-model="form.crawl.childPrefix" placeholder="detail_" />
          </el-form-item>
          <el-form-item label="详情失败跳过">
            <el-switch v-model="form.crawl.skipErrors" />
          </el-form-item>
        </div>

        <div
          v-for="(level, levelIndex) in form.crawl.levels"
          :key="level.id"
          class="multi-level-card"
        >
          <div class="multi-level-head">
            <div>
              <span class="multi-level-index">LEVEL {{ levelIndex + 2 }}</span>
              <strong>{{ level.name || `第 ${levelIndex + 2} 级详情页` }}</strong>
            </div>
            <button
              class="kv-delete"
              type="button"
              title="删除该级"
              @click="removeLevel(levelIndex)"
            >
              <el-icon><Delete /></el-icon>
            </button>
          </div>

          <el-form label-position="top" @submit.prevent>
            <div class="form-grid">
              <el-form-item label="层级名称">
                <el-input v-model="level.name" placeholder="详情页" />
              </el-form-item>
              <el-form-item label="链接字段">
                <el-select v-model="level.linkField" filterable placeholder="选择上一级的 URL 字段">
                  <el-option
                    v-for="field in parentFieldsFor(levelIndex)"
                    :key="field.id"
                    :label="field.key"
                    :value="field.key"
                  />
                </el-select>
              </el-form-item>
              <el-form-item class="span-2" label="详情条目选择器（可选）">
                <el-input
                  v-model="level.itemSelector"
                  placeholder="留空则把整个详情页作为一条记录"
                />
              </el-form-item>
              <el-form-item label="JS 动态加载">
                <el-switch v-model="level.dynamic.enabled" />
              </el-form-item>
              <el-form-item v-if="level.dynamic.enabled" label="渲染等待（毫秒）">
                <el-input-number
                  v-model="level.dynamic.waitMs"
                  :min="300"
                  :max="10000"
                  :step="200"
                  controls-position="right"
                />
              </el-form-item>
            </div>
          </el-form>

          <div class="field-map-editor">
            <div class="field-map-head">
              <span>字段名</span>
              <span>CSS 选择器</span>
              <span>取值</span>
              <span>启用</span>
              <span />
            </div>
            <div
              v-for="(field, fieldIndex) in level.fields"
              :key="field.id"
              class="field-map-row"
            >
              <el-input v-model="field.key" placeholder="title" spellcheck="false" />
              <el-input v-model="field.selector" placeholder="h1" spellcheck="false" />
              <div class="field-attr-cell">
                <el-select v-model="field.attr">
                  <el-option
                    v-for="option in ATTR_OPTIONS"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
                <el-input
                  v-if="field.attr === 'attribute'"
                  v-model="field.attribute"
                  placeholder="属性名"
                  spellcheck="false"
                />
              </div>
              <el-switch v-model="field.enabled" size="small" />
              <button
                class="kv-delete"
                type="button"
                title="删除字段"
                @click="removeLevelField(level, fieldIndex)"
              >
                <el-icon><Delete /></el-icon>
              </button>
            </div>
            <button class="kv-add" type="button" @click="addLevelField(level)">
              <el-icon><Plus /></el-icon>
              添加字段
            </button>
          </div>
        </div>

        <button
          v-if="form.crawl.levels.length < 2"
          class="kv-add multi-level-add"
          type="button"
          @click="addLevel"
        >
          <el-icon><Plus /></el-icon>
          添加下一级
        </button>
      </template>

      <p class="form-hint">
        <el-icon><InfoFilled /></el-icon>
        链接字段必须是上一级字段中的 href/src 地址。详情字段默认加前缀合并，例如 detail_title；失败跳过不会中断整批采集。
      </p>
    </section>

    <section class="form-section">
      <div class="form-section-head">
        <span class="section-index">05</span>
        <h4>连接与解析测试</h4>
        <span class="section-note">使用当前未保存的规则</span>
      </div>

      <div class="site-test-actions">
        <el-button :loading="testLoading" @click="testRule">
          <el-icon v-if="!testLoading"><VideoPlay /></el-icon>
          {{ testLoading ? '正在测试…' : '测试连接与解析' }}
        </el-button>
        <span>会真实请求页面并统计识别到的条目</span>
      </div>

      <div class="site-test-panel" :class="`is-${testState.status}`">
        <div class="site-test-head">
          <span class="site-test-icon">
            <el-icon>
              <Loading v-if="testState.status === 'running'" class="is-spinning" />
              <CircleCheck v-else-if="testState.status === 'success'" />
              <WarningFilled v-else-if="testState.status === 'error'" />
              <VideoPlay v-else />
            </el-icon>
          </span>
          <div class="site-test-copy">
            <strong>
              {{
                testState.status === 'running'
                  ? '正在测试'
                  : testState.status === 'success'
                    ? '测试通过'
                    : testState.status === 'error'
                      ? '测试失败'
                      : '等待测试'
              }}
            </strong>
            <span>{{ testState.message }}</span>
          </div>
          <span v-if="testState.httpStatus" class="soft-chip is-accent">HTTP {{ testState.httpStatus }}</span>
        </div>

        <div v-if="testState.status !== 'idle'" class="site-test-metrics">
          <div>
            <span>识别条目</span>
            <strong>{{ formatNumber(testState.count) }}</strong>
          </div>
          <div>
            <span>采集页数</span>
            <strong>{{ testState.pages }}</strong>
          </div>
          <div>
            <span>耗时</span>
            <strong>{{ testState.duration ? `${testState.duration}ms` : '—' }}</strong>
          </div>
        </div>

        <div v-if="testState.error" class="result-error">
          <el-icon><WarningFilled /></el-icon>
          <div>
            <strong>无法完成页面解析</strong>
            {{ testState.error }}
          </div>
        </div>

        <div v-if="testState.records.length" class="preview-card site-test-preview">
          <div class="preview-card-head">
            <strong>结果预览</strong>
            <span>
              前 {{ previewRows.length }} 条 · 共 {{ formatNumber(testState.count) }} 条
              <template v-if="hiddenColumns"> · 另有 {{ hiddenColumns }} 个字段</template>
            </span>
          </div>
          <div class="mini-table-wrap">
            <table class="mini-table">
              <thead>
                <tr>
                  <th v-for="key in previewColumns" :key="key">{{ key }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in previewRows" :key="index">
                  <td v-for="key in previewColumns" :key="`${index}-${key}`" :title="String(row?.[key] ?? '')">
                    {{ cellText(row?.[key]) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-if="testState.url" class="site-test-url">{{ testState.url }}</div>
      </div>
    </section>

    <template #footer>
      <div class="drawer-footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="saveRule">
          <el-icon><CircleCheck /></el-icon>
          保存页面规则
        </el-button>
      </div>
    </template>
  </el-drawer>
</template>
