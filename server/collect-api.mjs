import dns from 'node:dns'
import { buildSessionHeaders, getSiteSessionPayload } from './site-sessions-api.mjs'

// Prefer IPv4 for upstream requests. Some data providers expose unstable IPv6
// endpoints while their IPv4 endpoints work normally.
dns.setDefaultResultOrder('ipv4first')

const MAX_REQUEST_BYTES = 1024 * 1024
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
const HOP_BY_HOP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'proxy-connection',
  'te',
  'trailer',
])

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function sendJson(res, statusCode, payload) {
  if (res.headersSent) return
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('请求体不是有效 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function normalizeHeaders(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const headers = {}
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = String(rawKey || '').trim()
    if (!key || rawValue === null || rawValue === undefined) continue
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue
    headers[key] = String(rawValue)
  }
  if (!Object.keys(headers).some((key) => key.toLowerCase() === 'user-agent')) {
    headers['User-Agent'] = DEFAULT_USER_AGENT
  }
  if (!Object.keys(headers).some((key) => key.toLowerCase() === 'accept')) {
    headers.Accept = '*/*'
  }
  return headers
}

async function readResponseBody(response) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error(`目标响应超过 ${Math.round(MAX_RESPONSE_BYTES / 1024 / 1024)}MB 上限`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  return buffer.toString('utf8')
}

function normalizeTargetUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('缺少目标 URL')
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('目标 URL 格式不正确')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('服务端代理只支持 HTTP / HTTPS 地址')
  }
  return url.toString()
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

async function collectRemote(payload) {
  const url = normalizeTargetUrl(payload.url)
  const method = String(payload.method || 'GET').toUpperCase()
  if (!ALLOWED_METHODS.has(method)) throw new Error(`不支持的请求方法：${method}`)
  const headers = normalizeHeaders(payload.headers)
  if (payload.siteSessionId) {
    const session = getSiteSessionPayload(String(payload.siteSessionId))
    if (!session || session.status !== 'active') {
      throw new Error('站点登录会话不存在、已停用或已过期')
    }
    const sessionHeaders = buildSessionHeaders(session)
    for (const [key, value] of Object.entries(sessionHeaders)) {
      headers[key] =
        key.toLowerCase() === 'cookie' && headers[key]
          ? `${headers[key]}; ${value}`
          : value
    }
  }
  const timeout = Math.min(Math.max(Number(payload.timeout) || 30000, 1000), 60000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const startedAt = performance.now()

  try {
    const body =
      ['GET', 'HEAD'].includes(method) || payload.body === undefined || payload.body === null
        ? undefined
        : String(payload.body)
    const response = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'follow',
      signal: controller.signal,
    })
    const text = await readResponseBody(response)
    const duration = Math.round(performance.now() - startedAt)
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      upstreamOk: response.ok,
      contentType: response.headers.get('content-type') || '',
      finalUrl: response.url || url,
      duration,
      text,
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`目标站点响应超时（${Math.round(timeout / 1000)} 秒）`)
      timeoutError.statusCode = 504
      throw timeoutError
    }
    const causeCode = error?.cause?.code
    const message =
      causeCode === 'ENOTFOUND'
        ? '目标域名无法解析，请检查站点地址'
        : causeCode === 'ECONNREFUSED'
          ? '目标站点拒绝连接，请检查地址与端口'
          : causeCode === 'ECONNRESET'
            ? '目标站点中断了连接，请稍后重试'
            : causeCode === 'ENETUNREACH' || causeCode === 'EHOSTUNREACH'
              ? '目标地址不可达，请检查网络或代理'
              : error?.message || '服务端请求目标站点失败'
    const proxyError = new Error(`服务端请求失败：${message}`)
    proxyError.statusCode = 502
    throw proxyError
  } finally {
    clearTimeout(timer)
  }
}

export async function handleCollectApi(req, res) {
  if (!sameOrigin(req)) {
    sendJson(res, 403, { ok: false, error: '仅允许同源页面调用采集代理' })
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: '采集代理只接受 POST 请求' })
    return
  }
  try {
    const payload = await readJsonBody(req)
    const result = await collectRemote(payload)
    sendJson(res, 200, result)
  } catch (error) {
    sendJson(res, error.statusCode || 400, {
      ok: false,
      error: error?.message || '采集代理请求失败',
    })
  }
}
