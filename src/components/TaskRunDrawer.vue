<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  CircleCheckFilled,
  CircleCloseFilled,
  Close,
  CopyDocument,
  Download,
  Loading,
  VideoPlay,
  WarningFilled,
} from '@element-plus/icons-vue'
import {
  downloadBlob,
  fileSafeName,
  formatDateTime,
  formatNumber,
  formatTime,
  recordKeys,
  toCsv,
  truncate,
} from '../utils/format'
import { copyText } from '../utils/clipboard'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  state: { type: Object, required: true },
})

const emit = defineEmits(['update:modelValue'])

const terminalRef = ref(null)
const copiedLog = ref(false)
let copiedTimer = null

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const statusMeta = computed(() => {
  if (props.state.status === 'success') {
    return { label: '采集完成', detail: '数据已成功归档到关联存储', tone: 'success' }
  }
  if (props.state.status === 'error') {
    return { label: '采集失败', detail: '请根据运行日志排查后重试', tone: 'error' }
  }
  return { label: '正在采集', detail: '正在请求数据并解析响应', tone: 'running' }
})

const previewColumns = computed(() => recordKeys(props.state.records).slice(0, 4))
const previewRows = computed(() => (props.state.records || []).slice(0, 5))
const hiddenFieldCount = computed(() => {
  const count = recordKeys(props.state.records).length
  return count > previewColumns.value.length ? count - previewColumns.value.length : 0
})
const recordCount = computed(() =>
  props.state.status === 'success' ? props.state.records.length : props.state.count || 0,
)

watch(
  () => props.state.logs?.length,
  async () => {
    await nextTick()
    if (terminalRef.value) {
      terminalRef.value.scrollTop = terminalRef.value.scrollHeight
    }
  },
)

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    await nextTick()
    if (terminalRef.value) {
      terminalRef.value.scrollTop = terminalRef.value.scrollHeight
    }
  },
)

function cellText(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return truncate(JSON.stringify(value), 34)
  return truncate(value, 40)
}

function downloadJson() {
  if (!props.state.records?.length) return
  const name = `${fileSafeName(props.state.task?.name)}-${Date.now()}.json`
  downloadBlob(JSON.stringify(props.state.records, null, 2), name, 'application/json;charset=utf-8')
}

function downloadCsv() {
  if (!props.state.records?.length) return
  const name = `${fileSafeName(props.state.task?.name)}-${Date.now()}.csv`
  downloadBlob(toCsv(props.state.records), name, 'text/csv;charset=utf-8')
}

const runLogText = computed(() => {
  const lines = [
    '采风 Collect Studio · 采集运行日志',
    `任务：${props.state.task?.name || '采集任务'}`,
    `开始时间：${props.state.startedAt ? formatDateTime(props.state.startedAt, { withSeconds: true }) : '—'}`,
    `状态：${statusMeta.value.label}`,
    `采集记录：${formatNumber(recordCount.value)} 条`,
    `耗时：${props.state.duration ? `${props.state.duration}ms` : '—'}`,
    `HTTP 状态：${props.state.httpStatus || '—'}`,
    `请求地址：${props.state.method || 'GET'} ${props.state.requestUrl || '—'}`,
  ]
  if (props.state.iteration) {
    lines.push(
      `遍历参数：${props.state.iteration.rowKey} · ${props.state.iteration.index + 1}/${props.state.iteration.total} · 当前值 ${props.state.iteration.value}`,
    )
  }
  if (props.state.error) lines.push(`错误信息：${props.state.error}`)
  lines.push('', '运行日志：')
  if (props.state.logs?.length) {
    lines.push(...props.state.logs.map((log) => `[${log.time}] ${log.text}`))
  } else {
    lines.push('（暂无日志）')
  }
  return lines.join('\n')
})

async function copyRunLogs() {
  try {
    const ok = await copyText(runLogText.value)
    if (ok) {
      copiedLog.value = true
      if (copiedTimer) clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => {
        copiedLog.value = false
        copiedTimer = null
      }, 1800)
    }
    ElMessage[ok ? 'success' : 'warning'](ok ? '运行日志已复制' : '复制失败，请手动选择')
  } catch {
    ElMessage.error('复制失败，请手动选择日志内容')
  }
}
</script>

<template>
  <el-drawer
    v-model="visible"
    class="cf-drawer"
    size="min(540px, 100vw)"
    :close-on-click-modal="false"
    append-to-body
  >
    <template #header>
      <div class="drawer-heading">
        <span class="drawer-heading-icon">
          <el-icon><VideoPlay /></el-icon>
        </span>
        <div class="drawer-heading-copy">
          <h3>采集运行</h3>
          <p>{{ state.task?.name || '采集任务' }}</p>
        </div>
      </div>
    </template>

    <div class="run-hero">
      <div class="run-hero-top">
        <span class="run-status-icon" :class="`is-${statusMeta.tone}`">
          <el-icon>
            <Loading v-if="state.status === 'running'" class="is-spinning" />
            <CircleCheckFilled v-else-if="state.status === 'success'" />
            <CircleCloseFilled v-else />
          </el-icon>
        </span>
        <div class="run-hero-copy">
          <h2>{{ statusMeta.label }}</h2>
          <p>{{ statusMeta.detail }}</p>
        </div>
        <span class="run-storage-pill">
          <el-icon><Download /></el-icon>
          {{ state.storage?.name || '未关联存储' }}
        </span>
      </div>

      <div
        class="run-progress"
        :class="{
          'is-success': state.status === 'success',
          'is-error': state.status === 'error',
        }"
      >
        <span />
      </div>

      <div class="run-metrics">
        <div class="run-metric">
          <span>本次记录</span>
          <strong>{{ formatNumber(recordCount) }} 条</strong>
        </div>
        <div class="run-metric">
          <span>耗时</span>
          <strong>{{ state.duration ? `${state.duration}ms` : '—' }}</strong>
        </div>
        <div class="run-metric">
          <span>HTTP 状态</span>
          <strong>{{ state.httpStatus || '—' }}</strong>
        </div>
      </div>
    </div>

    <section class="run-section">
      <div class="run-section-title">
        <h3>运行日志</h3>
        <div class="run-section-tools">
          <span>{{ state.logs?.length || 0 }} EVENTS</span>
          <button
            class="log-copy-link"
            :class="{ 'is-copied': copiedLog }"
            type="button"
            title="复制运行日志"
            @click="copyRunLogs"
          >
            <el-icon><CircleCheckFilled v-if="copiedLog" /><CopyDocument v-else /></el-icon>
            {{ copiedLog ? '已复制' : '复制' }}
          </button>
        </div>
      </div>
      <div class="terminal">
        <div class="terminal-bar">
          <span class="terminal-dot" />
          <span class="terminal-dot" />
          <span class="terminal-dot" />
          <span class="terminal-title">collector://run/trace</span>
        </div>
        <div ref="terminalRef" class="terminal-body">
          <div
            v-for="(log, index) in state.logs"
            :key="index"
            class="log-line"
            :class="`is-${log.type || 'info'}`"
          >
            <span class="log-time">{{ log.time }}</span>
            <span class="log-marker">{{ log.type === 'error' ? '✕' : log.type === 'success' ? '✓' : '›' }}</span>
            <span class="log-text">{{ log.text }}</span>
          </div>
          <div v-if="state.status === 'running'" class="log-line">
            <span class="log-time">{{ formatTime(new Date()) }}</span>
            <span class="log-marker">›</span>
            <span class="log-text">处理中<span class="terminal-cursor" /></span>
          </div>
        </div>
      </div>
    </section>

    <section v-if="state.status === 'error'" class="run-section">
      <div class="result-error">
        <el-icon><WarningFilled /></el-icon>
        <div>
          <strong>采集未完成</strong>
          {{ state.error }}
        </div>
      </div>
      <p class="run-hint">
        常见原因：目标站点网络异常、请求头或参数不正确、数据路径不匹配，或服务端代理未运行。可修正后再次点击「采集」。
      </p>
    </section>

    <section v-if="state.status === 'success' && previewRows.length" class="run-section">
      <div class="run-section-title">
        <h3>结果预览</h3>
        <span>前 {{ previewRows.length }} 条 · 共 {{ state.records.length }} 条</span>
      </div>
      <div class="preview-card">
        <div class="preview-card-head">
          <strong>已解析为结构化记录</strong>
          <span v-if="hiddenFieldCount">另有 {{ hiddenFieldCount }} 个字段未展示</span>
          <span v-else>4 列预览</span>
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
                <td
                  v-for="key in previewColumns"
                  :key="`${index}-${key}`"
                  :class="{ 'cell-empty': row?.[key] === null || row?.[key] === undefined }"
                  :title="String(row?.[key] ?? '')"
                >
                  {{ cellText(row?.[key]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="result-actions">
        <el-button @click="downloadJson">
          <el-icon><Download /></el-icon>
          下载 JSON
        </el-button>
        <el-button @click="downloadCsv">
          <el-icon><Download /></el-icon>
          下载 CSV
        </el-button>
      </div>
      <p class="run-hint">
        本次记录同时写入「{{ state.storage?.name || '关联存储' }}」，累计归档 {{ formatNumber(state.storageTotal || 0) }} 条。
      </p>
    </section>

    <section v-if="state.requestUrl" class="run-section">
      <div class="run-section-title">
        <h3>请求地址</h3>
        <span>{{ state.method || 'GET' }}</span>
      </div>
      <div class="request-url">{{ state.requestUrl }}</div>
    </section>

    <template #footer>
      <div class="drawer-footer">
        <div class="drawer-footer-group">
          <el-button @click="visible = false">
            <el-icon><Close /></el-icon>
            关闭
          </el-button>
          <el-button :class="{ 'is-copied': copiedLog }" @click="copyRunLogs">
            <el-icon><CircleCheckFilled v-if="copiedLog" /><CopyDocument v-else /></el-icon>
            {{ copiedLog ? '已复制' : '复制日志' }}
          </el-button>
        </div>
        <el-button
          v-if="state.status === 'success' && state.records?.length"
          type="primary"
          @click="downloadJson"
        >
          导出结果
        </el-button>
      </div>
    </template>
  </el-drawer>
</template>
