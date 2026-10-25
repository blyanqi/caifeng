<template>
  <div class="empty-state">
    <div class="empty-visual">
      <el-icon><component :is="icon" /></el-icon>
    </div>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <slot />
  </div>
</template>

<script setup>
import { Collection } from '@element-plus/icons-vue'

defineProps({
  title: { type: String, default: '暂无数据' },
  description: { type: String, default: '创建第一条记录后，数据会显示在这里。' },
  icon: { type: [Object, Function], default: Collection },
})
</script>
