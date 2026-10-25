import { requireUser } from './auth.mjs'
import { readJsonBody, sendError, sendJson } from './http.mjs'
import { buildSessionHeaders, getSiteSessionPayload } from './site-sessions-api.mjs'
import { renderDynamicPage } from './dynamic-browser.mjs'

export async function handleDynamicRender(req, res) {
  if (req.method !== 'POST') return sendError(res, 405, '只支持 POST')
  const user = requireUser(req, res, ['admin', 'operator'])
  if (!user) return
  const body = await readJsonBody(req, 1024 * 1024)
  let target
  try {
    target = new URL(String(body.url || ''))
  } catch {
    return sendError(res, 400, '缺少有效的动态渲染地址')
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    return sendError(res, 400, '动态渲染只支持 HTTP/HTTPS 地址')
  }
  const headers = body.headers && typeof body.headers === 'object' ? body.headers : {}
  let cookieHeader = String(headers.Cookie || headers.cookie || '')
  if (body.siteSessionId) {
    const session = getSiteSessionPayload(String(body.siteSessionId))
    if (!session) return sendError(res, 400, '站点登录会话不存在、已停用或已过期')
    const sessionHeaders = buildSessionHeaders(session)
    if (sessionHeaders.Cookie) cookieHeader = sessionHeaders.Cookie
    if (sessionHeaders.Authorization) headers.Authorization = sessionHeaders.Authorization
  }
  try {
    const rendered = await renderDynamicPage({
      url: target.href,
      headers,
      cookieHeader,
      mode: body.mode === 'xhr' ? 'xhr' : 'html',
      xhrMatch: String(body.xhrMatch || ''),
      waitMs: Math.min(Math.max(Number(body.waitMs) || 1200, 300), 10000),
      timeoutMs: Math.min(Math.max(Number(body.timeoutMs) || 30000, 5000), 60000),
    })
    const xhrs = (rendered.xhrs || []).slice(0, 20)
    let total = 0
    const limited = []
    for (const item of xhrs) {
      total += item.body?.length || 0
      if (total > 8 * 1024 * 1024) break
      limited.push(item)
    }
    sendJson(res, 200, {
      ok: true,
      html: rendered.html,
      xhrs: limited,
      finalUrl: rendered.finalUrl,
      status: rendered.status,
      browser: rendered.browser,
    })
  } catch (error) {
    sendError(res, 502, error?.message || '动态渲染失败')
  }
}
