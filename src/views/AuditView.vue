<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Document } from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import { apiRequest } from '../services/api'
import { formatDateTime } from '../utils/format'

const items = ref([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const payload = await apiRequest('/api/audit-logs?limit=200')
    items.value = payload.items || []
  } catch (error) {
    ElMessage.error(error.message || '审计日志加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="audit-page">
    <PageHeader
      eyebrow="AUDIT TRAIL"
      title="操作审计"
      description="记录登录、账号、站点会话、打码平台与 API 客户端的服务端操作。"
    >
      <template #actions>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </template>
    </PageHeader>

    <section class="data-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>最近操作</h2>
          <p>最多显示最近 200 条服务端审计记录</p>
        </div>
        <span class="card-mini-icon"><el-icon><Document /></el-icon></span>
      </div>
      <div class="table-wrap">
        <el-table :data="items" class="cf-table" table-layout="fixed">
          <el-table-column label="时间" width="172">
            <template #default="{ row }">{{ formatDateTime(row.created_at, { withSeconds: true }) }}</template>
          </el-table-column>
          <el-table-column label="账号" width="120">
            <template #default="{ row }">{{ row.username || '系统' }}</template>
          </el-table-column>
          <el-table-column label="操作" min-width="180">
            <template #default="{ row }"><span class="code-text">{{ row.action }}</span></template>
          </el-table-column>
          <el-table-column label="目标" min-width="170">
            <template #default="{ row }">{{ row.target_type || '—' }} {{ row.target_id || '' }}</template>
          </el-table-column>
          <el-table-column label="详情" min-width="220">
            <template #default="{ row }">{{ row.detail || '—' }}</template>
          </el-table-column>
          <el-table-column label="IP" width="140">
            <template #default="{ row }">{{ row.ip || '—' }}</template>
          </el-table-column>
        </el-table>
      </div>
    </section>
  </div>
</template>
