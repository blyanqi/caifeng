import { reactive } from 'vue'
import { apiRequest } from './api'

export const authState = reactive({
  user: null,
  loading: false,
  checked: false,
  error: '',
})

export function isAdmin() {
  return authState.user?.role === 'admin'
}

export function canWrite() {
  return ['admin', 'operator'].includes(authState.user?.role)
}

export async function fetchMe() {
  if (authState.loading) return authState.user
  authState.loading = true
  try {
    const payload = await apiRequest('/api/auth/me')
    authState.user = payload.user
  } catch (error) {
    authState.user = null
    if (error.status !== 401) authState.error = error.message
  } finally {
    authState.checked = true
    authState.loading = false
  }
  return authState.user
}

export async function login(username, password) {
  authState.error = ''
  const payload = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  })
  authState.user = payload.user
  authState.checked = true
  return payload.user
}

export async function logout() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' })
  } catch {
    // ignore network failure; clear local state anyway
  }
  authState.user = null
}

export async function changePassword(currentPassword, newPassword) {
  return apiRequest('/api/auth/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  })
}

export async function listSessions() {
  return apiRequest('/api/auth/sessions')
}

export async function revokeSession(id) {
  return apiRequest(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
