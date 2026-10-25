import { db, newId, nowIso } from './db.mjs'
import { decryptText, encryptText } from './crypto.mjs'
import { requireUser, recordAudit } from './auth.mjs'
import { readJsonBody, sendError, sendJson } from './http.mjs'

function publicSession(row) {
  if (!row) return null
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    type: row.type,
    status: row.status,
    expiresAt: row.expires_at || '',
    lastCheckedAt: row.last_checked_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expired: Boolean(row.expires_at && new Date(row.expires_at).getTime() < Date.now()),
  }
}

function normalizePayload(payload) {
  if (payload === null || payload === undefined) return ''
  if (typeof payload === 'string') return payload
  return JSON.stringify(payload, null, 2)
}

export function listSiteSessions(req, res, url) {
  const user = requireUser(req, res)
  if (!user) return
  const siteId = url.searchParams.get('siteId')
  const rows = siteId
    ? db.prepare('SELECT * FROM site_sessions WHERE site_id = ? ORDER BY updated_at DESC').all(siteId)
    : db.prepare('SELECT * FROM site_sessions ORDER BY updated_at DESC').all()
  sendJson(res, 200, { ok: true, items: rows.map(publicSession) })
}

export async function createSiteSession(req, res) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const body = await readJsonBody(req)
  const siteId = String(body.siteId || '').trim()
  const name = String(body.name || '').trim()
  if (!siteId) return sendError(res, 400, '缺少站点 ID')
  if (!name) return sendError(res, 400, '缺少会话名称')
  const type = ['cookie', 'bearer', 'storage_state'].includes(body.type) ? body.type : 'cookie'
  const payload = normalizePayload(body.payload)
  if (!payload) return sendError(res, 400, '缺少 Cookie / Token 内容')
  const now = nowIso()
  const id = newId('site-session')
  db.prepare(
    `INSERT INTO site_sessions(id, site_id, name, type, payload_encrypted, status, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  ).run(
    id,
    siteId,
    name,
    type,
    encryptText(payload),
    String(body.expiresAt || ''),
    now,
    now,
  )
  recordAudit(req, user, 'site_session.create', 'site_session', id, `site=${siteId}`)
  sendJson(res, 201, {
    ok: true,
    item: publicSession(db.prepare('SELECT * FROM site_sessions WHERE id = ?').get(id)),
  })
}

export async function updateSiteSession(req, res, id) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const existing = db.prepare('SELECT * FROM site_sessions WHERE id = ? LIMIT 1').get(id)
  if (!existing) return sendError(res, 404, '站点会话不存在')
  const body = await readJsonBody(req)
  const payload = body.payload === undefined ? null : normalizePayload(body.payload)
  const now = nowIso()
  db.prepare(
    `UPDATE site_sessions SET
      name = ?, type = ?, status = ?, expires_at = ?,
      payload_encrypted = COALESCE(?, payload_encrypted), updated_at = ?
     WHERE id = ?`,
  ).run(
    String(body.name ?? existing.name).trim() || existing.name,
    ['cookie', 'bearer', 'storage_state'].includes(body.type) ? body.type : existing.type,
    ['active', 'disabled'].includes(body.status) ? body.status : existing.status,
    String(body.expiresAt ?? existing.expires_at ?? ''),
    payload ? encryptText(payload) : null,
    now,
    id,
  )
  recordAudit(req, user, 'site_session.update', 'site_session', id)
  sendJson(res, 200, {
    ok: true,
    item: publicSession(db.prepare('SELECT * FROM site_sessions WHERE id = ?').get(id)),
  })
}

export function deleteSiteSession(req, res, id) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const existing = db.prepare('SELECT * FROM site_sessions WHERE id = ? LIMIT 1').get(id)
  if (!existing) return sendError(res, 404, '站点会话不存在')
  db.prepare('DELETE FROM site_sessions WHERE id = ?').run(id)
  recordAudit(req, user, 'site_session.delete', 'site_session', id)
  sendJson(res, 200, { ok: true })
}

export function getSiteSessionPayload(id) {
  if (!id) return null
  const row = db.prepare('SELECT * FROM site_sessions WHERE id = ? LIMIT 1').get(id)
  if (!row || row.status !== 'active') return null
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null
  try {
    return { ...row, payload: decryptText(row.payload_encrypted) }
  } catch {
    return null
  }
}

export function buildSessionHeaders(session) {
  const headers = {}
  if (!session?.payload) return headers
  if (session.type === 'bearer') {
    headers.Authorization = `Bearer ${String(session.payload).trim()}`
    return headers
  }
  let cookieText = ''
  try {
    const parsed = JSON.parse(session.payload)
    if (Array.isArray(parsed.cookies)) {
      cookieText = parsed.cookies
        .filter((cookie) => cookie?.name)
        .map((cookie) => `${cookie.name}=${cookie.value || ''}`)
        .join('; ')
    } else if (parsed && typeof parsed === 'object') {
      cookieText = Object.entries(parsed)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ')
    }
  } catch {
    cookieText = String(session.payload || '').trim()
  }
  if (cookieText) headers.Cookie = cookieText
  return headers
}
