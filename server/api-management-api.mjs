import { db, newId, nowIso, parseJson, toJson } from './db.mjs'
import { randomToken, sha256 } from './crypto.mjs'
import { requireUser, recordAudit } from './auth.mjs'
import { clientIp, readJsonBody, sendError, sendJson } from './http.mjs'
import { buildSessionHeaders, getSiteSessionPayload } from './site-sessions-api.mjs'
import { resolveParamRows } from '../src/utils/params.js'

const ALL_SCOPES = new Set(['jobs:read', 'results:write', 'tasks:read', 'secrets:read'])
const rateBuckets = new Map()

function publicClient(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: parseJson(row.scopes, []),
    webhookUrl: row.webhook_url || '',
    rateLimitPerMinute: row.rate_limit_per_minute,
    ipAllowlist: parseJson(row.ip_allowlist, []),
    status: row.status,
    lastUsedAt: row.last_used_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseScopes(value) {
  const list = Array.isArray(value) ? value : []
  return list.filter((scope) => ALL_SCOPES.has(scope))
}

export function listApiClients(req, res) {
  const user = requireUser(req, res)
  if (!user) return
  const rows = db.prepare('SELECT * FROM api_clients ORDER BY created_at DESC').all()
  sendJson(res, 200, { ok: true, items: rows.map(publicClient) })
}

export async function createApiClient(req, res) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const body = await readJsonBody(req)
  const name = String(body.name || '').trim()
  if (!name) return sendError(res, 400, '请填写 API 客户端名称')
  const id = newId('client')
  const key = `cf_live_${randomToken(24).replace(/[-_]/g, '').slice(0, 32)}`
  const now = nowIso()
  db.prepare(
    `INSERT INTO api_clients(id, name, key_hash, key_prefix, scopes, webhook_url,
      rate_limit_per_minute, ip_allowlist, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(
    id,
    name,
    sha256(key),
    key.slice(0, 15),
    toJson(parseScopes(body.scopes)),
    String(body.webhookUrl || ''),
    Math.min(Math.max(Number(body.rateLimitPerMinute) || 60, 1), 10000),
    toJson(Array.isArray(body.ipAllowlist) ? body.ipAllowlist : []),
    now,
    now,
  )
  recordAudit(req, user, 'api_client.create', 'api_client', id)
  sendJson(res, 201, {
    ok: true,
    key,
    item: publicClient(db.prepare('SELECT * FROM api_clients WHERE id = ?').get(id)),
  })
}

export async function updateApiClient(req, res, id) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const existing = db.prepare('SELECT * FROM api_clients WHERE id = ?').get(id)
  if (!existing) return sendError(res, 404, 'API 客户端不存在')
  const body = await readJsonBody(req)
  db.prepare(
    `UPDATE api_clients SET name = ?, scopes = ?, webhook_url = ?,
      rate_limit_per_minute = ?, ip_allowlist = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    String(body.name ?? existing.name).trim() || existing.name,
    toJson(body.scopes === undefined ? parseJson(existing.scopes, []) : parseScopes(body.scopes)),
    String(body.webhookUrl ?? existing.webhook_url ?? ''),
    Math.min(Math.max(Number(body.rateLimitPerMinute ?? existing.rate_limit_per_minute) || 60, 1), 10000),
    toJson(Array.isArray(body.ipAllowlist) ? body.ipAllowlist : parseJson(existing.ip_allowlist, [])),
    ['active', 'disabled'].includes(body.status) ? body.status : existing.status,
    nowIso(),
    id,
  )
  recordAudit(req, user, 'api_client.update', 'api_client', id)
  sendJson(res, 200, {
    ok: true,
    item: publicClient(db.prepare('SELECT * FROM api_clients WHERE id = ?').get(id)),
  })
}

export function deleteApiClient(req, res, id) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  if (!db.prepare('SELECT id FROM api_clients WHERE id = ?').get(id)) {
    return sendError(res, 404, 'API 客户端不存在')
  }
  db.prepare('DELETE FROM api_clients WHERE id = ?').run(id)
  recordAudit(req, user, 'api_client.delete', 'api_client', id)
  sendJson(res, 200, { ok: true })
}

export async function resetApiKey(req, res, id) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  if (!db.prepare('SELECT id FROM api_clients WHERE id = ?').get(id)) {
    return sendError(res, 404, 'API 客户端不存在')
  }
  const key = `cf_live_${randomToken(24).replace(/[-_]/g, '').slice(0, 32)}`
  db.prepare(
    'UPDATE api_clients SET key_hash = ?, key_prefix = ?, updated_at = ? WHERE id = ?',
  ).run(sha256(key), key.slice(0, 15), nowIso(), id)
  recordAudit(req, user, 'api_client.reset_key', 'api_client', id)
  sendJson(res, 200, { ok: true, key })
}

function readWorkspace() {
  const row = db.prepare('SELECT data FROM workspaces WHERE id = ?').get('default')
  if (!row) return null
  return parseJson(row.data, null)
}

function buildTaskPayload(taskId, scopes = []) {
  const workspace = readWorkspace()
  if (!workspace) throw new Error('工作区尚未初始化')
  const task = (workspace.tasks || []).find((item) => item.id === taskId)
  if (!task) throw new Error('采集任务不存在')
  const site = (workspace.sites || []).find((item) => item.id === task.siteId)
  const config = (workspace.configs || []).find((item) => item.id === task.configId)
  const header = (workspace.headers || []).find((item) => item.id === task.headerId)
  const param = (workspace.params || []).find((item) => item.id === task.paramId)
  const storage = (workspace.storages || []).find((item) => item.id === task.storageId)
  if (!site || !config || !storage) throw new Error('任务关联资源不完整')
  const baseUrl = String(site.baseUrl || '').replace(/\/+$/, '')
  const requestPath = String(config.path || '').replace(/^\/+/, '')
  const url = `${baseUrl}/${requestPath}`.replace(/([^:]\/)\/+/, '$1')
  const headers = {}
  ;(header?.rows || [])
    .filter((row) => row.enabled !== false && row.key?.trim())
    .forEach((row) => {
      headers[row.key.trim()] = row.value ?? ''
    })
  const queryRows = resolveParamRows(param, { now: new Date() })
  const query = queryRows
    .filter((row) => row.enabled !== false && row.key?.trim())
    .map((row) => `${encodeURIComponent(row.key)}=${encodeURIComponent(row.value ?? '')}`)
    .join('&')
  const requestUrl = query ? `${url}${url.includes('?') ? '&' : '?'}${query}` : url
  const session = task.siteSessionId ? getSiteSessionPayload(task.siteSessionId) : null
  if (session) Object.assign(headers, buildSessionHeaders(session))
  if (!scopes.includes('secrets:read')) {
    ;['Cookie', 'Authorization', 'Proxy-Authorization', 'X-API-Key'].forEach((key) => {
      delete headers[key]
    })
  }
  return {
    job: {
      taskId: task.id,
      taskName: task.name,
    },
    request: {
      url: requestUrl,
      method: String(config.method || 'GET').toUpperCase(),
      headers,
      body: config.body || '',
    },
    parameters: queryRows.map((row) => ({ key: row.key, value: row.value })),
    pagination: config.pagination || null,
    parse: {
      type: config.responseType || 'json',
      dataPath: config.dataPath || '',
      pageRule: site.pageRule || null,
      fragmentRule: config.fragmentRule || null,
      linkRule: config.linkRule || null,
      media: config.media || null,
      dynamic: config.dynamic || null,
    },
    storage: {
      type: storage.type,
      target: storage.target,
    },
    session: session ? { id: session.id, name: session.name, type: session.type } : null,
  }
}

function publicJob(row, includePayload = false) {
  if (!row) return null
  return {
    id: row.id,
    clientId: row.client_id,
    taskId: row.task_id,
    taskName: row.task_name,
    direction: row.direction,
    status: row.status,
    resultCount: row.result_count,
    error: row.error || '',
    claimedAt: row.claimed_at || '',
    finishedAt: row.finished_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payload: includePayload ? parseJson(row.payload, null) : undefined,
    result: includePayload ? parseJson(row.result, null) : undefined,
  }
}

async function dispatchPushJob(job, client) {
  if (!client?.webhook_url) {
    db.prepare('UPDATE api_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(
      'error',
      'API 客户端未配置推送 Webhook',
      nowIso(),
      job.id,
    )
    return
  }
  try {
    const response = await fetch(client.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Caifeng-Event': 'job.assigned',
        'X-Caifeng-Job': job.id,
      },
      body: JSON.stringify({
        event: 'job.assigned',
        job: parseJson(job.payload, {}),
        callback: `/api/v1/jobs/${job.id}/result`,
      }),
    })
    if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`)
    db.prepare('UPDATE api_jobs SET status = ?, updated_at = ? WHERE id = ?').run(
      'dispatched',
      nowIso(),
      job.id,
    )
  } catch (error) {
    db.prepare('UPDATE api_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(
      'error',
      error?.message || '推送失败',
      nowIso(),
      job.id,
    )
  }
}

export async function createApiJob(req, res) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const body = await readJsonBody(req)
  const taskId = String(body.taskId || '')
  const clientId = String(body.clientId || '')
  const direction = body.direction === 'push' ? 'push' : 'pull'
  const client = db.prepare('SELECT * FROM api_clients WHERE id = ? AND status = ?').get(clientId, 'active')
  if (!client) return sendError(res, 404, 'API 客户端不存在或已停用')
  let payload
  try {
    payload = buildTaskPayload(taskId, parseJson(client.scopes, []))
  } catch (error) {
    return sendError(res, 400, error.message)
  }
  const id = newId('api-job')
  const now = nowIso()
  payload.callback = `/api/v1/jobs/${id}/result`
  const status = direction === 'push' ? 'pending' : 'pending'
  db.prepare(
    `INSERT INTO api_jobs(id, client_id, task_id, task_name, direction, status, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    clientId,
    taskId,
    payload.job.taskName,
    direction,
    status,
    toJson(payload),
    now,
    now,
  )
  recordAudit(req, user, 'api_job.create', 'api_job', id, `${direction}:${taskId}`)
  const job = db.prepare('SELECT * FROM api_jobs WHERE id = ?').get(id)
  sendJson(res, 201, { ok: true, job: publicJob(job, true) })
  if (direction === 'push') {
    void dispatchPushJob(job, client)
  }
}

export function listApiJobs(req, res, url) {
  const user = requireUser(req, res)
  if (!user) return
  const canSeePayload = ['admin', 'operator'].includes(user.role)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 500)
  const rows = db.prepare('SELECT * FROM api_jobs ORDER BY created_at DESC LIMIT ?').all(limit)
  sendJson(res, 200, {
    ok: true,
    items: rows.map((row) => ({
      ...publicJob(row),
      payload: canSeePayload ? parseJson(row.payload, null) : undefined,
      result: canSeePayload ? parseJson(row.result, null) : undefined,
    })),
  })
}

export function getApiJob(req, res, id) {
  const user = requireUser(req, res)
  if (!user) return
  const row = db.prepare('SELECT * FROM api_jobs WHERE id = ?').get(id)
  if (!row) return sendError(res, 404, 'API 任务不存在')
  sendJson(res, 200, {
    ok: true,
    job: publicJob(row, ['admin', 'operator'].includes(user.role)),
  })
}

function authenticateApiClient(req) {
  const header = String(req.headers.authorization || '')
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!key) return null
  const row = db
    .prepare('SELECT * FROM api_clients WHERE key_hash = ? AND status = ?')
    .get(sha256(key), 'active')
  if (!row) return null
  const allowlist = parseJson(row.ip_allowlist, [])
  const ip = clientIp(req)
  if (allowlist.length && !allowlist.includes(ip)) return null
  const scopes = parseJson(row.scopes, [])
  const now = Date.now()
  const bucket = rateBuckets.get(row.id) || { start: now, count: 0 }
  if (now - bucket.start >= 60000) {
    bucket.start = now
    bucket.count = 0
  }
  bucket.count += 1
  rateBuckets.set(row.id, bucket)
  if (bucket.count > row.rate_limit_per_minute) return null
  db.prepare('UPDATE api_clients SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id)
  return { client: row, scopes }
}

function hasScope(auth, scope) {
  return auth && (auth.scopes.includes(scope) || auth.scopes.includes('*'))
}

export async function handleV1Api(req, res, url) {
  const pathname = url.pathname
  const auth = authenticateApiClient(req)
  if (!auth) return sendError(res, 401, 'API Key 无效、被停用或超出访问限制')
  if (pathname === '/api/v1/ping') {
    return sendJson(res, 200, { ok: true, client: auth.client.name })
  }

  if (pathname === '/api/v1/jobs/next' && req.method === 'GET') {
    if (!hasScope(auth, 'jobs:read')) return sendError(res, 403, '缺少 jobs:read 权限')
    const job = db
      .prepare(
        `SELECT * FROM api_jobs WHERE client_id = ? AND direction = 'pull' AND status = 'pending'
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(auth.client.id)
    if (!job) return sendJson(res, 200, { ok: true, job: null })
    db.prepare('UPDATE api_jobs SET status = ?, claimed_at = ?, updated_at = ? WHERE id = ?').run(
      'claimed',
      nowIso(),
      nowIso(),
      job.id,
    )
    return sendJson(res, 200, {
      ok: true,
      job: publicJob({ ...job, status: 'claimed', claimed_at: nowIso() }, true),
    })
  }

  const match = pathname.match(/^\/api\/v1\/jobs\/([^/]+)(?:\/(result|fail))?$/)
  if (match) {
    const jobId = decodeURIComponent(match[1])
    const action = match[2]
    const job = db
      .prepare('SELECT * FROM api_jobs WHERE id = ? AND client_id = ?')
      .get(jobId, auth.client.id)
    if (!job) return sendError(res, 404, '任务不存在')
    if (!action && req.method === 'GET') {
      if (!hasScope(auth, 'jobs:read')) return sendError(res, 403, '缺少 jobs:read 权限')
      return sendJson(res, 200, { ok: true, job: publicJob(job, true) })
    }
    if (action === 'result' && req.method === 'POST') {
      if (!hasScope(auth, 'results:write')) return sendError(res, 403, '缺少 results:write 权限')
      const body = await readJsonBody(req, 8 * 1024 * 1024)
      const records = Array.isArray(body.records) ? body.records.slice(0, 5000) : []
      const now = nowIso()
      db.prepare(
        `UPDATE api_jobs SET status = 'success', result = ?, result_count = ?, finished_at = ?, updated_at = ?, error = ''
         WHERE id = ?`,
      ).run(toJson({ records, meta: body.meta || {} }), records.length, now, now, job.id)
      return sendJson(res, 200, { ok: true, jobId: job.id, resultCount: records.length })
    }
    if (action === 'fail' && req.method === 'POST') {
      if (!hasScope(auth, 'results:write')) return sendError(res, 403, '缺少 results:write 权限')
      const body = await readJsonBody(req)
      db.prepare(
        `UPDATE api_jobs SET status = 'error', error = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
      ).run(String(body.error || '第三方爬虫执行失败'), nowIso(), nowIso(), job.id)
      return sendJson(res, 200, { ok: true })
    }
  }

  sendError(res, 404, '未知的 API 路径')
}
