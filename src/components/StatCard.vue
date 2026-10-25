<template>
  <article class="stat-card" :class="`tone-${tone}`">
    <div class="stat-top">
      <span class="stat-label">{{ label }}</span>
      <span class="stat-icon">
        <el-icon><component :is="icon" /></el-icon>
      </span>
    </div>
    <div class="stat-value">
      {{ value }}<span v-if="unit" class="unit">{{ unit }}</span>
    </div>
    <div class="stat-foot">
      <span v-if="trend" class="stat-trend" :class="{ 'is-muted': muted }">{{ trend }}</span>
      <span>{{ hint }}</span>
    </div>
  </article>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  unit: { type: String, default: '' },
  hint: { type: String, default: '' },
  trend: { type: String, default: '' },
  muted: { type: Boolean, default: false },
  icon: { type: [Object, Function], required: true },
  tone: { type: String, default: 'indigo' },
})
</script>
