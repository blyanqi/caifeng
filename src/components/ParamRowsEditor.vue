<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, Document, Plus, Upload } from '@element-plus/icons-vue'
import {
  TIMESTAMP_FORMATS,
  listCount,
  normalizeParamRow,
  parseListFile,
  resolveTimestamp,
} from '../utils/params'
import { uid } from '../utils/format'

const props = defineProps({
  rows: { type: Array, required: true },
})

const emit = defineEmits(['change'])

const TYPE_OPTIONS = [
  { value: 'text', label: '文本' },
  { value: 'timestamp', label: '时间戳' },
  { value: 'list', label: '列表' },
]

const now = ref(new Date())
let timer = null

onMounted(() => {
  timer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onBeforeUnmount(() => {
  clearInterval(timer)
})

function blankRow() {
  return normalizeParamRow({
    id: uid('row'),
    key: '',
    enabled: true,
    valueType: 'text',
    value: '',
    timestamp: {},
    list: { items: [], source: 'manual', fileName: '' },
  })
}

function addRow() {
  props.rows.push(blankRow())
  emit('change')
}

function removeRow(index) {
  props.rows.splice(index, 1)
  emit('change')
}

function setType(row, type) {
  row.valueType = type
  if (type === 'list' && !row.list) row.list = { items: [], source: 'manual', fileName: '' }
  if (type === 'timestamp' && !row.timestamp) row.timestamp = {}
  emit('change')
}

function listText(row) {
  return (row.list?.items || []).join('\n')
}

function updateListText(row, value) {
  if (!row.list) row.list = { items: [], source: 'manual', fileName: '' }
  row.list.items = value.split(/\r?\n/)
  row.list.source = 'manual'
  row.list.fileName = ''
  emit('change')
}

function timestampPreview(row) {
  return resolveTimestamp(row.timestamp, now.value)
}

function importList(row) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.txt,.csv,.json,text/plain,text/csv,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const result = await parseListFile(file)
      if (!row.list) row.list = { items: [], source: 'manual', fileName: '' }
      row.list.items = result.items
      row.list.source = 'file'
      row.list.fileName = file.name
      emit('change')
      ElMessage.success(`已导入 ${result.items.length} 个列表值`)
      if (result.truncated) {
        ElMessage.warning(`列表超过上限，仅保留前 ${result.items.length} 项`)
      }
    } catch (error) {
      ElMessage.error(error?.message || '列表文件解析失败')
    }
  }
  input.click()
}
</script>

<template>
  <div class="param-rows-editor">
    <div v-if="!rows.length" class="kv-empty">还没有参数，点击下方按钮添加。</div>

    <div v-for="(row, index) in rows" :key="row.id" class="param-row-card">
      <div class="param-row-head">
        <span class="param-row-index">{{ String(index + 1).padStart(2, '0') }}</span>
        <el-input
          v-model="row.key"
          class="param-key-input"
          placeholder="参数名，例如 keyword"
          spellcheck="false"
          @input="emit('change')"
        />
        <div class="param-type-switch">
          <button
            v-for="option in TYPE_OPTIONS"
            :key="option.value"
            type="button"
            :class="{ 'is-active': row.valueType === option.value }"
            @click="setType(row, option.value)"
          >
            {{ option.label }}
          </button>
        </div>
        <el-switch v-model="row.enabled" size="small" @change="emit('change')" />
        <button class="kv-delete" type="button" title="删除参数" @click="removeRow(index)">
          <el-icon><Delete /></el-icon>
        </button>
      </div>

      <div class="param-value-panel">
        <template v-if="row.valueType === 'timestamp'">
          <div class="timestamp-config">
            <label class="config-field">
              <span>时间格式</span>
              <el-select v-model="row.timestamp.format" @change="emit('change')">
                <el-option
                  v-for="format in TIMESTAMP_FORMATS"
                  :key="format.value"
                  :label="format.label"
                  :value="format.value"
                />
              </el-select>
            </label>
            <label class="config-field">
              <span>时区</span>
              <el-select v-model="row.timestamp.timezone" @change="emit('change')">
                <el-option label="本地时间" value="local" />
                <el-option label="UTC" value="utc" />
              </el-select>
            </label>
            <label class="config-field">
              <span>时间偏移（分钟）</span>
              <el-input-number
                v-model="row.timestamp.offsetMinutes"
                :min="-525600"
                :max="525600"
                controls-position="right"
                @change="emit('change')"
              />
            </label>
          </div>
          <div class="timestamp-preview">
            <span>采集时生成</span>
            <code>{{ timestampPreview(row) }}</code>
          </div>
        </template>

        <template v-else-if="row.valueType === 'list'">
          <div class="param-list-editor">
            <div class="param-list-toolbar">
              <div class="param-list-summary">
                <span class="soft-chip is-accent">{{ listCount(row) }} 个值</span>
                <span v-if="row.list?.fileName" class="param-list-file">
                  <el-icon><Document /></el-icon>
                  {{ row.list.fileName }}
                </span>
                <span v-else class="param-list-file is-manual">手动输入</span>
              </div>
              <button type="button" class="param-import-button" @click="importList(row)">
                <el-icon><Upload /></el-icon>
                导入列表文件
              </button>
            </div>
            <el-input
              :model-value="listText(row)"
              class="param-list-textarea"
              type="textarea"
              :rows="4"
              resize="none"
              spellcheck="false"
              placeholder="每行一个值，例如：&#10;desk&#10;chair&#10;lamp"
              @update:model-value="(value) => updateListText(row, value)"
            />
            <p class="param-list-hint">
              支持 TXT（每行一个）、CSV（取第一列）、JSON 数组。采集时每个值执行一次。
            </p>
          </div>
        </template>

        <template v-else>
          <el-input
            v-model="row.value"
            placeholder="参数值，例如 desk"
            spellcheck="false"
            @input="emit('change')"
          />
        </template>
      </div>
    </div>

    <button class="param-add-row" type="button" @click="addRow">
      <el-icon><Plus /></el-icon>
      添加参数
    </button>
  </div>
</template>
