<script setup>
import { Delete, Plus } from '@element-plus/icons-vue'
import { uid } from '../utils/format'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue'])

const ATTR_OPTIONS = [
  { value: 'text', label: '文本' },
  { value: 'html', label: 'HTML' },
  { value: 'href', label: '链接 href' },
  { value: 'src', label: '资源 src' },
  { value: 'attribute', label: '指定属性' },
]

function updateField(index, key, value) {
  const next = props.modelValue.map((field, position) =>
    position === index ? { ...field, [key]: value } : field,
  )
  emit('update:modelValue', next)
}

function addField() {
  emit('update:modelValue', [
    ...props.modelValue,
    {
      id: uid('field'),
      key: '',
      selector: '',
      attr: 'text',
      attribute: '',
      enabled: true,
    },
  ])
}

function removeField(index) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_field, position) => position !== index),
  )
}
</script>

<template>
  <div class="fragment-fields">
    <div
      v-for="(field, index) in modelValue"
      :key="field.id || index"
      class="fragment-field-row"
      :class="{ 'is-disabled': field.enabled === false }"
    >
      <span class="fragment-field-index">{{ String(index + 1).padStart(2, '0') }}</span>
      <el-input
        :model-value="field.key"
        class="fragment-key"
        placeholder="字段名"
        @update:model-value="updateField(index, 'key', $event)"
      />
      <el-input
        :model-value="field.selector"
        class="fragment-selector"
        placeholder="CSS 选择器，留空表示当前片段"
        @update:model-value="updateField(index, 'selector', $event)"
      />
      <el-select
        :model-value="field.attr || 'text'"
        class="fragment-attr"
        @update:model-value="updateField(index, 'attr', $event)"
      >
        <el-option
          v-for="option in ATTR_OPTIONS"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <el-input
        v-if="field.attr === 'attribute'"
        :model-value="field.attribute"
        class="fragment-attribute"
        placeholder="属性名，例如 content"
        @update:model-value="updateField(index, 'attribute', $event)"
      />
      <el-switch
        :model-value="field.enabled !== false"
        size="small"
        @update:model-value="updateField(index, 'enabled', $event)"
      />
      <button
        class="fragment-remove"
        type="button"
        title="删除字段"
        @click="removeField(index)"
      >
        <el-icon><Delete /></el-icon>
      </button>
    </div>
    <button class="fragment-add" type="button" @click="addField">
      <el-icon><Plus /></el-icon>
      添加片段字段
    </button>
  </div>
</template>
