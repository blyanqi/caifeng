<template>
  <div class="kv-editor">
    <div v-if="rows.length" class="kv-head">
      <span>参数名</span>
      <span>参数值</span>
      <span>启用</span>
      <span />
    </div>
    <template v-if="rows.length">
      <div v-for="(row, index) in rows" :key="row.id" class="kv-row">
        <el-input
          v-model="row.key"
          :placeholder="keyPlaceholder"
          spellcheck="false"
          @input="emitChange"
        />
        <el-input
          v-model="row.value"
          :placeholder="valuePlaceholder"
          spellcheck="false"
          @input="emitChange"
        />
        <el-switch v-model="row.enabled" size="small" @change="emitChange" />
        <button class="kv-delete" type="button" title="删除此行" @click="removeRow(index)">
          <el-icon><Delete /></el-icon>
        </button>
      </div>
    </template>
    <div v-else class="kv-empty">还没有配置项，点击下方按钮添加。</div>
    <button class="kv-add" type="button" @click="addRow">
      <el-icon><Plus /></el-icon>
      添加一行
    </button>
  </div>
</template>

<script setup>
import { Delete, Plus } from '@element-plus/icons-vue'
import { uid } from '../utils/format'

const props = defineProps({
  rows: { type: Array, required: true },
  keyPlaceholder: { type: String, default: '例如 Authorization' },
  valuePlaceholder: { type: String, default: '参数值' },
})

const emit = defineEmits(['change'])

function emitChange() {
  emit('change', props.rows)
}

function addRow() {
  props.rows.push({ id: uid('row'), key: '', value: '', enabled: true })
  emitChange()
}

function removeRow(index) {
  props.rows.splice(index, 1)
  emitChange()
}
</script>
