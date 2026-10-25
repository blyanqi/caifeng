<script setup>
import { computed } from 'vue'
import {
  CircleCheck,
  Close,
  Loading,
  Refresh,
  WarningFilled,
} from '@element-plus/icons-vue'
import { formatDateTime, formatNumber } from '../utils/format'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  state: { type: Object, required: true },
})

const emit = defineEmits(['update:modelValue', 'stop'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const running = computed(() => props.state.status === 'running')
const totalToRun = computed(() =>
  Math.max(Number(props.state.total || 0) - Number(props.state.startIndex || 0), 0),
)
const processed = computed(
  () => Number(props.state.successCount || 0) + Number(props.state.failedCount || 0),
)
const percent = computed(() => {
  if (!totalToRun.value) return 100
  return Math.min(Math.round((processed.value / totalToRun.value) * 100), 100)
})
const statusMeta = computed(() => {
  if (props.state.status === 'success') {
    return { label: '遍历完成', tone: 'success', detail: '列表中的剩余值已全部执行完毕' }
  }
  if (props.state.status === 'error') {
    return { label: '遍历中止', tone: 'error', detail: '执行失败，遍历已停止在当前项' }
  }
  if (props.state.status === 'stopped') {
    return { label: '已停止', tone: 'error', detail: '已手动停止，遍历进度会保留' }
  }
  return { label: '正在遍历', tone: 'running', detail: '按列表顺序逐个执行采集任务' }
})

const displayItems = computed(() => props.state.items.slice(-60).reverse())
</script>

<template>
  <el-drawer
    v-model="visible"
    class="cf-drawer batch-run-drawer"
    size="min(560px, 100vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="!running"
    :show-close="!running"
    append-to-body
  >
    <template #header>
      <div class="drawer-heading">
        <span class="drawer-heading-icon">
          <el-icon><Refresh /></el-icon>
        </span>
        <div class="drawer-heading-copy">
          <h3>遍历采集</h3>
          <p>{{ state.task?.name || '采集任务' }}</p>
        </div>
      </div>
    </template>

    <div class="batch-hero" :class="`is-${state.status}`">
      <div class="batch-hero-top">
        <span class="batch-status-icon" :class="`is-${statusMeta.tone}`">
          <el-icon>
            <Loading v-if="running" class="is-spinning" />
            <CircleCheck v-else-if="state.status === 'success'" />
            <WarningFilled v-else />
          </el-icon>
        </span>
        <div class="batch-hero-copy">
          <h2>{{ statusMeta.label }}</h2>
          <p>{{ statusMeta.detail }}</p>
        </div>
        <span class="soft-chip">剩余 {{ totalToRun }} 项 / 共 {{ state.total }}</span>
      </div>

      <div class="batch-progress">
        <span :style="{ width: `${percent}%` }" :class="{ 'is-running': running }" />
      </div>

      <div class="batch-metrics">
        <div>
          <span>已处理</span>
          <strong>{{ processed }} / {{ totalToRun }}</strong>
        </div>
        <div>
          <span>成功</span>
          <strong>{{ state.successCount }}</strong>
        </div>
        <div>
          <span>失败</span>
          <strong>{{ state.failedCount }}</strong>
        </div>
        <div>
          <span>当前进度</span>
          <strong>{{ state.cursor }} / {{ state.total }}</strong>
        </div>
      </div>

      <div v-if="running && state.currentValue" class="batch-current">
        <span>正在采集当前值</span>
        <code>{{ state.currentValue }}</code>
      </div>
      <div v-if="state.error" class="result-error">
        <el-icon><WarningFilled /></el-icon>
        <div>
          <strong>遍历已停止</strong>
          {{ state.error }}
        </div>
      </div>
    </div>

    <section class="batch-list-section">
      <div class="run-section-title">
        <h3>执行记录</h3>
        <span>{{ processed }} 项 · 最近 {{ displayItems.length }} 条</span>
      </div>
      <div v-if="displayItems.length" class="batch-item-list">
        <div
          v-for="item in displayItems"
          :key="`${item.index}-${item.startedAt}`"
          class="batch-item"
          :class="`is-${item.status}`"
        >
          <span class="batch-item-dot" />
          <div class="batch-item-copy">
            <strong>{{ item.value || '空值' }}</strong>
            <span>
              {{ formatDateTime(item.startedAt, { withSeconds: true }) }} ·
              {{ formatNumber(item.count || 0) }} 条 · {{ item.duration || 0 }}ms
            </span>
          </div>
          <span class="batch-item-state">
            {{ item.status === 'success' ? '成功' : '失败' }}
          </span>
        </div>
      </div>
      <div v-else class="batch-empty">
        <el-icon><Refresh /></el-icon>
        等待第一项执行完成…
      </div>
    </section>

    <p class="run-hint">
      每次遍历都会生成独立的运行日志，可在任务「日志查看」中查看每一批的详细记录。
    </p>

    <template #footer>
      <div class="batch-footer">
        <span>{{ running ? '完成后将自动停止，可随时中止。' : '遍历记录已保存到本地。' }}</span>
        <div>
          <el-button v-if="running" type="danger" plain @click="$emit('stop')">
            停止遍历
          </el-button>
          <el-button v-else type="primary" @click="visible = false">
            <el-icon><Close /></el-icon>
            关闭
          </el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>
