const DEFAULT_LIMIT = 1024 * 1024

export function sendJson(res, statusCode, payload) {
  if (res.headersSent) return
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

export function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { ok: false, error: message })
}

export function readJsonBody(req, limit = DEFAULT_LIMIT) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { statusCode: 413 }))
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
        reject(Object.assign(new Error('请求体不是有效 JSON'), { statusCode: 400 }))
      }
    })
    req.on('error', reject)
  })
}

export function parseCookies(req) {
  const header = req.headers.cookie || ''
  const cookies = {}
  header.split(';').forEach((part) => {
    const index = part.indexOf('=')
    if (index < 0) return
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value)
      } catch {
        cookies[key] = value
      }
    }
  })
  return cookies
}

export function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path || '/'}`)
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`)
  if (options.httpOnly !== false) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  parts.push(`SameSite=${options.sameSite || 'Lax'}`)
  const existing = res.getHeader('Set-Cookie')
  const list = existing
    ? Array.isArray(existing)
      ? existing
      : [String(existing)]
    : []
  list.push(parts.join('; '))
  res.setHeader('Set-Cookie', list)
}

export function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0, httpOnly: true, sameSite: 'Lax' })
}

export function sameOriginRequest(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

export function clientIp(req) {
  return (
    String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() ||
    req.socket?.remoteAddress ||
    ''
  )
}

export function getPathname(req) {
  return new URL(req.url || '/', 'http://localhost').pathname
}
