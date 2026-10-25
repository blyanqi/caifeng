import { db, nowIso } from './db.mjs'
import { requireUser } from './auth.mjs'
import { readJsonBody, sendError, sendJson } from './http.mjs'

const WORKSPACE_ID = 'default'
const MAX_WORKSPACE_BYTES = 12 * 1024 * 1024

export function getWorkspace(req, res) {
  const user = requireUser(req, res)
  if (!user) return
  const row = db
    .prepare('SELECT data, updated_at, updated_by FROM workspaces WHERE id = ? LIMIT 1')
    .get(WORKSPACE_ID)
  if (!row) return sendJson(res, 200, { ok: true, data: null, updatedAt: '', updatedBy: '' })
  let data = null
  try {
    data = JSON.parse(row.data)
  } catch {
    return sendError(res, 500, '服务端工作区数据损坏')
  }
  sendJson(res, 200, {
    ok: true,
    data,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  })
}

export async function saveWorkspace(req, res) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const body = await readJsonBody(req, MAX_WORKSPACE_BYTES)
  if (!body.data || typeof body.data !== 'object') {
    return sendError(res, 400, '缺少工作区数据')
  }
  const serialized = JSON.stringify(body.data)
  if (Buffer.byteLength(serialized) > MAX_WORKSPACE_BYTES) {
    return sendError(res, 413, '工作区数据超过 12MB 限制')
  }
  const now = nowIso()
  db.prepare(
    `INSERT INTO workspaces(id, data, updated_at, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run(WORKSPACE_ID, serialized, now, user.username)
  sendJson(res, 200, { ok: true, updatedAt: now })
}
