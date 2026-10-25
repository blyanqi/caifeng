function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '')
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function looksLikeCallbackPrefix(prefix) {
  const cleaned = String(prefix || '')
    .replace(/^\/\*[\s\S]*?\*\//, '')
    .replace(/\/\/.*$/gm, '')
    .trim()
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(cleaned)
}

export function parseJsonOrJsonp(text) {
  const body = stripBom(text).trim()
  if (!body) return null
  try {
    return { data: JSON.parse(body), jsonp: false }
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
    return { data: JSON.parse(inner), jsonp: true }
  } catch {
    return null
  }
}

export function detectDataPaths(root, options = {}) {
  const maxDepth = options.maxDepth ?? 5
  const maxResults = options.maxResults ?? 12
  const results = []
  const seen = new Set()

  function visit(value, path, depth) {
    if (depth > maxDepth || value == null) return
    if (Array.isArray(value)) {
      if (!value.length) return
      const objects = value.filter(isPlainObject)
      if (objects.length === value.length) {
        const fields = Object.keys(objects[0] || {}).filter((key) => key !== '__proto__')
        if (fields.length) {
          const key = path || ''
          if (!seen.has(key)) {
            seen.add(key)
            results.push({
              path: key,
              count: value.length,
              fields: fields.slice(0, 40),
              sample: objects.slice(0, 3),
              score: value.length * Math.min(fields.length, 8),
            })
          }
        }
      }
      return
    }
    if (!isPlainObject(value)) return
    for (const [key, child] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key
      visit(child, nextPath, depth + 1)
    }
  }

  visit(root, '', 0)
  return results.sort((a, b) => b.score - a.score).slice(0, maxResults)
}

export function isNoiseUrl(url) {
  const target = String(url || '')
  if (!/^https?:\/\//i.test(target)) return true
  if (/\.(?:js|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp4|webm|m3u8|pdf)(?:[?#]|$)/i.test(target)) {
    return true
  }
  return /(?:google-analytics|googletagmanager|doubleclick|hm\.baidu|cnzz|umeng|sentry|bugly|beacon|analytics|advert|collect\.|pingback|log\.)/i.test(
    target,
  )
}
