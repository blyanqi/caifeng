<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  CircleCheck,
  CopyDocument,
  Document,
  InfoFilled,
  Refresh,
  WarningFilled,
} from '@element-plus/icons-vue'
import StatusBadge from './StatusBadge.vue'
import EmptyState from './EmptyState.vue'
import { store } from '../stores/collector'
import {
  formatDateTime,
  formatNumber,
  fromNow,
  parseDate,
} from '../utils/format'
import { copyText } from '../utils/clipboard'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  task: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const selectedRunId = ref('')
const copyFeedback = ref('')
let copyFeedbackTimer = null

const taskRuns = computed(() =>
  store.runs
    .filter((run) => run.taskId === props.task?.id)
    .slice()
    .sort((a, b) => {
      const da = parseDate(a.startedAt)?.getTime() || 0
      const db = parseDate(b.startedAt)?.getTime() || 0
      return db - da
    }),
)

const selectedRun = computed(
  () => taskRuns.value.find((run) => run.id === selectedRunId.value) || taskRuns.value[0] || null,
)

const successCount = computed(
  () => taskRuns.value.filter((run) => run.status === 'success').length,
)
const errorCount = computed(
  () => taskRuns.value.filter((run) => run.status === 'error').length,
)

const logs = computed(() => selectedRun.value?.logs || [])
const runStatus = computed(() => {
  if (selectedRun.value?.status === 'success') return { label: '已完成', tone: 'success' }
  if (selectedRun.value?.status === 'error') return { label: '失败', tone: 'error' }
  return { label: '运行中', tone: 'running' }
})

const logText = computed(() =>
  logs.value.map((log) => `[${log.time}] ${log.text}`).join('\n'),
)

const fullLogText = computed(() => {
  const run = selectedRun.value
  if (!run) return ''
  const lines = [
    '采风 Collect Studio · 运行日志',
    `任务：${props.task?.name || '采集任务'}`,
    `运行时间：${formatDateTime(run.startedAt, { withSeconds: true })}`,
    `状态：${runStatus.value.label}`,
    `采集记录：${formatNumber(run.count || 0)} 条`,
    `耗时：${run.duration ? `${run.duration}ms` : '—'}`,
    `HTTP 状态：${run.httpStatus || '—'}`,
    `采集页数：${run.pageCount || 1}`,
    `请求地址：${run.method || 'GET'} ${run.requestUrl || '—'}`,
  ]
  if (run.iteration) {
    lines.push(
      `遍历参数：${run.iteration.rowKey} · ${run.iteration.index + 1}/${run.iteration.total} · 当前值 ${run.iteration.value}`,
    )
  }
  if (run.error) lines.push(`错误信息：${run.error}`)
  lines.push('', '执行日志：', logs.value.length ? logText.value : '（该次运行没有详细日志）')
  return lines.join('\n')
})

watch(
  () => [props.modelValue, props.task?.id],
  ([open]) => {
    if (!open) return
    selectedRunId.value = taskRuns.value[0]?.id || ''
  },
  { immediate: true },
)

watch(taskRuns, (runs) => {
  if (!props.modelValue) return
  if (!runs.some((run) => run.id === selectedRunId.value)) {
    selectedRunId.value = runs[0]?.id || ''
  }
})

function runLabel(run) {
  if (run.status === 'success') return { label: '已完成', tone: 'success' }
  if (run.status === 'error') return { label: '失败', tone: 'error' }
  return { label: '运行中', tone: 'running' }
}

function runMeta(run) {
  return `${formatNumber(run.count || 0)} 条 · ${run.duration || 0}ms`
}

function flashCopied(target) {
  copyFeedback.value = target
  if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer)
  copyFeedbackTimer = setTimeout(() => {
    copyFeedback.value = ''
    copyFeedbackTimer = null
  }, 1800)
}

onBeforeUnmount(() => {
  if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer)
})

async function copyLogs() {
  if (!logs.value.length) {
    ElMessage.warning('当前运行没有可复制的详细日志')
    return
  }
  try {
    const ok = await copyText(logText.value)
    if (ok) flashCopied('logs')
    ElMessage[ok ? 'success' : 'warning'](ok ? '执行日志已复制' : '复制失败，请手动选择')
  } catch {
    ElMessage.error('复制失败，请手动选择日志内容')
  }
}

async function copyFullLog() {
  if (!selectedRun.value) {
    ElMessage.warning('当前没有可复制的运行日志')
    return
  }
  try {
    const ok = await copyText(fullLogText.value)
    if (ok) flashCopied('full')
    ElMessage[ok ? 'success' : 'warning'](ok ? '完整运行日志已复制' : '复制失败，请手动选择')
  } catch {
    ElMessage.error('复制失败，请手动选择日志内容')
  }
}
</script>

<template>
  <el-drawer
    v-model="visible"
    class="cf-drawer log-drawer"
    size="min(590px, 100vw)"
    :close-on-click-modal="false"
    append-to-body
  >
    <template #header>
      <div class="drawer-heading">
        <span class="drawer-heading-icon">
          <el-icon><Document /></el-icon>
        </span>
        <div class="drawer-heading-copy">
          <h3>运行日志</h3>
          <p>{{ task?.name || '采集任务' }}</p>
        </div>
      </div>
    </template>

    <div class="log-overview">
      <span class="log-overview-icon"><el-icon><Document /></el-icon></span>
      <div class="log-overview-copy">
        <strong>{{ task?.name || '采集任务' }}</strong>
        <span>
          共 {{ taskRuns.length }} 次运行 · 成功 {{ successCount }} 次
          <template v-if="errorCount"> · 失败 {{ errorCount }} 次</template>
        </span>
      </div>
      <div class="log-overview-actions">
        <span v-if="selectedRun" class="soft-chip is-accent">
          最近运行 {{ fromNow(selectedRun.startedAt) }}
        </span>
        <button
          v-if="selectedRun"
          class="log-copy-button"
          :class="{ 'is-copied': copyFeedback === 'full' }"
          type="button"
          title="复制完整运行日志"
          @click="copyFullLog"
        >
          <el-icon><CircleCheck v-if="copyFeedback === 'full'" /><CopyDocument v-else /></el-icon>
          {{ copyFeedback === 'full' ? '已复制' : '一键复制' }}
        </button>
      </div>
    </div>

    <EmptyState
      v-if="!taskRuns.length"
      :icon="Document"
      title="还没有运行日志"
      description="运行一次采集任务后，详细执行日志会显示在这里。"
    />

    <template v-else>
      <section class="log-section">
        <div class="log-section-head">
          <h4>运行记录</h4>
          <span>{{ taskRuns.length }} 次</span>
        </div>
        <div class="log-run-list">
          <button
            v-for="run in taskRuns"
            :key="run.id"
            type="button"
            class="log-run-item"
            :class="{ 'is-active': selectedRun?.id === run.id }"
            @click="selectedRunId = run.id"
          >
            <span class="log-run-dot" :class="`is-${runLabel(run).tone}`" />
            <span class="log-run-copy">
              <strong>{{ formatDateTime(run.startedAt, { withSeconds: true }) }}</strong>
              <span>{{ fromNow(run.startedAt) }} · {{ runMeta(run) }}</span>
            </span>
            <StatusBadge :label="runLabel(run).label" :tone="runLabel(run).tone" />
          </button>
        </div>
      </section>

      <section v-if="selectedRun" class="log-section">
        <div class="log-section-head">
          <h4>运行详情</h4>
          <span>{{ selectedRun.id.slice(-6).toUpperCase() }}</span>
        </div>
        <div class="log-run-hero">
          <div class="log-run-hero-head">
            <span class="log-run-hero-icon" :class="`is-${runStatus.tone}`">
              <el-icon>
                <CircleCheck v-if="selectedRun.status === 'success'" />
                <WarningFilled v-else />
              </el-icon>
            </span>
            <div>
              <strong>{{ runStatus.label === '已完成' ? '采集成功' : runStatus.label === '失败' ? '采集失败' : '采集中' }}</strong>
              <span>{{ formatDateTime(selectedRun.startedAt, { withSeconds: true }) }} 开始</span>
            </div>
            <StatusBadge :label="runStatus.label" :tone="runStatus.tone" />
          </div>
          <div class="log-run-metrics">
            <div>
              <span>本次记录</span>
              <strong>{{ formatNumber(selectedRun.count || 0) }} 条</strong>
            </div>
            <div>
              <span>耗时</span>
              <strong>{{ selectedRun.duration ? `${selectedRun.duration}ms` : '—' }}</strong>
            </div>
            <div>
              <span>HTTP</span>
              <strong>{{ selectedRun.httpStatus || '—' }}</strong>
            </div>
            <div>
              <span>采集页数</span>
              <strong>{{ selectedRun.pageCount || 1 }}</strong>
            </div>
          </div>
          <div v-if="selectedRun.iteration" class="log-run-iteration">
            <el-icon><Refresh /></el-icon>
            <span>
              遍历 {{ selectedRun.iteration.rowKey }}
              · {{ selectedRun.iteration.index + 1 }}/{{ selectedRun.iteration.total }}
            </span>
            <code>{{ selectedRun.iteration.value }}</code>
          </div>
        </div>
      </section>

      <section class="log-section">
        <div class="log-section-head">
          <h4>执行日志</h4>
          <div class="log-section-tools">
            <span>{{ logs.length }} EVENTS</span>
            <button
              class="log-copy-link"
              type="button"
              :class="{ 'is-copied': copyFeedback === 'logs' }"
              :disabled="!logs.length"
              title="复制执行日志"
              @click="copyLogs"
            >
              <el-icon><CircleCheck v-if="copyFeedback === 'logs'" /><CopyDocument v-else /></el-icon>
              {{ copyFeedback === 'logs' ? '已复制' : '复制' }}
            </button>
          </div>
        </div>
        <div v-if="logs.length" class="terminal">
          <div class="terminal-bar">
            <span class="terminal-dot" />
            <span class="terminal-dot" />
            <span class="terminal-dot" />
            <span class="terminal-title">collector://runs/{{ selectedRun.id.slice(-6) }}</span>
          </div>
          <div class="terminal-body log-terminal-body">
            <div
              v-for="(log, index) in logs"
              :key="index"
              class="log-line"
              :class="`is-${log.type || 'info'}`"
            >
              <span class="log-time">{{ log.time }}</span>
              <span class="log-marker">
                {{ log.type === 'error' ? '✕' : log.type === 'success' ? '✓' : '›' }}
              </span>
              <span class="log-text">{{ log.text }}</span>
            </div>
          </div>
        </div>
        <div v-else class="log-missing">
          <el-icon><InfoFilled /></el-icon>
          <div>
            <strong>暂无可展示的详细日志</strong>
            <span>该次运行只保留了结果摘要，可能是较早版本产生的记录。</span>
          </div>
        </div>
      </section>

      <section v-if="selectedRun.status === 'error' && selectedRun.error" class="log-section">
        <div class="result-error">
          <el-icon><WarningFilled /></el-icon>
          <div>
            <strong>采集错误</strong>
            {{ selectedRun.error }}
          </div>
        </div>
      </section>

      <section v-if="selectedRun.requestUrl" class="log-section">
        <div class="log-section-head">
          <h4>请求地址</h4>
          <span>{{ selectedRun.method || 'GET' }}</span>
        </div>
        <div class="request-url">{{ selectedRun.requestUrl }}</div>
      </section>
    </template>

    <template #footer>
      <div class="log-drawer-footer">
        <span>运行日志保存在服务端工作区</span>
        <div>
          <el-button
            :disabled="!selectedRun"
            :class="{ 'is-copied': copyFeedback === 'full' }"
            @click="copyFullLog"
          >
            <el-icon><CircleCheck v-if="copyFeedback === 'full'" /><CopyDocument v-else /></el-icon>
            {{ copyFeedback === 'full' ? '已复制' : '复制完整日志' }}
          </el-button>
          <el-button type="primary" @click="visible = false">关闭</el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>
