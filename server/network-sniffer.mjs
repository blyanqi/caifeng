import { requireUser, recordAudit } from './auth.mjs'
import { readJsonBody, sendError, sendJson } from './http.mjs'
import { renderDynamicPage } from './dynamic-browser.mjs'
import {
  buildSessionHeaders,
  getSiteSessionPayload,
} from './site-sessions-api.mjs'

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(number, min), max)
}

export async function sniffNetwork(req, res) {
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const body = await readJsonBody(req, 1024 * 1024)
  let target
  try {
    target = new URL(String(body.url || '').trim())
  } catch {
    return sendError(res, 400, '请填写有效的网页地址')
  }
  if (!/^https?:$/.test(target.protocol)) {
    return sendError(res, 400, '只支持 HTTP(S) 网页地址')
  }
  const waitMs = clampNumber(body.waitMs, 1000, 15000, 5000)
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
  }
  let cookieHeader = ''
  if (body.siteSessionId) {
    const session = getSiteSessionPayload(String(body.siteSessionId))
    if (!session || session.status !== 'active') {
      return sendError(res, 400, '站点登录会话不存在、已停用或已过期')
    }
    const sessionHeaders = buildSessionHeaders(session)
    Object.assign(headers, sessionHeaders)
    cookieHeader = sessionHeaders.Cookie || ''
  }
  let rendered
  try {
    rendered = await renderDynamicPage({
      url: target.href,
      headers,
      cookieHeader,
      mode: 'sniff',
      waitMs,
      timeoutMs: 45000,
    })
  } catch (error) {
    return sendError(res, 502, error?.message || '网页接口嗅探失败')
  }
  const candidates = (rendered.sniffs || []).map((candidate) => ({
    ...candidate,
    referer: rendered.finalUrl || target.href,
  }))
  recordAudit(req, user, 'network.sniff', 'page', target.href)
  sendJson(res, 200, {
    ok: true,
    page: {
      url: target.href,
      finalUrl: rendered.finalUrl || target.href,
      candidates: candidates.length,
    },
    candidates,
  })
}
