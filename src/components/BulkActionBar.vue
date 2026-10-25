<script setup>
defineProps({
  count: { type: Number, default: 0 },
  noun: { type: String, default: '记录' },
  busy: { type: Boolean, default: false },
})

defineEmits(['delete', 'clear'])
</script>

<template>
  <div v-if="count" class="bulk-bar">
    <span>已选择 <strong>{{ count }}</strong> 个{{ noun }}</span>
    <span class="bulk-spacer" />
    <slot name="actions" />
    <button class="bulk-action" type="button" :disabled="busy" @click="$emit('delete')">
      删除选中
    </button>
    <button class="bulk-action bulk-cancel" type="button" @click="$emit('clear')">
      取消选择
    </button>
  </div>
</template>
