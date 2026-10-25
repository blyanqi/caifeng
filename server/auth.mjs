import { db, newId, nowIso } from './db.mjs'
import {
  hashPassword,
  randomToken,
  sha256,
  verifyPassword,
} from './crypto.mjs'
import {
  clearCookie,
  clientIp,
  parseCookies,
  readJsonBody,
  sendError,
  sendJson,
  setCookie,
} from './http.mjs'

const COOKIE_NAME = 'cf_session'
const SESSION_DAYS = Math.min(Math.max(Number(process.env.SESSION_DAYS) || 7, 1), 30)
const IDLE_HOURS = Math.min(Math.max(Number(process.env.SESSION_IDLE_HOURS) || 24, 1), 168)
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1'
const LOGIN_WINDOW_MINUTES = 15
const LOGIN_MAX_FAILURES = 8

const ROLES = new Set(['admin', 'operator', 'viewer'])

function isoAfter(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

function isoAfterHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

export function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  }
}

export function recordAudit(req, user, action, targetType = '', targetId = '', detail = '') {
  try {
    db.prepare(
      `INSERT INTO audit_logs(user_id, username, action, target_type, target_id, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      user?.id || '',
      user?.username || '',
      action,
      targetType,
      targetId,
      typeof detail === 'string' ? detail : JSON.stringify(detail),
      clientIp(req),
      nowIso(),
    )
  } catch (error) {
    console.warn('[audit]', error.message)
  }
}

export function bootstrapAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count
  if (count > 0) return
  const username = String(process.env.ADMIN_USERNAME || 'admin').trim() || 'admin'
  const password =
    String(process.env.ADMIN_PASSWORD || '').trim() ||
    randomToken(12).replace(/[-_]/g, '').slice(0, 14)
  const now = nowIso()
  db.prepare(
    `INSERT INTO users(id, username, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', 'active', ?, ?)`,
  ).run(newId('user'), username, hashPassword(password), now, now)
  console.log(`\n[caifeng] 已创建管理员账号：${username}`)
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`[caifeng] 初始密码：${password}（请登录后立即修改）\n`)
  } else {
    console.log('[caifeng] 管理员密码来自 ADMIN_PASSWORD\n')
  }
}

export function findUserByUsername(username) {
  return db
    .prepare('SELECT * FROM users WHERE lower(username) = lower(?) LIMIT 1')
    .get(String(username || '').trim())
}

export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(id)
}

function recentFailures(username, ip) {
  const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000).toISOString()
  return db
    .prepare(
      `SELECT COUNT(*) AS count FROM login_attempts
       WHERE success = 0 AND created_at > ? AND (username = ? OR ip = ?)`,
    )
    .get(since, username, ip).count
}

function recordLoginAttempt(username, ip, success) {
  db.prepare(
    'INSERT INTO login_attempts(username, ip, success, created_at) VALUES (?, ?, ?, ?)',
  ).run(username || '', ip || '', success ? 1 : 0, nowIso())
}

function createSession(req, user) {
  const token = randomToken(32)
  const id = newId('session')
  const now = nowIso()
  const expiresAt = isoAfter(SESSION_DAYS)
  db.prepare(
    `INSERT INTO sessions(id, user_id, token_hash, ip, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    user.id,
    sha256(token),
    clientIp(req),
    String(req.headers['user-agent'] || '').slice(0, 400),
    now,
    now,
    expiresAt,
  )
  return { token, id, expiresAt }
}

export async function handleLogin(req, res) {
  if (req.method !== 'POST') return sendError(res, 405, '只支持 POST')
  const body = await readJsonBody(req)
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  if (!username || !password) return sendError(res, 400, '请输入用户名和密码')
  const ip = clientIp(req)
  if (recentFailures(username, ip) >= LOGIN_MAX_FAILURES) {
    return sendError(res, 429, '登录失败次数过多，请稍后再试')
  }
  const user = findUserByUsername(username)
  if (!user || user.status !== 'active' || !verifyPassword(password, user.password_hash)) {
    recordLoginAttempt(username, ip, false)
    recordAudit(req, user, 'auth.login_failed', 'user', user?.id || '', `username=${username}`)
    return sendError(res, 401, '用户名或密码错误')
  }
  recordLoginAttempt(username, ip, true)
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(
    nowIso(),
    nowIso(),
    user.id,
  )
  const session = createSession(req, user)
  setCookie(res, COOKIE_NAME, session.token, {
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'Lax',
  })
  recordAudit(req, user, 'auth.login', 'session', session.id)
  sendJson(res, 200, {
    ok: true,
    user: publicUser({ ...user, last_login_at: nowIso() }),
  })
}

export function getSessionUser(req) {
  const token = parseCookies(req)[COOKIE_NAME]
  if (!token) return null
  const row = db
    .prepare(
      `SELECT s.*, u.username, u.role, u.status AS user_status, u.last_login_at, u.created_at AS user_created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL LIMIT 1`,
    )
    .get(sha256(token))
  if (!row) return null
  const now = Date.now()
  if (new Date(row.expires_at).getTime() <= now) return null
  if (row.user_status !== 'active') return null
  const idleLimit = IDLE_HOURS * 60 * 60 * 1000
  if (now - new Date(row.last_seen_at).getTime() > idleLimit) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), row.id)
    return null
  }
  const lastSeen = new Date(row.last_seen_at).getTime()
  if (now - lastSeen > 5 * 60 * 1000) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), row.id)
  }
  return {
    id: row.user_id,
    username: row.username,
    role: row.role,
    status: row.user_status,
    sessionId: row.id,
    created_at: row.user_created_at,
    last_login_at: row.last_login_at,
  }
}

export function requireUser(req, res, roles = []) {
  const user = getSessionUser(req)
  if (!user) {
    sendError(res, 401, '请先登录')
    return null
  }
  if (roles.length && !roles.includes(user.role)) {
    sendError(res, 403, '当前账号没有权限执行此操作')
    return null
  }
  return user
}

export function handleLogout(req, res) {
  const user = getSessionUser(req)
  if (user) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), user.sessionId)
    recordAudit(req, user, 'auth.logout', 'session', user.sessionId)
  }
  clearCookie(res, COOKIE_NAME)
  sendJson(res, 200, { ok: true })
}

export function listSessions(req, res) {
  const user = requireUser(req, res)
  if (!user) return
  const rows = db
    .prepare(
      `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at
       FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
    .all(user.id)
  sendJson(res, 200, {
    ok: true,
    currentSessionId: user.sessionId,
    items: rows.map((row) => ({
      id: row.id,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      current: row.id === user.sessionId,
    })),
  })
}

export function revokeSession(req, res, id) {
  const user = requireUser(req, res)
  if (!user) return
  const target = db
    .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ? LIMIT 1')
    .get(id, user.id)
  if (!target) return sendError(res, 404, '会话不存在')
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), id)
  recordAudit(req, user, 'auth.session_revoke', 'session', id)
  if (id === user.sessionId) clearCookie(res, COOKIE_NAME)
  sendJson(res, 200, { ok: true })
}

export async function changePassword(req, res) {
  const user = requireUser(req, res)
  if (!user) return
  const body = await readJsonBody(req)
  const current = String(body.currentPassword || '')
  const next = String(body.newPassword || '')
  if (next.length < 8) return sendError(res, 400, '新密码至少 8 位')
  const row = findUserById(user.id)
  if (!row || !verifyPassword(current, row.password_hash)) {
    return sendError(res, 400, '当前密码不正确')
  }
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(next),
    nowIso(),
    user.id,
  )
  db.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ?',
  ).run(nowIso(), user.id, user.sessionId)
  recordAudit(req, user, 'auth.password_change', 'user', user.id)
  sendJson(res, 200, { ok: true })
}

export function listUsers(req, res) {
  const user = requireUser(req, res, ['admin'])
  if (!user) return
  const rows = db
    .prepare(
      `SELECT id, username, role, status, created_at, updated_at, last_login_at
       FROM users ORDER BY created_at ASC`,
    )
    .all()
  sendJson(res, 200, {
    ok: true,
    items: rows.map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at,
    })),
  })
}

export async function createUser(req, res) {
  const admin = requireUser(req, res, ['admin'])
  if (!admin) return
  const body = await readJsonBody(req)
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  const role = ROLES.has(body.role) ? body.role : 'operator'
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
    return sendError(res, 400, '用户名需为 3-40 位字母、数字或 _ . -')
  }
  if (password.length < 8) return sendError(res, 400, '密码至少 8 位')
  if (findUserByUsername(username)) return sendError(res, 409, '用户名已存在')
  const now = nowIso()
  const id = newId('user')
  db.prepare(
    `INSERT INTO users(id, username, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  ).run(id, username, hashPassword(password), role, now, now)
  recordAudit(req, admin, 'user.create', 'user', id, `role=${role}`)
  sendJson(res, 201, { ok: true, user: publicUser(findUserById(id)) })
}

export async function updateUser(req, res, id) {
  const admin = requireUser(req, res, ['admin'])
  if (!admin) return
  const target = findUserById(id)
  if (!target) return sendError(res, 404, '用户不存在')
  const body = await readJsonBody(req)
  const role = ROLES.has(body.role) ? body.role : target.role
  const status = ['active', 'disabled'].includes(body.status) ? body.status : target.status
  if (id === admin.id && (role !== 'admin' || status !== 'active')) {
    return sendError(res, 400, '不能禁用或降级当前登录的管理员')
  }
  db.prepare('UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?').run(
    role,
    status,
    nowIso(),
    id,
  )
  if (status === 'disabled') {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ?').run(nowIso(), id)
  }
  recordAudit(req, admin, 'user.update', 'user', id, `role=${role},status=${status}`)
  sendJson(res, 200, { ok: true, user: publicUser(findUserById(id)) })
}

export function deleteUser(req, res, id) {
  const admin = requireUser(req, res, ['admin'])
  if (!admin) return
  if (id === admin.id) return sendError(res, 400, '不能删除当前登录账号')
  const target = findUserById(id)
  if (!target) return sendError(res, 404, '用户不存在')
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  recordAudit(req, admin, 'user.delete', 'user', id, `username=${target.username}`)
  sendJson(res, 200, { ok: true })
}

export function listAuditLogs(req, res, url) {
  const user = requireUser(req, res, ['admin'])
  if (!user) return
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500)
  const rows = db
    .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?')
    .all(limit)
  sendJson(res, 200, { ok: true, items: rows })
}

export const AUTH_COOKIE = COOKIE_NAME
