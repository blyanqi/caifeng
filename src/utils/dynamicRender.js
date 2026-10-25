export async function renderDynamicPage({
  url,
  headers = {},
  siteSessionId = '',
  mode = 'html',
  xhrMatch = '',
  waitMs = 1200,
  timeout = 30000,
} = {}) {
  const response = await fetch('/api/render', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      headers,
      siteSessionId,
      mode,
      xhrMatch,
      waitMs,
      timeoutMs: timeout,
    }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `动态渲染失败（HTTP ${response.status}）`)
  }
  return payload
}
