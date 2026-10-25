<template>
  <span class="status-badge" :class="[`is-${tone}`, { 'is-muted': muted }]">
    <i />
    {{ label }}
  </span>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  tone: {
    type: String,
    default: 'ready',
    validator: (value) => ['ready', 'running', 'success', 'error'].includes(value),
  },
  muted: { type: Boolean, default: false },
})
</script>
