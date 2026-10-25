function looksLikeCallbackPrefix(prefix) {
  const cleaned = String(prefix || '')
    .replace(/^\/\*[\s\S]*?\*\//, '')
    .replace(/\/\/.*$/gm, '')
    .trim()
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(cleaned)
}

export function parseJsonpPayload(text) {
  const body = String(text || '').replace(/^\uFEFF/, '').trim()
  if (!body) return null
  try {
    return JSON.parse(body)
  } catch {
    // Continue with JSONP detection.
  }
  const open = body.indexOf('(')
  const close = body.lastIndexOf(')')
  if (open <= 0 || close <= open) return null
  if (!looksLikeCallbackPrefix(body.slice(0, open))) return null
  const inner = body.slice(open + 1, close).trim()
  if (!inner) return null
  try {
    return JSON.parse(inner)
  } catch {
    return null
  }
}
