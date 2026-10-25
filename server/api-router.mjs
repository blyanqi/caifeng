import { bootstrapAdmin, getSessionUser, handleLogin, handleLogout, listSessions, publicUser, requireUser, revokeSession, changePassword, listUsers, createUser, updateUser, deleteUser, listAuditLogs } from './auth.mjs'
import { sameOriginRequest, sendError, sendJson } from './http.mjs'
import { getWorkspace, saveWorkspace } from './workspace-api.mjs'
import {
  listSiteSessions,
  createSiteSession,
  updateSiteSession,
  deleteSiteSession,
} from './site-sessions-api.mjs'
import {
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  submitCaptcha,
  pollCaptcha,
  listCaptchaJobs,
} from './captcha-api.mjs'
import {
  listApiClients,
  createApiClient,
  updateApiClient,
  deleteApiClient,
  resetApiKey,
  createApiJob,
  listApiJobs,
  getApiJob,
  handleV1Api,
} from './api-management-api.mjs'
import { handleCollectApi } from './collect-api.mjs'
import { handleDynamicRender } from './dynamic-api.mjs'
import { getPreferences, savePreferences } from './preferences-api.mjs'
import { sniffNetwork } from './network-sniffer.mjs'
import {
  listRiskProfiles,
  createRiskProfile,
  updateRiskProfile,
  deleteRiskProfile,
  resolveRisk,
  listRiskJobs,
} from './risk-api.mjs'
import { handleStorageApi } from './storage-api.mjs'

let backendReady = false

function ensureBackend() {
  if (backendReady) return
  backendReady = true
  bootstrapAdmin()
}

function methodNotAllowed(res) {
  sendError(res, 405, '不支持的请求方法')
}

export async function handleApiRequest(req, res) {
  ensureBackend()
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname
  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, service: 'caifeng-backend', time: new Date().toISOString() })
  }

  if (pathname.startsWith('/api/v1/')) {
    return handleV1Api(req, res, url)
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET') && !sameOriginRequest(req)) {
    return sendError(res, 403, '仅允许同源请求')
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (pathname === '/api/auth/login') return handleLogin(req, res)
  if (pathname === '/api/auth/logout') return handleLogout(req, res)
  if (pathname === '/api/auth/me') {
    const user = getSessionUser(req)
    if (!user) return sendError(res, 401, '未登录')
    return sendJson(res, 200, { ok: true, user: publicUser(user) })
  }
  if (pathname === '/api/auth/password') return changePassword(req, res)
  if (pathname === '/api/auth/sessions' && req.method === 'GET') return listSessions(req, res)
  const sessionMatch = pathname.match(/^\/api\/auth\/sessions\/([^/]+)$/)
  if (sessionMatch && req.method === 'DELETE') return revokeSession(req, res, sessionMatch[1])

  if (pathname === '/api/users') {
    if (req.method === 'GET') return listUsers(req, res)
    if (req.method === 'POST') return createUser(req, res)
    return methodNotAllowed(res)
  }
  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/)
  if (userMatch) {
    if (req.method === 'PATCH' || req.method === 'PUT') return updateUser(req, res, userMatch[1])
    if (req.method === 'DELETE') return deleteUser(req, res, userMatch[1])
    return methodNotAllowed(res)
  }
  if (pathname === '/api/audit-logs') return listAuditLogs(req, res, url)

  if (pathname === '/api/preferences') {
    if (req.method === 'GET') return getPreferences(req, res)
    if (req.method === 'PUT' || req.method === 'POST') return savePreferences(req, res)
    return methodNotAllowed(res)
  }

  if (pathname === '/api/workspace') {
    if (req.method === 'GET') return getWorkspace(req, res)
    if (req.method === 'PUT' || req.method === 'POST') return saveWorkspace(req, res)
    return methodNotAllowed(res)
  }

  if (pathname === '/api/site-sessions') {
    if (req.method === 'GET') return listSiteSessions(req, res, url)
    if (req.method === 'POST') return createSiteSession(req, res)
    return methodNotAllowed(res)
  }
  const siteSessionMatch = pathname.match(/^\/api\/site-sessions\/([^/]+)$/)
  if (siteSessionMatch) {
    if (req.method === 'PUT' || req.method === 'PATCH') {
      return updateSiteSession(req, res, siteSessionMatch[1])
    }
    if (req.method === 'DELETE') return deleteSiteSession(req, res, siteSessionMatch[1])
    return methodNotAllowed(res)
  }

  if (pathname === '/api/sniff') {
    if (req.method === 'POST') return sniffNetwork(req, res)
    return methodNotAllowed(res)
  }

  if (pathname === '/api/risk/profiles') {
    if (req.method === 'GET') return listRiskProfiles(req, res)
    if (req.method === 'POST') return createRiskProfile(req, res)
    return methodNotAllowed(res)
  }
  const riskProfileMatch = pathname.match(/^\/api\/risk\/profiles\/([^/]+)$/)
  if (riskProfileMatch) {
    if (req.method === 'PUT' || req.method === 'PATCH') {
      return updateRiskProfile(req, res, riskProfileMatch[1])
    }
    if (req.method === 'DELETE') return deleteRiskProfile(req, res, riskProfileMatch[1])
    return methodNotAllowed(res)
  }
  if (pathname === '/api/risk/resolve') return resolveRisk(req, res)
  if (pathname === '/api/risk/jobs') {
    if (req.method === 'GET') return listRiskJobs(req, res, url)
    return methodNotAllowed(res)
  }

  if (pathname === '/api/captcha/providers') {
    if (req.method === 'GET') return listProviders(req, res)
    if (req.method === 'POST') return createProvider(req, res)
    return methodNotAllowed(res)
  }
  const providerMatch = pathname.match(/^\/api\/captcha\/providers\/([^/]+)$/)
  if (providerMatch) {
    if (req.method === 'PUT' || req.method === 'PATCH') return updateProvider(req, res, providerMatch[1])
    if (req.method === 'DELETE') return deleteProvider(req, res, providerMatch[1])
    return methodNotAllowed(res)
  }
  if (pathname === '/api/captcha/jobs') {
    if (req.method === 'GET') return listCaptchaJobs(req, res, url)
    return methodNotAllowed(res)
  }
  if (pathname === '/api/captcha/submit') return submitCaptcha(req, res)
  const captchaJobMatch = pathname.match(/^\/api\/captcha\/jobs\/([^/]+)\/poll$/)
  if (captchaJobMatch) return pollCaptcha(req, res, captchaJobMatch[1])

  if (pathname === '/api/api-clients') {
    if (req.method === 'GET') return listApiClients(req, res)
    if (req.method === 'POST') return createApiClient(req, res)
    return methodNotAllowed(res)
  }
  const clientMatch = pathname.match(/^\/api\/api-clients\/([^/]+)$/)
  if (clientMatch) {
    if (req.method === 'PUT' || req.method === 'PATCH') return updateApiClient(req, res, clientMatch[1])
    if (req.method === 'DELETE') return deleteApiClient(req, res, clientMatch[1])
    return methodNotAllowed(res)
  }
  const resetMatch = pathname.match(/^\/api\/api-clients\/([^/]+)\/reset-key$/)
  if (resetMatch) return resetApiKey(req, res, resetMatch[1])

  if (pathname === '/api/api-jobs') {
    if (req.method === 'GET') return listApiJobs(req, res, url)
    if (req.method === 'POST') return createApiJob(req, res)
    return methodNotAllowed(res)
  }
  const apiJobMatch = pathname.match(/^\/api\/api-jobs\/([^/]+)$/)
  if (apiJobMatch && req.method === 'GET') return getApiJob(req, res, apiJobMatch[1])

  if (pathname === '/api/render') {
    return handleDynamicRender(req, res)
  }
  if (pathname === '/api/collect') {
    const user = requireUser(req, res, ['admin', 'operator'])
    if (!user) return
    return handleCollectApi(req, res)
  }
  if (pathname.startsWith('/api/storage/')) {
    const user = requireUser(req, res, ['admin', 'operator'])
    if (!user) return
    return handleStorageApi(req, res)
  }

  sendError(res, 404, '接口不存在')
}
