const PROXY_ENDPOINT = '/api/collect'

export async function serverFetch({
  url,
  method = 'GET',
  headers = {},
  body,
  timeout = 30000,
  siteSessionId = '',
} = {}) {
  const controller = new AbortController()
  const clientTimeout = Math.min(Math.max(Number(timeout) || 30000, 1000) + 5000, 70000)
  const timer = setTimeout(() => controller.abort(), clientTimeout)

  try {
    const response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ url, method, headers, body, timeout, siteSessionId }),
      signal: controller.signal,
      cache: 'no-store',
    })
    const raw = await response.text()
    let payload
    try {
      payload = raw ? JSON.parse(raw) : {}
    } catch {
      throw new Error(
        '服务端采集代理不可用。请使用 npm run dev 启动开发服务，或执行 npm run build && npm start。',
      )
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `服务端代理请求失败（HTTP ${response.status}）`)
    }
    return {
      status: payload.status,
      statusText: payload.statusText || '',
      upstreamOk: payload.upstreamOk !== false,
      contentType: payload.contentType || '',
      finalUrl: payload.finalUrl || url,
      duration: payload.duration || 0,
      text: payload.text ?? '',
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('服务端代理等待超时，请检查目标站点响应速度')
    }
    if (error instanceof TypeError) {
      throw new Error(
        '无法连接本地采集代理。请确认已通过 npm run dev 启动开发服务，或使用 npm start 启动生产服务。',
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
