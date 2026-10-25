<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Lock, User } from '@element-plus/icons-vue'
import { login } from '../services/auth'
import { localeState, setLocale, t } from '../i18n'

const router = useRouter()
const route = useRoute()
const loading = ref(false)
const form = reactive({ username: '', password: '' })
const error = ref('')

async function submit() {
  if (!form.username.trim() || !form.password) {
    error.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  error.value = ''
  try {
    await login(form.username.trim(), form.password)
    ElMessage.success('登录成功')
    const redirect =
      typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
        ? route.query.redirect
        : '/collections'
    router.replace(redirect)
  } catch (err) {
    error.value = err?.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-aurora login-aurora-a" />
    <div class="login-aurora login-aurora-b" />
    <button
      class="login-locale"
      type="button"
      @click="setLocale(localeState.locale === 'en' ? 'zh' : 'en')"
    >
      {{ localeState.locale === 'en' ? '中文' : 'EN' }}
    </button>
    <div class="login-shell">
      <section class="login-brand">
        <div class="login-logo">CF</div>
        <p class="login-kicker">COLLECT STUDIO</p>
        <h1>采风</h1>
        <p class="login-tagline">{{ t('settings.tagline', '数据采集与自动化工作台') }}</p>
        <div class="login-points">
          <span>{{ t('settings.point1', 'SQLite 本地数据库') }}</span>
          <span>{{ t('settings.point2', '目标站点登录态') }}</span>
          <span>{{ t('settings.point3', '打码与 API 集成') }}</span>
        </div>
      </section>

      <section class="login-card">
        <div class="login-card-head">
          <span class="login-card-icon"><el-icon><Lock /></el-icon></span>
          <div>
            <h2>{{ t('settings.loginTitle', '登录工作台') }}</h2>
            <p>{{ t('settings.loginSubtitle', '使用管理员或成员账号继续') }}</p>
          </div>
        </div>

        <form class="login-form" @submit.prevent="submit">
          <label class="login-field">
            <span>{{ t('settings.username', '用户名') }}</span>
            <el-input
              v-model="form.username"
              size="large"
              autocomplete="username"
              :placeholder="t('settings.usernamePlaceholder', '请输入用户名')"
            >
              <template #prefix><el-icon><User /></el-icon></template>
            </el-input>
          </label>
          <label class="login-field">
            <span>{{ t('settings.password', '密码') }}</span>
            <el-input
              v-model="form.password"
              size="large"
              type="password"
              show-password
              autocomplete="current-password"
              :placeholder="t('settings.passwordPlaceholder', '请输入密码')"
              @keyup.enter="submit"
            />
          </label>

          <div v-if="error" class="login-error">{{ error }}</div>

          <el-button
            class="login-submit"
            type="primary"
            size="large"
            :loading="loading"
            native-type="submit"
          >
            {{ t('settings.signIn', '登录') }}
          </el-button>
        </form>

        <p class="login-foot">
          {{ t('settings.loginHint', '首次启动会生成管理员账号，请查看服务端控制台或使用 ADMIN_PASSWORD。') }}
        </p>
      </section>
    </div>
  </div>
</template>
