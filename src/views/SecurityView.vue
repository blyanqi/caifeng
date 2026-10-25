<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Key, Lock, Monitor } from '@element-plus/icons-vue'
import PageHeader from '../components/PageHeader.vue'
import { authState, changePassword, listSessions, logout, revokeSession } from '../services/auth'
import { formatDateTime, fromNow } from '../utils/format'

const router = useRouter()
const sessions = ref([])
const loading = ref(false)
const saving = ref(false)
const form = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })

async function loadSessions() {
  loading.value = true
  try {
    const payload = await listSessions()
    sessions.value = payload.items || []
  } catch (error) {
    ElMessage.error(error.message || '登录会话加载失败')
  } finally {
    loading.value = false
  }
}

async function revoke(item) {
  try {
    await ElMessageBox.confirm(
      item.current ? '吊销当前会话后需要重新登录，确认继续？' : '确认吊销该登录会话？',
      '吊销会话',
      { confirmButtonText: '吊销', cancelButtonText: '取消', type: 'warning' },
    )
    await revokeSession(item.id)
    if (item.current) {
      authState.user = null
      router.replace('/login')
      return
    }
    ElMessage.success('会话已吊销')
    await loadSessions()
  } catch {
    // 用户取消
  }
}

async function submitPassword() {
  if (form.newPassword.length < 8) {
    ElMessage.warning('新密码至少 8 位')
    return
  }
  if (form.newPassword !== form.confirmPassword) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  saving.value = true
  try {
    await changePassword(form.currentPassword, form.newPassword)
    Object.assign(form, { currentPassword: '', newPassword: '', confirmPassword: '' })
    ElMessage.success('密码已修改，其他登录会话已吊销')
    await loadSessions()
  } catch (error) {
    ElMessage.error(error.message || '修改密码失败')
  } finally {
    saving.value = false
  }
}

async function signOut() {
  await logout()
  router.replace('/login')
}

onMounted(loadSessions)
</script>

<template>
  <div class="security-page">
    <PageHeader
      eyebrow="ACCOUNT SECURITY"
      title="账号与安全"
      description="管理当前账号密码和登录会话。会话保存在服务端 SQLite，可随时吊销。"
    />

    <div class="security-grid">
      <section class="data-card">
        <div class="card-toolbar">
          <div class="toolbar-title">
            <h2>当前账号</h2>
            <p>服务端认证 · HttpOnly Cookie</p>
          </div>
          <span class="soft-chip is-accent">
            {{ authState.user?.role === 'admin' ? '管理员' : authState.user?.role === 'operator' ? '操作员' : '只读成员' }}
          </span>
        </div>
        <div class="security-account">
          <span class="security-avatar">{{ authState.user?.username?.slice(0, 1).toUpperCase() }}</span>
          <div>
            <strong>{{ authState.user?.username }}</strong>
            <span>最近登录 {{ fromNow(authState.user?.lastLoginAt) }}</span>
          </div>
        </div>
        <div class="security-facts">
          <div><span>账号状态</span><strong>正常</strong></div>
          <div><span>登录方式</span><strong>服务端会话</strong></div>
          <div><span>数据存储</span><strong>SQLite</strong></div>
        </div>
        <el-button class="security-logout" @click="signOut">
          <el-icon><Lock /></el-icon>
          退出登录
        </el-button>
      </section>

      <section class="data-card">
        <div class="card-toolbar">
          <div class="toolbar-title">
            <h2>修改密码</h2>
            <p>修改后自动吊销其他登录会话</p>
          </div>
          <span class="card-mini-icon"><el-icon><Key /></el-icon></span>
        </div>
        <el-form label-position="top" class="password-form" @submit.prevent="submitPassword">
          <el-form-item label="当前密码">
            <el-input v-model="form.currentPassword" type="password" show-password autocomplete="current-password" />
          </el-form-item>
          <el-form-item label="新密码">
            <el-input v-model="form.newPassword" type="password" show-password autocomplete="new-password" />
          </el-form-item>
          <el-form-item label="确认新密码">
            <el-input v-model="form.confirmPassword" type="password" show-password autocomplete="new-password" />
          </el-form-item>
          <el-button type="primary" :loading="saving" @click="submitPassword">保存新密码</el-button>
        </el-form>
      </section>
    </div>

    <section class="data-card">
      <div class="card-toolbar">
        <div class="toolbar-title">
          <h2>登录会话</h2>
          <p>最近 {{ sessions.length }} 个服务端会话</p>
        </div>
        <el-button size="small" :loading="loading" @click="loadSessions">刷新</el-button>
      </div>
      <div class="table-wrap">
        <el-table :data="sessions" class="cf-table" table-layout="fixed">
          <el-table-column label="设备 / 客户端" min-width="240">
            <template #default="{ row }">
              <div class="session-cell">
                <span class="session-icon"><el-icon><Monitor /></el-icon></span>
                <div>
                  <strong>{{ row.userAgent || '未知客户端' }}</strong>
                  <span>{{ row.ip || '未知 IP' }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="登录时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt, { withSeconds: true }) }}</template>
          </el-table-column>
          <el-table-column label="最近活跃" width="150">
            <template #default="{ row }">{{ fromNow(row.lastSeenAt) }}</template>
          </el-table-column>
          <el-table-column label="过期时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.expiresAt, { withSeconds: true }) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <span class="soft-chip" :class="row.current ? 'is-accent' : row.revokedAt ? 'is-empty' : ''">
                {{ row.revokedAt ? '已吊销' : row.current ? '当前会话' : '有效' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" align="right">
            <template #default="{ row }">
              <el-button
                v-if="!row.revokedAt"
                size="small"
                type="danger"
                plain
                @click="revoke(row)"
              >
                吊销
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>
  </div>
</template>
