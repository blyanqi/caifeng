import { db, newId, nowIso, parseJson, toJson } from './db.mjs'
import { decryptText, encryptText } from './crypto.mjs'
import { requireUser, recordAudit } from './auth.mjs'
import { readJsonBody, sendError, sendJson } from './http.mjs'

function publicProvider(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    endpoint: row.endpoint,
    method: row.method,
    hasApiKey: Boolean(row.api_key_encrypted),
    requestTemplate: row.request_template || '',
    headers: parseJson(row.headers_json, {}),
    taskIdPath: row.task_id_path || '',
    resultPath: row.result_path || '',
    statusPath: row.status_path || '',
    successValue: row.success_value || '',
    pollEndpoint: row.poll_endpoint || '',
    pollMethod: row.poll_method || 'GET',
    pollTemplate: row.poll_template || '',
    pollTaskIdParam: row.poll_task_id_param || 'taskId',
    pollIntervalSeconds: row.poll_interval_seconds,
    timeoutSeconds: row.timeout_seconds,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function pathGet(value, pathText) {
  if (!pathText) return undefined
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

function buildRequest(provider, template, variables, endpoint, method) {
  const rendered = renderTemplate(template, variables).trim()
  let body
  const headers = parseJson(provider.headers_json, {})
  if (rendered) {
    try {
      body = JSON.stringify(JSON.parse(rendered))
      headers['Content-Type'] = headers['Content-Type'] || 'application/json'
    } catch {
      body = rendered
    }
  }
  return {
    url: endpoint,
    method,
    headers,
    body: ['GET', 'HEAD'].includes(method) ? undefined : body,
  }
}

async function requestProvider(provider, variables, { poll = false, taskId = '' } = {}) {
  let endpoint = poll ? provider.poll_endpoint || provider.endpoint : provider.endpoint
  if (poll && taskId && !provider.poll_template) {
    const url = new URL(endpoint)
    url.searchParams.set(provider.poll_task_id_param || 'taskId', taskId)
    endpoint = url.toString()
  }
  const template = poll ? provider.poll_template : provider.request_template
  const method = String((poll ? provider.poll_method : provider.method) || 'POST').toUpperCase()
  const request = buildRequest(provider, template, { ...variables, task_id: taskId }, endpoint, method)
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(Number(provider.timeout_seconds) || 30, 5) * 1000,
  )
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      redirect: 'follow',
    })
    const text = await response.text()
    let data = text
    try {
      data = JSON.parse(text)
    } catch {
      // plain text response
    }
    if (!response.ok) {
      throw new Error(`打码接口返回 HTTP ${response.status}：${String(text).slice(0, 200)}`)
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

export function listProviders(req, res) {
  const user = requireUser(req, res)
  if (!user) return
  const rows = db.prepare('SELECT * FROM captcha_providers ORDER BY updated_at DESC').all()
  sendJson(res, 200, { ok: true, items: rows.map(publicProvider) })
}

export async function createProvider(req, res) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const body = await readJsonBody(req)
  const name = String(body.name || '').trim()
  const endpoint = String(body.endpoint || '').trim()
  if (!name) return sendError(res, 400, '请填写打码平台名称')
  if (!/^https?:\/\//i.test(endpoint)) return sendError(res, 400, '请填写有效的接口地址')
  const id = newId('captcha')
  const now = nowIso()
  db.prepare(
    `INSERT INTO captcha_providers(
      id, name, provider_type, endpoint, method, api_key_encrypted, request_template,
      headers_json, task_id_path, result_path, status_path, success_value,
      poll_endpoint, poll_method, poll_template, poll_task_id_param,
      poll_interval_seconds, timeout_seconds, enabled, created_at, updated_at
    ) VALUES (?, ?, 'custom', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    endpoint,
    ['GET', 'POST', 'PUT', 'PATCH'].includes(body.method) ? body.method : 'POST',
    body.apiKey ? encryptText(String(body.apiKey)) : null,
    String(body.requestTemplate || ''),
    toJson(body.headers || {}),
    String(body.taskIdPath || ''),
    String(body.resultPath || ''),
    String(body.statusPath || ''),
    String(body.successValue || ''),
    String(body.pollEndpoint || ''),
    ['GET', 'POST', 'PUT', 'PATCH'].includes(body.pollMethod) ? body.pollMethod : 'GET',
    String(body.pollTemplate || ''),
    String(body.pollTaskIdParam || 'taskId'),
    Math.min(Math.max(Number(body.pollIntervalSeconds) || 3, 1), 60),
    Math.min(Math.max(Number(body.timeoutSeconds) || 120, 5), 600),
    body.enabled === false ? 0 : 1,
    now,
    now,
  )
  recordAudit(req, user, 'captcha.provider_create', 'captcha_provider', id)
  sendJson(res, 201, {
    ok: true,
    item: publicProvider(db.prepare('SELECT * FROM captcha_providers WHERE id = ?').get(id)),
  })
}

export async function updateProvider(req, res, id) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const existing = db.prepare('SELECT * FROM captcha_providers WHERE id = ?').get(id)
  if (!existing) return sendError(res, 404, '打码平台不存在')
  const body = await readJsonBody(req)
  const now = nowIso()
  db.prepare(
    `UPDATE captcha_providers SET
      name = ?, endpoint = ?, method = ?,
      api_key_encrypted = COALESCE(?, api_key_encrypted),
      request_template = ?, headers_json = ?, task_id_path = ?, result_path = ?,
      status_path = ?, success_value = ?, poll_endpoint = ?, poll_method = ?,
      poll_template = ?, poll_task_id_param = ?, poll_interval_seconds = ?,
      timeout_seconds = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    String(body.name ?? existing.name).trim() || existing.name,
    String(body.endpoint ?? existing.endpoint).trim() || existing.endpoint,
    ['GET', 'POST', 'PUT', 'PATCH'].includes(body.method) ? body.method : existing.method,
    body.apiKey ? encryptText(String(body.apiKey)) : null,
    String(body.requestTemplate ?? existing.request_template ?? ''),
    toJson(body.headers ?? parseJson(existing.headers_json, {})),
    String(body.taskIdPath ?? existing.task_id_path ?? ''),
    String(body.resultPath ?? existing.result_path ?? ''),
    String(body.statusPath ?? existing.status_path ?? ''),
    String(body.successValue ?? existing.success_value ?? ''),
    String(body.pollEndpoint ?? existing.poll_endpoint ?? ''),
    ['GET', 'POST', 'PUT', 'PATCH'].includes(body.pollMethod) ? body.pollMethod : existing.poll_method,
    String(body.pollTemplate ?? existing.poll_template ?? ''),
    String(body.pollTaskIdParam ?? existing.poll_task_id_param ?? 'taskId'),
    Math.min(Math.max(Number(body.pollIntervalSeconds ?? existing.poll_interval_seconds) || 3, 1), 60),
    Math.min(Math.max(Number(body.timeoutSeconds ?? existing.timeout_seconds) || 120, 5), 600),
    body.enabled === false ? 0 : body.enabled === true ? 1 : existing.enabled,
    now,
    id,
  )
  recordAudit(req, user, 'captcha.provider_update', 'captcha_provider', id)
  sendJson(res, 200, {
    ok: true,
    item: publicProvider(db.prepare('SELECT * FROM captcha_providers WHERE id = ?').get(id)),
  })
}

export function deleteProvider(req, res, id) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const existing = db.prepare('SELECT * FROM captcha_providers WHERE id = ?').get(id)
  if (!existing) return sendError(res, 404, '打码平台不存在')
  db.prepare('DELETE FROM captcha_providers WHERE id = ?').run(id)
  recordAudit(req, user, 'captcha.provider_delete', 'captcha_provider', id)
  sendJson(res, 200, { ok: true })
}

export async function submitCaptcha(req, res) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const body = await readJsonBody(req)
  const provider = db
    .prepare('SELECT * FROM captcha_providers WHERE id = ? AND enabled = 1')
    .get(String(body.providerId || ''))
  if (!provider) return sendError(res, 404, '打码平台不存在或已停用')
  const variables = {
    api_key: provider.api_key_encrypted ? decryptText(provider.api_key_encrypted) : '',
    captcha_type: String(body.captchaType || 'image'),
    page_url: String(body.pageUrl || ''),
    site_key: String(body.siteKey || ''),
    image: String(body.image || ''),
  }
  const jobId = newId('captcha-job')
  const now = nowIso()
  try {
    const data = await requestProvider(provider, variables)
    const taskId = pathGet(data, provider.task_id_path)
    if (taskId === undefined || taskId === null || taskId === '') {
      throw new Error('打码接口响应中没有找到任务 ID')
    }
    db.prepare(
      `INSERT INTO captcha_jobs(id, provider_id, task_id, captcha_type, page_url, provider_task_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'solving', ?, ?)`,
    ).run(
      jobId,
      provider.id,
      String(body.taskId || ''),
      String(body.captchaType || 'image'),
      String(body.pageUrl || ''),
      String(taskId),
      now,
      now,
    )
    recordAudit(req, user, 'captcha.submit', 'captcha_job', jobId)
    sendJson(res, 200, { ok: true, jobId, providerTaskId: String(taskId) })
  } catch (error) {
    sendError(res, 502, error?.message || '提交打码任务失败')
  }
}

export async function pollCaptcha(req, res, jobId) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const job = db.prepare('SELECT * FROM captcha_jobs WHERE id = ?').get(jobId)
  if (!job) return sendError(res, 404, '打码任务不存在')
  const provider = db.prepare('SELECT * FROM captcha_providers WHERE id = ?').get(job.provider_id)
  if (!provider) return sendError(res, 404, '打码平台不存在')
  if (job.status === 'success') return sendJson(res, 200, { ok: true, job })
  const variables = {
    api_key: provider.api_key_encrypted ? decryptText(provider.api_key_encrypted) : '',
    captcha_type: job.captcha_type || '',
    page_url: job.page_url || '',
  }
  try {
    const data = await requestProvider(provider, variables, {
      poll: true,
      taskId: job.provider_task_id || '',
    })
    const status = provider.status_path ? pathGet(data, provider.status_path) : ''
    const success = provider.success_value
      ? String(status) === String(provider.success_value)
      : true
    if (!success) {
      db.prepare('UPDATE captcha_jobs SET status = ?, updated_at = ? WHERE id = ?').run(
        'solving',
        nowIso(),
        jobId,
      )
      return sendJson(res, 200, { ok: true, status: 'solving', job })
    }
    const token = provider.result_path ? pathGet(data, provider.result_path) : data
    const tokenText = typeof token === 'string' ? token : JSON.stringify(token)
    db.prepare(
      'UPDATE captcha_jobs SET status = ?, token = ?, solved_at = ?, updated_at = ? WHERE id = ?',
    ).run('success', tokenText, nowIso(), nowIso(), jobId)
    sendJson(res, 200, {
      ok: true,
      status: 'success',
      token: tokenText,
      job: db.prepare('SELECT * FROM captcha_jobs WHERE id = ?').get(jobId),
    })
  } catch (error) {
    db.prepare('UPDATE captcha_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(
      'failed',
      error?.message || '轮询失败',
      nowIso(),
      jobId,
    )
    sendError(res, 502, error?.message || '轮询打码结果失败')
  }
}

export function listCaptchaJobs(req, res, url) {
  const user = requireUser(req, res)
  if (!user) return
  const canSeeToken = ['admin', 'operator'].includes(user.role)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500)
  const rows = db
    .prepare(
      `SELECT j.*, p.name AS provider_name FROM captcha_jobs j
       LEFT JOIN captcha_providers p ON p.id = j.provider_id
       ORDER BY j.created_at DESC LIMIT ?`,
    )
    .all(limit)
  sendJson(res, 200, {
    ok: true,
    items: rows.map((row) => (canSeeToken ? row : { ...row, token: null })),
  })
}
