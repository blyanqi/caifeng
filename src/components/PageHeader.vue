<template>
  <section class="page-head">
    <div class="page-head-copy">
      <div class="eyebrow">{{ eyebrow }}</div>
      <h1>{{ translateText(title) }}</h1>
      <p>{{ translateText(description) }}</p>
    </div>
    <div v-if="$slots.actions" class="page-head-actions">
      <slot name="actions" />
    </div>
  </section>
</template>

<script setup>
import { translateText } from '../i18n'

defineProps({
  eyebrow: { type: String, default: 'COLLECT STUDIO' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
</script>
