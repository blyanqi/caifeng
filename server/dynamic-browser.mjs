import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { detectDataPaths, isNoiseUrl, parseJsonOrJsonp } from './json-utils.mjs'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function findBrowser() {
  return CHROME_CANDIDATES.find((candidate) => candidate && existsSync(candidate)) || ''
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=')
      return index > 0
        ? { name: part.slice(0, index), value: part.slice(index + 1) }
        : null
    })
    .filter(Boolean)
}

class CdpConnection {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.seq = 0
    this.pending = new Map()
    this.handlers = new Map()
  }

  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl)
      this.ws = ws
      const timer = setTimeout(() => reject(new Error('连接 Chrome 调试端口超时')), 8000)
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      })
      ws.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('Chrome 调试连接失败'))
      })
      ws.addEventListener('message', (event) => {
        let message
        try {
          message = JSON.parse(String(event.data))
        } catch {
          return
        }
        if (message.id) {
          const pending = this.pending.get(message.id)
          if (!pending) return
          this.pending.delete(message.id)
          if (message.error) pending.reject(new Error(message.error.message || 'Chrome 命令失败'))
          else pending.resolve(message.result)
          return
        }
        const handlers = this.handlers.get(message.method)
        if (handlers) handlers.forEach((handler) => handler(message.params || {}))
      })
    })
  }

  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, handler) {
    const list = this.handlers.get(method) || []
    list.push(handler)
    this.handlers.set(method, list)
  }

  close() {
    try {
      this.ws?.close()
    } catch {
      // ignore
    }
  }
}

async function waitForDebugPort(userDataDir, child, timeoutMs) {
  const portFile = path.join(userDataDir, 'DevToolsActivePort')
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Chrome 已退出（code ${child.exitCode}）`)
    }
    try {
      const text = await readFile(portFile, 'utf8')
      const port = Number(text.split(/\r?\n/)[0])
      if (port) return port
    } catch {
      // not ready yet
    }
    await sleep(100)
  }
  throw new Error('启动 Chrome 超时，请确认已安装 Chrome 或设置 CHROME_PATH')
}

async function createTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: 'PUT',
  })
  if (!response.ok) throw new Error(`无法创建 Chrome 页面（HTTP ${response.status}）`)
  return response.json()
}

async function closeTarget(port, targetId) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`, { method: 'PUT' })
  } catch {
    // ignore
  }
}

async function safeEval(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  return result?.result?.value
}

export async function renderDynamicPage({
  url,
  headers = {},
  cookieHeader = '',
  mode = 'html',
  xhrMatch = '',
  waitMs = 1500,
  timeoutMs = 30000,
} = {}) {
  const browserPath = findBrowser()
  if (!browserPath) {
    throw new Error('未找到 Chrome/Edge，无法执行 JS 动态采集；请安装 Chrome 或设置 CHROME_PATH')
  }
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'caifeng-chrome-'))
  const child = spawn(
    browserPath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-component-update',
      '--metrics-recording-only',
      '--mute-audio',
      '--hide-scrollbars',
      '--window-size=1440,900',
      '--ignore-certificate-errors',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
  )
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-3000)
  })

  let cdp
  let port = 0
  let target
  try {
    port = await waitForDebugPort(userDataDir, child, Math.min(timeoutMs, 15000))
    target = await createTarget(port)
    cdp = new CdpConnection(target.webSocketDebuggerUrl)
    await cdp.open()
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')

    const extraHeaders = {}
    for (const [key, value] of Object.entries(headers || {})) {
      if (!key || ['cookie', 'host', 'content-length'].includes(key.toLowerCase())) continue
      extraHeaders[key] = String(value ?? '')
    }
    if (Object.keys(extraHeaders).length) {
      await cdp.send('Network.setExtraHTTPHeaders', { headers: extraHeaders }).catch(() => {})
    }
    const userAgent = Object.entries(headers || {}).find(
      ([key]) => key.toLowerCase() === 'user-agent',
    )?.[1]
    if (userAgent) {
      await cdp.send('Network.setUserAgentOverride', { userAgent: String(userAgent) }).catch(() => {})
    }
    for (const cookie of parseCookies(cookieHeader)) {
      await cdp
        .send('Network.setCookie', {
          name: cookie.name,
          value: cookie.value,
          url,
        })
        .catch(() => {})
    }

    const xhrResponses = new Map()
    let xhrActive = 0
    let xhrSeen = 0
    let lastXhrAt = Date.now()
    if (mode === 'xhr') {
      cdp.on('Network.requestWillBeSent', (params) => {
        if (!['XHR', 'Fetch'].includes(params.type)) return
        xhrActive += 1
        xhrSeen += 1
        lastXhrAt = Date.now()
      })
      cdp.on('Network.loadingFinished', (params) => {
        if (!xhrResponses.has(params.requestId)) return
        xhrActive = Math.max(0, xhrActive - 1)
        lastXhrAt = Date.now()
      })
      cdp.on('Network.loadingFailed', (params) => {
        if (!xhrResponses.has(params.requestId)) return
        xhrActive = Math.max(0, xhrActive - 1)
        lastXhrAt = Date.now()
      })
      cdp.on('Network.responseReceived', (params) => {
        if (!['XHR', 'Fetch'].includes(params.type)) return
        xhrResponses.set(params.requestId, {
          requestId: params.requestId,
          url: params.response?.url || '',
          status: params.response?.status || 0,
          mimeType: params.response?.mimeType || '',
        })
        lastXhrAt = Date.now()
      })
    }

    const sniffResponses = new Map()
    if (mode === 'sniff') {
      cdp.on('Network.responseReceived', (params) => {
        if (!['XHR', 'Fetch', 'Script'].includes(params.type)) return
        const response = params.response || {}
        if (!response.url || isNoiseUrl(response.url)) return
        if (response.status && (response.status < 200 || response.status >= 400)) return
        if (sniffResponses.size >= 120) return
        const mimeType = String(response.mimeType || '')
        if (
          mimeType &&
          !/(?:json|javascript|ecmascript|text\/plain|text\/html|xml)/i.test(mimeType)
        ) {
          return
        }
        sniffResponses.set(params.requestId, {
          requestId: params.requestId,
          url: response.url,
          status: response.status || 0,
          mimeType,
          resourceType: params.type,
          fromDiskCache: response.fromDiskCache === true,
        })
      })
    }

    const loadPromise = new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.min(timeoutMs, 15000))
      cdp.on('Page.loadEventFired', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    const navigation = await cdp.send('Page.navigate', { url })
    if (navigation?.errorText) throw new Error(`页面加载失败：${navigation.errorText}`)
    await loadPromise
    const waitBudget = Math.max(Number(waitMs) || 0, 300)
    await sleep(waitBudget)

    const finalUrl = await safeEval(cdp, 'location.href')
    const html = await safeEval(cdp, 'document.documentElement.outerHTML')
    let cookies = []
    try {
      const cookieResult = await cdp.send('Network.getAllCookies')
      const host = new URL(finalUrl || url).hostname
      cookies = (cookieResult.cookies || [])
        .filter((cookie) => {
          const domain = String(cookie.domain || '').replace(/^\./, '')
          return !domain || host === domain || host.endsWith(`.${domain}`)
        })
        .map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          expires: cookie.expires,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite,
        }))
    } catch {
      cookies = []
    }
    const localStorageText = await safeEval(
      cdp,
      'JSON.stringify(Object.fromEntries(Object.entries(localStorage)))',
    ).catch(() => '')
    const xhrs = []
    if (mode === 'xhr') {
      for (const item of xhrResponses.values()) {
        if (xhrMatch && !item.url.includes(xhrMatch)) continue
        try {
          const body = await cdp.send('Network.getResponseBody', {
            requestId: item.requestId,
          })
          const text = body.base64Encoded
            ? Buffer.from(body.body || '', 'base64').toString('utf8')
            : String(body.body || '')
          if (text.length > 4 * 1024 * 1024) continue
          xhrs.push({ ...item, body: text })
        } catch {
          // response body may have been evicted
        }
      }
    }
    const sniffs = []
    if (mode === 'sniff') {
      for (const item of sniffResponses.values()) {
        if (sniffs.length >= 24) break
        try {
          const body = await cdp.send('Network.getResponseBody', {
            requestId: item.requestId,
          })
          const text = body.base64Encoded
            ? Buffer.from(body.body || '', 'base64').toString('utf8')
            : String(body.body || '')
          if (!text || text.length > 4 * 1024 * 1024) continue
          const parsed = parseJsonOrJsonp(text)
          if (!parsed) continue
          const paths = detectDataPaths(parsed.data)
          if (!paths.length) continue
          const best = paths[0]
          let parsedUrl
          try {
            parsedUrl = new URL(item.url)
          } catch {
            continue
          }
          const params = [...parsedUrl.searchParams.entries()].map(([key, value]) => ({
            key,
            value,
          }))
          const callbackEntry = params.find((entry) =>
            ['callback', 'cb', 'jsonp', 'jsoncallback'].includes(entry.key.toLowerCase()),
          )
          const jsonp = parsed.jsonp || Boolean(callbackEntry)
          const urlHint = `${parsedUrl.pathname}${parsedUrl.search}`.toLowerCase()
          let score = Math.min(best.score, 8000)
          if (jsonp) score += 1200
          if (/(?:data|report|list|query|search|api)/i.test(urlHint)) score += 120
          if (best.path) score += Math.max(0, 40 - best.path.length * 2)
          sniffs.push({
            id: `${parsedUrl.hostname}${parsedUrl.pathname}${best.path}`.slice(0, 180),
            url: item.url,
            endpoint: `${parsedUrl.origin}${parsedUrl.pathname}`,
            origin: parsedUrl.origin,
            path: parsedUrl.pathname,
            method: 'GET',
            status: item.status,
            resourceType: item.resourceType,
            mimeType: item.mimeType,
            size: text.length,
            jsonp,
            callbackParam: callbackEntry?.key || '',
            params,
            dataPath: best.path,
            recordCount: best.count,
            fields: best.fields,
            sample: best.sample,
            paths: paths.slice(0, 5),
            score: Math.round(score),
            pageUrl: String(finalUrl || url),
          })
        } catch {
          // Response body may have been evicted or be too large.
        }
      }
      sniffs.sort((a, b) => b.score - a.score)
    }

    return {
      html: String(html || ''),
      xhrs,
      sniffs: sniffs.slice(0, 24),
      cookies,
      localStorage: String(localStorageText || ''),
      finalUrl: String(finalUrl || url),
      status: 200,
      browser: browserPath,
    }
  } catch (error) {
    const detail = stderr ? `\n${stderr.slice(-600)}` : ''
    throw new Error(`${error.message || '动态渲染失败'}${detail}`)
  } finally {
    cdp?.close()
    if (port && target?.id) await closeTarget(port, target.id)
    try {
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        child.kill('SIGKILL')
      }
    } catch {
      // ignore
    }
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  }
}
