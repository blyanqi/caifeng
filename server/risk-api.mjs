import { db, newId, nowIso, parseJson, toJson } from './db.mjs'
import { decryptText, encryptText } from './crypto.mjs'
import { requireUser, recordAudit } from './auth.mjs'
import { readJsonBody, sendError, sendJson } from './http.mjs'
import { renderDynamicPage } from './dynamic-browser.mjs'

const STRATEGIES = ['custom_api', 'browser', 'manual']
const RISK_TYPES = ['cloudflare', 'akamai', 'datadome', 'perimeterx', 'custom']

function pathGet(value, pathText) {
  if (!pathText) return value
  return String(pathText)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), value)
}

function renderTemplate(template, variables) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_match, key) =>
    variables[key] === undefined || variables[key] === null ? '' : String(variables[key]),
  )
}

function cookieHeaderFromValue(value) {
  if (!value) return { cookies: [], cookieHeader: '' }
  if (typeof value === 'string') {
    return { cookies: value, cookieHeader: value.trim() }
  }
  if (Array.isArray(value)) {
    const cookies = value
      .filter((item) => item?.name)
      .map((item) => ({
        name: item.name,
        value: item.value || '',
        domain: item.domain || '',
        path: item.path || '/',
      }))
    return {
      cookies,
      cookieHeader: cookies.map((item) => `${item.name}=${item.value}`).join('; '),
    }
  }
  if (typeof value === 'object') {
    const cookies = Object.entries(value).map(([name, itemValue]) => ({
      name,
      value: String(itemValue ?? ''),
    }))
    return {
      cookies,
      cookieHeader: cookies.map((item) => `${item.name}=${item.value}`).join('; '),
    }
  }
  return { cookies: [], cookieHeader: '' }
}

function publicProfile(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    siteId: row.site_id || '',
    riskType: row.risk_type,
    strategy: row.strategy,
    endpoint: row.endpoint || '',
    method: row.method || 'POST',
    hasApiKey: Boolean(row.api_key_encrypted),
    headers: parseJson(row.headers_json, {}),
    requestTemplate: row.request_template || '',
    cookiePath: row.cookie_path || '',
    tokenPath: row.token_path || '',
    hasManualCookie: Boolean(row.manual_cookie_encrypted),
    waitMs: row.wait_ms,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listRiskProfiles(req, res) {
  const user = requireUser(req, res)
  if (!user) return
  const rows = db.prepare('SELECT * FROM risk_profiles ORDER BY updated_at DESC').all()
  sendJson(res, 200, { ok: true, items: rows.map(publicProfile) })
}

export async function createRiskProfile(req, res) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const body = await readJsonBody(req)
  const name = String(body.name || '').trim()
  if (!name) return sendError(res, 400, '请填写风控方案名称')
  const strategy = STRATEGIES.includes(body.strategy) ? body.strategy : 'custom_api'
  const riskType = RISK_TYPES.includes(body.riskType) ? body.riskType : 'custom'
  if (strategy === 'custom_api' && !/^https?:\/\//i.test(String(body.endpoint || '').trim())) {
    return sendError(res, 400, '自定义接口策略需要填写 HTTP(S) 接口地址')
  }
  if (strategy === 'manual' && !String(body.manualCookie || '').trim()) {
    return sendError(res, 400, '手动 Cookie 策略需要填写 Cookie 内容')
  }
  const id = newId('risk')
  const now = nowIso()
  db.prepare(
    `INSERT INTO risk_profiles(
      id, name, site_id, risk_type, strategy, endpoint, method, api_key_encrypted,
      headers_json, request_template, cookie_path, token_path,
      manual_cookie_encrypted, wait_ms, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    String(body.siteId || ''),
    riskType,
    strategy,
    String(body.endpoint || ''),
    ['GET', 'POST', 'PUT', 'PATCH'].includes(body.method) ? body.method : 'POST',
    body.apiKey ? encryptText(String(body.apiKey)) : null,
    toJson(body.headers || {}),
    String(body.requestTemplate || ''),
    String(body.cookiePath || ''),
    String(body.tokenPath || ''),
    body.manualCookie ? encryptText(String(body.manualCookie)) : null,
    Math.min(Math.max(Number(body.waitMs) || 3000, 500), 30000),
    body.enabled === false ? 0 : 1,
    now,
    now,
  )
  recordAudit(req, user, 'risk.profile_create', 'risk_profile', id)
  sendJson(res, 201, {
    ok: true,
    item: publicProfile(db.prepare('SELECT * FROM risk_profiles WHERE id = ?').get(id)),
  })
}

export async function updateRiskProfile(req, res, id) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const existing = db.prepare('SELECT * FROM risk_profiles WHERE id = ?').get(id)
  if (!existing) return sendError(res, 404, '风控方案不存在')
  const body = await readJsonBody(req)
  const strategy = STRATEGIES.includes(body.strategy) ? body.strategy : existing.strategy
  const endpoint = String(body.endpoint ?? existing.endpoint ?? '').trim()
  if (strategy === 'custom_api' && !/^https?:\/\//i.test(endpoint)) {
    return sendError(res, 400, '自定义接口策略需要填写 HTTP(S) 接口地址')
  }
  if (strategy === 'manual' && !body.manualCookie && !existing.manual_cookie_encrypted) {
    return sendError(res, 400, '手动 Cookie 策略需要填写 Cookie 内容')
  }
  db.prepare(
    `UPDATE risk_profiles SET
      name = ?, site_id = ?, risk_type = ?, strategy = ?, endpoint = ?, method = ?,
      api_key_encrypted = COALESCE(?, api_key_encrypted),
      headers_json = ?, request_template = ?, cookie_path = ?, token_path = ?,
      manual_cookie_encrypted = COALESCE(?, manual_cookie_encrypted),
      wait_ms = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    String(body.name ?? existing.name).trim() || existing.name,
    String(body.siteId ?? existing.site_id ?? ''),
    RISK_TYPES.includes(body.riskType) ? body.riskType : existing.risk_type,
    strategy,
    endpoint,
    ['GET', 'POST', 'PUT', 'PATCH'].includes(body.method) ? body.method : existing.method,
    body.apiKey ? encryptText(String(body.apiKey)) : null,
    toJson(body.headers ?? parseJson(existing.headers_json, {})),
    String(body.requestTemplate ?? existing.request_template ?? ''),
    String(body.cookiePath ?? existing.cookie_path ?? ''),
    String(body.tokenPath ?? existing.token_path ?? ''),
    body.manualCookie ? encryptText(String(body.manualCookie)) : null,
    Math.min(Math.max(Number(body.waitMs ?? existing.wait_ms) || 3000, 500), 30000),
    body.enabled === false ? 0 : body.enabled === true ? 1 : existing.enabled,
    nowIso(),
    id,
  )
  recordAudit(req, user, 'risk.profile_update', 'risk_profile', id)
  sendJson(res, 200, {
    ok: true,
    item: publicProfile(db.prepare('SELECT * FROM risk_profiles WHERE id = ?').get(id)),
  })
}

export function deleteRiskProfile(req, res, id) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  if (!db.prepare('SELECT id FROM risk_profiles WHERE id = ?').get(id)) {
    return sendError(res, 404, '风控方案不存在')
  }
  db.prepare('DELETE FROM risk_profiles WHERE id = ?').run(id)
  recordAudit(req, user, 'risk.profile_delete', 'risk_profile', id)
  sendJson(res, 200, { ok: true })
}

export async function resolveRisk(req, res) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const body = await readJsonBody(req)
  const profile = db
    .prepare('SELECT * FROM risk_profiles WHERE id = ? AND enabled = 1')
    .get(String(body.profileId || ''))
  if (!profile) return sendError(res, 404, '风控方案不存在或已停用')
  let targetUrl
  try {
    targetUrl = new URL(String(body.url || ''))
  } catch {
    return sendError(res, 400, '缺少有效的目标地址')
  }
  const jobId = newId('risk-job')
  const now = nowIso()
  let cookies = []
  let cookieHeader = ''
  let token = ''
  let localStorage = ''
  try {
    if (profile.strategy === 'browser') {
      const rendered = await renderDynamicPage({
        url: targetUrl.href,
        headers: {},
        mode: 'html',
        waitMs: Number(profile.wait_ms) || 3000,
        timeoutMs: 45000,
      })
      cookies = rendered.cookies || []
      cookieHeader = cookies.map((item) => `${item.name}=${item.value}`).join('; ')
      localStorage = rendered.localStorage || ''
    } else if (profile.strategy === 'manual') {
      const text = profile.manual_cookie_encrypted
        ? decryptText(profile.manual_cookie_encrypted)
        : ''
      const parsed = cookieHeaderFromValue(text)
      cookies = parsed.cookies
      cookieHeader = parsed.cookieHeader
    } else {
      const apiKey = profile.api_key_encrypted
        ? decryptText(profile.api_key_encrypted)
        : ''
      const variables = {
        api_key: apiKey,
        url: targetUrl.href,
        site_id: profile.site_id || '',
        name: profile.name,
      }
      const rendered = renderTemplate(profile.request_template, variables).trim()
      const headers = parseJson(profile.headers_json, {})
      let requestBody
      if (rendered) {
        try {
          requestBody = JSON.stringify(JSON.parse(rendered))
          headers['Content-Type'] = headers['Content-Type'] || 'application/json'
        } catch {
          requestBody = rendered
        }
      }
      const response = await fetch(profile.endpoint, {
        method: profile.method || 'POST',
        headers,
        body: ['GET', 'HEAD'].includes(profile.method) ? undefined : requestBody,
        signal: AbortSignal.timeout(45000),
      })
      const text = await response.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
      if (!response.ok) throw new Error(`风控接口返回 HTTP ${response.status}`)
      const cookieValue = pathGet(data, profile.cookie_path)
      const parsed = cookieHeaderFromValue(cookieValue)
      cookies = parsed.cookies
      cookieHeader = parsed.cookieHeader
      token = String(pathGet(data, profile.token_path) || '')
    }
    if (!cookieHeader && !token) {
      throw new Error('风控方案没有返回 Cookie 或 Token')
    }
    db.prepare(
      `INSERT INTO risk_jobs(id, profile_id, task_id, url, status, cookies_encrypted, token_text, created_at, solved_at)
       VALUES (?, ?, ?, ?, 'success', ?, ?, ?, ?)`,
    ).run(
      jobId,
      profile.id,
      String(body.taskId || ''),
      targetUrl.href,
      cookies.length ? encryptText(JSON.stringify(cookies)) : null,
      token,
      now,
      nowIso(),
    )
    recordAudit(req, user, 'risk.resolve', 'risk_profile', profile.id)
    sendJson(res, 200, {
      ok: true,
      jobId,
      cookies,
      cookieHeader,
      token,
      localStorage,
      profileId: profile.id,
    })
  } catch (error) {
    db.prepare(
      `INSERT INTO risk_jobs(id, profile_id, task_id, url, status, error, created_at)
       VALUES (?, ?, ?, ?, 'error', ?, ?)`,
    ).run(
      jobId,
      profile.id,
      String(body.taskId || ''),
      targetUrl.href,
      error?.message || '风控处理失败',
      now,
    )
    sendError(res, 502, error?.message || '风控处理失败')
  }
}

export function listRiskJobs(req, res, url) {
  const user = requireUser(req, res)
  if (!user) return
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500)
  const rows = db
    .prepare(
      `SELECT j.*, p.name AS profile_name FROM risk_jobs j
       LEFT JOIN risk_profiles p ON p.id = j.profile_id
       ORDER BY j.created_at DESC LIMIT ?`,
    )
    .all(limit)
  const canSeeCookies = ['admin', 'operator'].includes(user.role)
  sendJson(res, 200, {
    ok: true,
    items: rows.map((row) => ({
      ...row,
      cookies_encrypted: canSeeCookies ? undefined : undefined,
    })),
  })
}
