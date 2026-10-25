<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, EditPen, Plus, User } from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { apiRequest } from '../services/api'
import { authState } from '../services/auth'
import { formatDateTime, fromNow } from '../utils/format'

const users = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const editing = ref(null)
const form = reactive({ username: '', password: '', role: 'operator' })
const saving = ref(false)

async function load() {
  loading.value = true
  try {
    const payload = await apiRequest('/api/users')
    users.value = payload.items || []
  } catch (error) {
    ElMessage.error(error.message || '用户列表加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, { username: '', password: '', role: 'operator' })
  dialogVisible.value = true
}

function openEdit(user) {
  editing.value = user
  Object.assign(form, { username: user.username, password: '', role: user.role })
  dialogVisible.value = true
}

async function save() {
  if (!form.username.trim()) {
    ElMessage.warning('请填写用户名')
    return
  }
  if (!editing.value && form.password.length < 8) {
    ElMessage.warning('初始密码至少 8 位')
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      await apiRequest(`/api/users/${editing.value.id}`, {
        method: 'PATCH',
        body: { role: form.role, status: editing.value.status },
      })
      ElMessage.success('账号已更新')
    } else {
      await apiRequest('/api/users', {
        method: 'POST',
        body: { username: form.username.trim(), password: form.password, role: form.role },
      })
      ElMessage.success('账号已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error(error.message || '保存账号失败')
  } finally {
    saving.value = false
  }
}

async function toggleStatus(user) {
  if (user.id === authState.user?.id) {
    ElMessage.warning('不能停用当前登录账号')
    return
  }
  try {
    await apiRequest(`/api/users/${user.id}`, {
      method: 'PATCH',
      body: { role: user.role, status: user.status === 'active' ? 'disabled' : 'active' },
    })
    ElMessage.success('账号状态已更新')
    await load()
  } catch (error) {
    ElMessage.error(error.message || '更新失败')
  }
}

async function remove(user) {
  if (user.id === authState.user?.id) return
  try {
    await ElMessageBox.confirm(`确认删除账号「${user.username}」？其登录会话会同时失效。`, '删除账号', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await apiRequest(`/api/users/${user.id}`, { method: 'DELETE' })
    ElMessage.success('账号已删除')
    await load()
  } catch {
    // 用户取消
  }
}

onMounted(load)
</script>

<template>
  <div class="users-page">
    <PageHeader
      eyebrow="ACCESS CONTROL"
      title="账号与权限"
      description="管理员可创建成员账号并分配管理员、操作员或只读角色。"
    >
      <template #actions>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建账号
        </el-button>
      </template>
    </PageHeader>

    <section class="data-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>成员账号</h2>
          <p>共 {{ users.length }} 个账号 · 权限在服务端校验</p>
        </div>
      </div>
      <div class="table-wrap">
        <el-table :data="users" class="cf-table" table-layout="fixed">
          <el-table-column label="账号" min-width="230">
            <template #default="{ row }">
              <div class="entity-cell">
                <span class="entity-avatar is-soft">{{ row.username.slice(0, 1).toUpperCase() }}</span>
                <div class="entity-copy">
                  <span class="entity-name">{{ row.username }}</span>
                  <span class="entity-sub">创建于 {{ formatDateTime(row.createdAt) }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="角色" width="130">
            <template #default="{ row }">
              <span class="soft-chip is-accent">
                {{ row.role === 'admin' ? '管理员' : row.role === 'operator' ? '操作员' : '只读成员' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <span class="soft-chip" :class="{ 'is-empty': row.status !== 'active' }">
                {{ row.status === 'active' ? '正常' : '已停用' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="最近登录" width="150">
            <template #default="{ row }">{{ row.lastLoginAt ? fromNow(row.lastLoginAt) : '从未登录' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="190" align="right">
            <template #default="{ row }">
              <div class="action-cluster">
                <button class="row-action" title="编辑角色" @click="openEdit(row)">
                  <el-icon><EditPen /></el-icon>
                </button>
                <el-button
                  size="small"
                  :disabled="row.id === authState.user?.id"
                  @click="toggleStatus(row)"
                >
                  {{ row.status === 'active' ? '停用' : '启用' }}
                </el-button>
                <button
                  class="row-action is-danger"
                  title="删除账号"
                  :disabled="row.id === authState.user?.id"
                  @click="remove(row)"
                >
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <EmptyState :icon="User" title="还没有成员账号" description="创建账号后即可分配角色。" />
          </template>
        </el-table>
      </div>
    </section>

    <el-dialog v-model="dialogVisible" class="cf-dialog" width="min(480px, 94vw)" append-to-body>
      <template #header>
        <div class="dialog-heading">
          <span class="dialog-heading-icon"><el-icon><User /></el-icon></span>
          <div class="dialog-heading-copy">
            <h3>{{ editing ? '编辑成员角色' : '新建成员账号' }}</h3>
            <p>角色权限由服务端 API 统一校验。</p>
          </div>
        </div>
      </template>
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="用户名">
          <el-input v-model="form.username" :disabled="Boolean(editing)" placeholder="3-40 位字母、数字或 _ . -" />
        </el-form-item>
        <el-form-item v-if="!editing" label="初始密码">
          <el-input v-model="form.password" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width: 100%">
            <el-option label="管理员 · 全部权限" value="admin" />
            <el-option label="操作员 · 编辑与采集" value="operator" />
            <el-option label="只读成员 · 仅查看" value="viewer" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <span class="dialog-footer-hint">密码和角色修改会实时生效</span>
          <div class="dialog-footer-actions">
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" :loading="saving" @click="save">保存</el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
