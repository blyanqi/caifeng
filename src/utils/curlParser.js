import { localDateTime, uid } from './format'

function tokenize(input) {
  const normalized = String(input || '')
    .replace(/(?:\\|\^|`)[ \t]*\r?\n/g, ' ')
    .trim()
  const tokens = []
  let current = ''
  let quote = null
  let escaped = false

  for (const char of normalized) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

function findArrayPath(value, prefix = '', depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return ''
  if (Array.isArray(value)) return prefix
  const preferred = ['data', 'items', 'list', 'records', 'results', 'rows', 'products', 'posts']
  for (const key of preferred) {
    if (Array.isArray(value[key])) return prefix ? `${prefix}.${key}` : key
  }
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) return prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object') {
      const found = findArrayPath(child, prefix ? `${prefix}.${key}` : key, depth + 1)
      if (found) return found
    }
  }
  return ''
}

export function inferResponseSample(sample) {
  const text = String(sample || '').trim()
  if (!text) return { responseType: '', dataPath: '' }
  if (text.startsWith('<')) {
    try {
      const doc = new DOMParser().parseFromString(text, 'text/html')
      const images = doc.querySelectorAll('img').length
      const videos =
        doc.querySelectorAll('video').length +
        doc.querySelectorAll('source[src]').length +
        [...doc.querySelectorAll('a[href]')].filter((link) =>
          /\.(mp4|webm|mov|m4v|m3u8)(?:[?#]|$)/i.test(link.getAttribute('href') || ''),
        ).length
      if (videos > 0 && videos >= images) return { responseType: 'video', dataPath: '' }
      if (images >= 4) return { responseType: 'image', dataPath: '' }
      const links = doc.querySelectorAll('a[href]').length
      const articleLike = doc.querySelector('article, main h1, [role="main"] h1')
      if (links >= 10 && images === 0 && !articleLike) {
        return { responseType: 'link', dataPath: '' }
      }
    } catch {
      // fall through to web mode
    }
    return { responseType: 'web', dataPath: '' }
  }
  try {
    const parsed = JSON.parse(text)
    return {
      responseType: 'json',
      dataPath: Array.isArray(parsed) ? '' : findArrayPath(parsed),
    }
  } catch {
    return { responseType: 'text', dataPath: '' }
  }
}

function defaultFragmentFields() {
  return [
    {
      id: uid('field'),
      key: 'title',
      selector: 'title',
      attr: 'text',
      attribute: '',
      enabled: true,
    },
    {
      id: uid('field'),
      key: 'description',
      selector: 'meta[name="description"]',
      attr: 'attribute',
      attribute: 'content',
      enabled: true,
    },
    {
      id: uid('field'),
      key: 'canonical',
      selector: 'link[rel="canonical"]',
      attr: 'href',
      attribute: '',
      enabled: true,
    },
  ]
}

function parseProxy(value) {
  if (!value) return null
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `http://${value}`)
    const protocolMap = { http: 'http', https: 'https', socks5: 'socks5', 'socks5h': 'socks5' }
    const protocol = protocolMap[url.protocol.replace(':', '')]
    if (!protocol) return null
    return {
      name: `导入代理 · ${url.hostname}`,
      protocol,
      host: url.hostname,
      port: Number(url.port) || (protocol === 'https' ? 443 : protocol === 'socks5' ? 1080 : 80),
      username: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
      enabled: true,
      description: '从 cURL 命令识别的代理配置',
    }
  } catch {
    return null
  }
}

function bodyLooksJson(body) {
  try {
    JSON.parse(body)
    return true
  } catch {
    return false
  }
}

function selectorOf(element) {
  if (!element) return ''
  const tag = element.tagName.toLowerCase()
  const classes = [...element.classList]
    .filter((name) => /^[A-Za-z_-][\w-]*$/.test(name))
    .slice(0, 2)
  return `${tag}${classes.map((name) => `.${name}`).join('')}`
}

function inferListPageRule(sample, url) {
  const text = String(sample || '').trim()
  if (!text.startsWith('<')) return null
  let doc
  try {
    doc = new DOMParser().parseFromString(text, 'text/html')
  } catch {
    return null
  }
  if (doc.querySelector('article, main h1, [role="main"] h1')) return null
  const anchors = [...doc.querySelectorAll('a[href]')].filter((anchor) => {
    const href = anchor.getAttribute('href') || ''
    return /^(https?:\/\/|\/)/i.test(href) && !/\.(jpe?g|png|webp|gif|svg|mp4|webm|pdf)(?:[?#]|$)/i.test(href)
  })
  if (anchors.length < 5) return null
  const groups = new Map()
  for (const anchor of anchors) {
    let item = anchor.parentElement
    while (
      item &&
      item.parentElement &&
      item.parentElement !== doc.body &&
      item.parentElement.querySelectorAll('a[href]').length ===
        item.querySelectorAll('a[href]').length
    ) {
      item = item.parentElement
    }
    if (!item || item === doc.body || item === doc.documentElement) continue
    const heading = item.querySelector('h1, h2, h3, h4, .title, .name')
    if (!heading) continue
    const selector = selectorOf(item)
    if (!selector) continue
    const group = groups.get(selector) || { selector, items: [], heading }
    if (!group.items.includes(item)) group.items.push(item)
    groups.set(selector, group)
  }
  const best = [...groups.values()]
    .filter((group) => group.items.length >= 3)
    .sort((a, b) => b.items.length - a.items.length)[0]
  if (!best) return null
  const headingTag = best.heading.tagName.toLowerCase()
  return {
    enabled: true,
    listPath: url.pathname || '/',
    itemSelector: best.selector,
    fields: [
      {
        id: uid('field'),
        key: 'title',
        selector: headingTag,
        attr: 'text',
        attribute: '',
        enabled: true,
      },
      {
        id: uid('field'),
        key: 'detailUrl',
        selector: 'a',
        attr: 'href',
        attribute: '',
        enabled: true,
      },
    ],
    pagination: {
      mode: 'none',
      param: 'page',
      startPage: 1,
      maxPages: 1,
      nextSelector: '',
    },
    crawl: {
      enabled: true,
      maxItems: 50,
      concurrency: 2,
      skipErrors: true,
      childPrefix: 'detail_',
      levels: [
        {
          id: uid('level'),
          key: 'detail',
          name: '详情页',
          linkField: 'detailUrl',
          itemSelector: '',
          fields: [
            {
              id: uid('field'),
              key: 'title',
              selector: 'h1',
              attr: 'text',
              attribute: '',
              enabled: true,
            },
            {
              id: uid('field'),
              key: 'content',
              selector: 'article',
              attr: 'html',
              attribute: '',
              enabled: true,
            },
          ],
          pagination: {
            mode: 'none',
            param: 'page',
            startPage: 1,
            maxPages: 1,
            nextSelector: '',
          },
          dynamic: { enabled: false, waitMs: 1200 },
          enabled: true,
        },
      ],
    },
  }
}

export function parseCurl(curlText, responseSample = '') {
  const tokens = tokenize(curlText)
  if (!tokens.length) throw new Error('请粘贴 cURL 命令')

  const warnings = []
  let urlInput = ''
  let method = ''
  let useGet = false
  let proxyValue = ''
  const headerPairs = []
  const dataParts = []
  let basicAuth = ''
  let cookieValue = ''
  let userAgent = ''

  const noValueFlags = new Set([
    '-s',
    '--silent',
    '-S',
    '--show-error',
    '-L',
    '--location',
    '-k',
    '--insecure',
    '--compressed',
    '-v',
    '--verbose',
    '-i',
    '--include',
    '-f',
    '--fail',
    '--globoff',
    '--http1.1',
    '--http2',
    '--no-buffer',
  ])

  for (let index = 0; index < tokens.length; index += 1) {
    let token = tokens[index]
    if (token === 'curl' || noValueFlags.has(token)) continue

    let inlineValue = ''
    if (token.startsWith('--') && token.includes('=')) {
      const equalsIndex = token.indexOf('=')
      inlineValue = token.slice(equalsIndex + 1)
      token = token.slice(0, equalsIndex)
    }

    const takeValue = () => {
      if (inlineValue) return inlineValue
      index += 1
      return tokens[index] || ''
    }

    if (token === '--url') {
      urlInput = takeValue() || urlInput
      continue
    }
    if (token === '-X' || token === '--request') {
      method = takeValue().toUpperCase()
      continue
    }
    if (token === '-H' || token === '--header') {
      const header = takeValue()
      if (header) headerPairs.push(header)
      continue
    }
    if (
      token === '-d' ||
      token === '--data' ||
      token === '--data-raw' ||
      token === '--data-binary' ||
      token === '--data-urlencode'
    ) {
      const value = takeValue()
      if (value?.startsWith('@')) {
        warnings.push('请求体引用了本地文件，已忽略文件内容，请导入后手动补充。')
      } else if (value) {
        dataParts.push(value)
      }
      continue
    }
    if (token === '-F' || token === '--form') {
      takeValue()
      method = method || 'POST'
      warnings.push('multipart/form-data 请求体暂不支持自动还原，请导入后手动补充。')
      continue
    }
    if (token === '-x' || token === '--proxy') {
      proxyValue = takeValue()
      continue
    }
    if (token === '-G' || token === '--get') {
      useGet = true
      continue
    }
    if (token === '-u' || token === '--user') {
      basicAuth = takeValue()
      continue
    }
    if (token === '-b' || token === '--cookie') {
      const value = takeValue()
      if (value && value.includes('=')) cookieValue = value
      else if (value) warnings.push('Cookie 来自本地文件，已忽略，请导入后手动补充。')
      continue
    }
    if (token === '-A' || token === '--user-agent') {
      userAgent = takeValue()
      continue
    }
    if (token.startsWith('-')) continue
    if (!urlInput) {
      urlInput = token
    }
  }

  if (!urlInput) throw new Error('没有在 cURL 中找到请求 URL')
  if (!/^https?:\/\//i.test(urlInput)) {
    if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:\/|$)/i.test(urlInput)) {
      urlInput = `https://${urlInput}`
    } else {
      throw new Error('请求 URL 格式不正确，请使用完整的 http(s) 地址')
    }
  }

  let url
  try {
    url = new URL(urlInput)
  } catch {
    throw new Error('无法解析请求 URL')
  }

  const inferredSample = inferResponseSample(responseSample)
  const accept = headerPairs
    .find((header) => /^accept\s*:/i.test(header))
    ?.split(':')
    .slice(1)
    .join(':')
    .trim()
    .toLowerCase() || ''
  const pathLower = url.pathname.toLowerCase()
  const hostLower = url.hostname.toLowerCase()
  const xhrHeader = headerPairs.some((header) =>
    /^x-requested-with\s*:\s*xmlhttprequest/i.test(header),
  )
  let responseType = inferredSample.responseType
  if (xhrHeader && ['json', 'text', ''].includes(responseType)) {
    responseType = 'xhr'
  }
  if (!responseType) {
    if (/\.(jpe?g|png|webp|gif|avif|svg|bmp)(?:[?#]|$)/i.test(pathLower)) {
      responseType = 'image'
    } else if (/\.(mp4|webm|mov|m4v|m3u8|flv|avi)(?:[?#]|$)/i.test(pathLower)) {
      responseType = 'video'
    } else if (/(^|\.)(pexels|unsplash|pixabay|500px)\.com$/i.test(hostLower)) {
      responseType = 'image'
    } else if (/(^|\.)(youtube|youtu|vimeo|bilibili|youku|iqiyi)\.com$/i.test(hostLower)) {
      responseType = 'video'
    } else if (accept.includes('text/html') || /\.html?$/.test(pathLower)) {
      responseType = 'web'
    } else if (accept.includes('text/plain') || /\.txt$/.test(pathLower)) {
      responseType = 'text'
    } else {
      responseType = 'json'
    }
  }
  const inferredListRule =
    responseType === 'web' ? inferListPageRule(responseSample, url) : null
  if (inferredListRule) responseType = 'html'
  const fragmentRule =
    responseType === 'web'
      ? { itemSelector: '', fields: defaultFragmentFields() }
      : null
  const linkRule =
    responseType === 'link'
      ? {
          selector: 'a[href]',
          urlContains: '',
          urlContainsNot: '',
          sameOrigin: true,
          dedupe: true,
          maxItems: 500,
        }
      : null
  const media = ['image', 'video'].includes(responseType)
    ? { maxItems: 200, collectResource: true }
    : null
  let pagination = null
  if (['web', 'image', 'video', 'link'].includes(responseType)) {
    for (const key of ['page', 'p', 'paged', 'pageNum']) {
      const value = url.searchParams.get(key)
      if (value && /^\d+$/.test(value)) {
        pagination = {
          mode: 'pageParam',
          param: key,
          startPage: Math.max(Number(value) || 1, 1),
          maxPages: 5,
          nextSelector: '',
        }
        break
      }
    }
  }

  const dataBody = dataParts.join('&')
  const body = useGet ? '' : dataBody
  if (!method) method = dataBody && !useGet ? 'POST' : 'GET'

  if (useGet && dataBody) {
    const extra = new URLSearchParams(dataBody)
    extra.forEach((value, key) => url.searchParams.append(key, value))
  }

  const rows = []
  url.searchParams.forEach((value, key) => {
    rows.push({ key, value, enabled: true })
  })

  if (cookieValue) headerPairs.push(`Cookie: ${cookieValue}`)
  if (userAgent) headerPairs.push(`User-Agent: ${userAgent}`)
  if (basicAuth) {
    try {
      headerPairs.push(`Authorization: Basic ${btoa(basicAuth)}`)
    } catch {
      warnings.push('Basic Auth 账号包含浏览器无法编码的字符，请手动补充 Authorization。')
    }
  }

  const normalizedHeaders = []
  headerPairs.forEach((header) => {
    if (header.startsWith(':')) return
    const separator = header.indexOf(':')
    if (separator <= 0) return
    normalizedHeaders.push({
      key: header.slice(0, separator).trim(),
      value: header.slice(separator + 1).trim(),
      enabled: true,
    })
  })

  const hasContentType = normalizedHeaders.some(
    (header) => header.key.toLowerCase() === 'content-type',
  )
  if (body && !hasContentType) {
    normalizedHeaders.push({
      key: 'Content-Type',
      value: bodyLooksJson(body) ? 'application/json' : 'application/x-www-form-urlencoded',
      enabled: true,
    })
  }

  const host = url.hostname
  const safeHost = host.replace(/[^a-zA-Z0-9.-]/g, '-')
  const configPath = url.pathname || '/'
  const storageType =
    responseType === 'image'
      ? 'image_folder'
      : responseType === 'video'
        ? 'video_folder'
        : responseType === 'text'
          ? 'csv'
          : 'json'
  const storageTarget =
    storageType === 'image_folder'
      ? `data/media/images/${safeHost}`
      : storageType === 'video_folder'
        ? `data/media/videos/${safeHost}`
        : `data/collections/${safeHost}.${storageType}`
  const plan = {
    source: 'local',
    site: {
      name: host,
      baseUrl: url.origin,
      description: `由 cURL 自动识别的数据源站点`,
      enabled: true,
      pageRule: null,
    },
    config: {
      name: `${method} ${configPath}`,
      method,
      path: configPath,
      responseType,
      dataPath: inferredSample.dataPath,
      body,
      fragmentRule,
      linkRule,
      media,
      pagination,
      description: `从 cURL 导入 · ${method} ${configPath}`,
    },
    header: normalizedHeaders.length
      ? {
          name: `导入请求头 · ${host}`,
          description: '从 cURL 命令提取的请求头',
          rows: normalizedHeaders,
        }
      : null,
    param: rows.length
      ? {
          name: `导入参数 · ${host}`,
          description: '从 URL 查询字符串提取的请求参数',
          rows,
        }
      : null,
    proxy: parseProxy(proxyValue),
    storage: {
      name: `导入存储 · ${safeHost}`,
      type: storageType,
      target: storageTarget,
      description: '一键解析生成的采集结果存储',
    },
    task: {
      name: `${host} 采集任务`,
      description: `由 cURL 一键解析生成 · ${method} ${configPath}`,
      collectAt: localDateTime(new Date()),
    },
    pageRule: inferredListRule || null,
    warnings,
  }

  if (responseType === 'web') {
    plan.warnings.push('已按网页片段模式生成基础字段，请根据页面实际结构调整 CSS 选择器。')
  }
  if (responseType === 'image') {
    plan.warnings.push('已按图片采集模式识别，将自动提取页面图片并下载到图片文件夹。')
  }
  if (inferredListRule) {
    plan.warnings.push(
      '已从 HTML 示例推断列表页与详情页，生成两级采集规则；详情页标题/正文选择器为通用值，请在页面规则中确认或调整。',
    )
  }
  if (responseType === 'link') {
    plan.warnings.push('已识别为链接采集，默认只保留同站链接；可在采集配置中调整选择器和包含/排除规则。')
  }
  if (responseType === 'xhr') {
    plan.warnings.push('已识别为 XHR 接口采集，请确认响应数据路径是否正确。')
  }
  if (responseType === 'video') {
    plan.warnings.push('已按视频采集模式识别，将自动提取视频地址并下载到视频文件夹。')
  }
  if (responseType === 'html') {
    plan.warnings.push('检测到 HTML 列表响应，请在「采集站点 → 页面规则」中补充条目选择器。')
  }
  if (plan.proxy) {
    plan.warnings.push('代理配置会保存到代理管理，但出口代理尚未接入服务端转发，暂不会参与请求。')
  }

  return plan
}
