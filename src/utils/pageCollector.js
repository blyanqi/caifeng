import { serverFetch } from './serverFetch'
import { renderDynamicPage } from './dynamicRender'

function trimText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseHtmlDocument(html) {
  return new DOMParser().parseFromString(String(html || ''), 'text/html')
}

function queryOne(root, selector, label) {
  if (!selector) return null
  try {
    return root.querySelector(selector)
  } catch {
    throw new Error(`${label}无效：${selector}`)
  }
}

export function extractFieldValue(item, field, baseUrl = '') {
  if (field?.enabled === false) return ''
  const target = field.selector ? queryOne(item, field.selector, `字段「${field.key || '未命名'}」的 CSS 选择器`) : item
  if (!target) return ''
  const attr = field.attr || 'text'
  if (attr === 'text') return trimText(target.textContent)
  if (attr === 'html') return target.innerHTML
  if (attr === 'href' || attr === 'src') {
    const value = target.getAttribute(attr) || ''
    return baseUrl ? absoluteUrl(value, baseUrl) : value
  }
  if (attr === 'attribute') {
    return field.attribute?.trim() ? target.getAttribute(field.attribute.trim()) || '' : ''
  }
  return trimText(target.textContent)
}

export function extractRecordsFromDocument(doc, pageRule, baseUrl = '', options = {}) {
  const selector = pageRule?.itemSelector?.trim()
  if (!selector && !options.allowEmpty) {
    throw new Error('请先填写列表条目选择器（itemSelector）')
  }
  let items
  try {
    items = selector ? [...doc.querySelectorAll(selector)] : [doc.documentElement]
  } catch {
    throw new Error(`条目选择器无效：${selector}`)
  }
  const fields = (pageRule.fields || []).filter((field) => field.enabled !== false && field.key?.trim())
  if (!fields.length) throw new Error('请至少配置一个启用的字段映射')

  return items.map((item) => {
    const record = {}
    fields.forEach((field) => {
      record[field.key.trim()] = extractFieldValue(item, field, baseUrl)
    })
    return record
  })
}

function absoluteUrl(value, baseUrl) {
  const raw = String(value || '').trim()
  if (!raw || /^(data|javascript|mailto|tel):/i.test(raw)) return ''
  try {
    return new URL(raw, baseUrl).href
  } catch {
    return ''
  }
}

function srcsetUrls(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean)
}

function pageTitle(doc) {
  const socialTitle =
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
    doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content')
  return trimText(socialTitle || doc.querySelector('title')?.textContent || '')
}

export function extractLinkRecords(doc, rule, pageUrl, maxItems = 500) {
  const selector = String(rule?.selector || 'a[href]').trim() || 'a[href]'
  let anchors
  try {
    anchors = [...doc.querySelectorAll(selector)]
  } catch {
    throw new Error(`链接选择器无效：${selector}`)
  }
  const include = String(rule?.urlContains || '').trim().toLowerCase()
  const exclude = String(rule?.urlContainsNot || '').trim().toLowerCase()
  const sameOrigin = rule?.sameOrigin !== false
  const dedupe = rule?.dedupe !== false
  const baseOrigin = (() => {
    try {
      return new URL(pageUrl).origin
    } catch {
      return ''
    }
  })()
  const seen = new Set()
  const records = []
  for (const anchor of anchors) {
    const url = absoluteUrl(anchor.getAttribute('href'), pageUrl)
    if (!url) continue
    if (sameOrigin && baseOrigin) {
      try {
        if (new URL(url).origin !== baseOrigin) continue
      } catch {
        continue
      }
    }
    const lowered = url.toLowerCase()
    if (include && !lowered.includes(include)) continue
    if (exclude && lowered.includes(exclude)) continue
    if (dedupe && seen.has(url)) continue
    seen.add(url)
    const text = trimText(anchor.textContent)
    records.push({
      url,
      text,
      title: trimText(anchor.getAttribute('title')) || text,
      rel: trimText(anchor.getAttribute('rel')),
      target: trimText(anchor.getAttribute('target')),
      pageUrl,
    })
    if (records.length >= Math.max(1, Number(maxItems) || 500)) break
  }
  if (!records.length) throw new Error('页面中没有匹配到可采集的链接')
  return records
}

export function extractFragmentRecords(doc, rule, pageUrl, maxItems = 200) {
  const fields = (rule?.fields || []).filter(
    (field) => field.enabled !== false && field.key?.trim(),
  )
  if (!fields.length) throw new Error('网页片段采集至少需要配置一个字段')
  const selector = rule?.itemSelector?.trim()
  let items
  if (selector) {
    try {
      items = [...doc.querySelectorAll(selector)]
    } catch {
      throw new Error(`片段条目选择器无效：${selector}`)
    }
  } else {
    items = [doc.documentElement]
  }
  if (!items.length) throw new Error('网页片段选择器没有匹配到任何内容')

  return items.slice(0, Math.max(1, Number(maxItems) || 200)).map((item) => {
    const record = {}
    fields.forEach((field) => {
      const key = field.key.trim()
      let value = extractFieldValue(item, field, pageUrl)
      if (value && ['href', 'src'].includes(field.attr)) {
        value = absoluteUrl(value, pageUrl)
      }
      record[key] = value
    })
    if (!record.pageUrl) record.pageUrl = pageUrl
    return record
  })
}

export function extractImageRecords(doc, pageUrl, options = {}) {
  const maxItems = Math.min(Math.max(Number(options.maxItems) || 300, 1), 2000)
  const records = []
  const seen = new Set()
  const title = pageTitle(doc)
  const imagePattern = /\.(jpe?g|png|webp|gif|avif|svg|bmp)(?:[?#]|$)/i

  const pushImage = (url, alt = '', extra = {}) => {
    const absolute = absoluteUrl(url, pageUrl)
    if (!absolute || seen.has(absolute) || records.length >= maxItems) return
    seen.add(absolute)
    records.push({
      url: absolute,
      alt: trimText(alt),
      title,
      width: extra.width || '',
      height: extra.height || '',
      sourceUrl: pageUrl,
    })
  }

  doc.querySelectorAll('img').forEach((img) => {
    const candidates = [
      img.getAttribute('data-src'),
      img.getAttribute('data-original'),
      img.getAttribute('data-lazy-src'),
      img.getAttribute('data-url'),
      img.getAttribute('src'),
    ].filter(Boolean)
    const srcset = [
      ...srcsetUrls(img.getAttribute('srcset')),
      ...srcsetUrls(img.getAttribute('data-srcset')),
    ]
    if (srcset.length) candidates.push(srcset[srcset.length - 1])
    const url = candidates.find((value) => !String(value).startsWith('data:'))
    pushImage(url, img.getAttribute('alt') || img.getAttribute('title'), {
      width: img.getAttribute('width') || '',
      height: img.getAttribute('height') || '',
    })
  })

  doc.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href') || ''
    if (imagePattern.test(href)) {
      pushImage(href, trimText(link.textContent) || link.getAttribute('title') || title)
    }
  })

  const metaImage =
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
    doc.querySelector('meta[property="og:image:secure_url"]')?.getAttribute('content') ||
    doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
    doc.querySelector('link[rel="image_src"]')?.getAttribute('href')
  if (metaImage) pushImage(metaImage, title)

  if (!records.length) throw new Error('页面中没有找到可采集的图片')
  return records
}

export function extractVideoRecords(doc, pageUrl, options = {}) {
  const maxItems = Math.min(Math.max(Number(options.maxItems) || 200, 1), 1000)
  const records = []
  const seen = new Set()
  const title = pageTitle(doc)
  const videoPattern = /\.(mp4|webm|ogg|ogv|mov|m4v|m3u8|flv|avi)(?:[?#]|$)/i

  const pushVideo = (url, extra = {}) => {
    const absolute = absoluteUrl(url, pageUrl)
    if (!absolute || seen.has(absolute) || records.length >= maxItems) return
    seen.add(absolute)
    const extension = absolute.match(videoPattern)?.[1]?.toLowerCase() || ''
    records.push({
      url: absolute,
      type: extra.type || extension || 'video',
      poster: extra.poster ? absoluteUrl(extra.poster, pageUrl) : '',
      title: trimText(extra.title || title),
      sourceUrl: pageUrl,
    })
  }

  doc.querySelectorAll('video').forEach((video) => {
    pushVideo(video.getAttribute('src'), {
      poster: video.getAttribute('poster'),
      title: video.getAttribute('title'),
    })
    video.querySelectorAll('source[src]').forEach((source) => {
      pushVideo(source.getAttribute('src'), {
        type: source.getAttribute('type') || '',
        poster: video.getAttribute('poster'),
        title: video.getAttribute('title'),
      })
    })
  })

  doc.querySelectorAll('source[src]').forEach((source) => {
    if (videoPattern.test(source.getAttribute('src') || '')) {
      pushVideo(source.getAttribute('src'), { type: source.getAttribute('type') || '' })
    }
  })

  doc.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href') || ''
    if (videoPattern.test(href)) {
      pushVideo(href, { title: trimText(link.textContent) || title })
    }
  })

  const metaVideo =
    doc.querySelector('meta[property="og:video"]')?.getAttribute('content') ||
    doc.querySelector('meta[property="og:video:url"]')?.getAttribute('content') ||
    doc.querySelector('meta[name="twitter:player:stream"]')?.getAttribute('content')
  if (metaVideo) pushVideo(metaVideo)

  if (!records.length) throw new Error('页面中没有找到可采集的视频地址')
  return records
}

export async function collectSinglePage(options = {}) {
  const startedAt = performance.now()
  const pagination = options.pagination || {}
  const mode = ['pageParam', 'nextLink'].includes(pagination.mode)
    ? pagination.mode
    : 'none'
  const maxPages = Math.min(Math.max(Number(pagination.maxPages) || 1, 1), 50)
  const startPage = Math.max(Number(pagination.startPage) || 1, 1)
  const concurrency = Math.min(Math.max(Number(options.concurrency) || 1, 1), 10)

  async function fetchAndExtract(pageUrl, index) {
    const page = await fetchHtmlPage(pageUrl, {
      method: options.method || 'GET',
      headers: options.getHeaders?.(index, pageUrl) || options.headers || {},
      body: options.body,
      timeout: options.timeout,
      siteSessionId: options.siteSessionId || '',
      dynamic: options.dynamic,
    })
    const doc = parseHtmlDocument(page.html)
    let pageRecords
    if (options.responseType === 'web') {
      pageRecords = extractFragmentRecords(doc, options.fragmentRule, page.url, options.maxItems)
    } else if (options.responseType === 'image') {
      pageRecords = extractImageRecords(doc, page.url, { maxItems: options.maxItems })
    } else if (options.responseType === 'video') {
      pageRecords = extractVideoRecords(doc, page.url, { maxItems: options.maxItems })
    } else if (options.responseType === 'link') {
      pageRecords = extractLinkRecords(
        doc,
        options.linkRule,
        page.url,
        options.linkRule?.maxItems || 500,
      )
    } else {
      throw new Error(`不支持的页面采集类型：${options.responseType}`)
    }
    return {
      page,
      doc,
      pageRecords,
      pageInfo: {
        url: page.url,
        status: page.status,
        duration: page.duration,
        count: pageRecords.length,
        html: page.html,
      },
      index,
    }
  }

  const results = []
  if (mode === 'pageParam') {
    const pageUrls = Array.from({ length: maxPages }, (_value, index) => {
      if (index === 0) return options.startUrl
      const url = new URL(options.startUrl)
      url.searchParams.set(pagination.param?.trim() || 'page', String(startPage + index))
      return url.toString()
    })
    const pageResults = new Array(pageUrls.length)
    let cursor = 0
    async function worker() {
      while (cursor < pageUrls.length) {
        const index = cursor
        cursor += 1
        pageResults[index] = await fetchAndExtract(pageUrls[index], index)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, pageUrls.length) }, () => worker()),
    )
    results.push(...pageResults.filter(Boolean))
  } else {
    let currentUrl = options.startUrl
    const visited = new Set()
    for (let index = 0; index < maxPages; index += 1) {
      if (visited.has(currentUrl)) break
      visited.add(currentUrl)
      const result = await fetchAndExtract(currentUrl, index)
      results.push(result)
      if (mode !== 'nextLink') break
      if (!result.pageRecords.length || !pagination.nextSelector?.trim()) break
      let nextNode
      try {
        nextNode = result.doc.querySelector(pagination.nextSelector)
      } catch {
        throw new Error(`下一页选择器无效：${pagination.nextSelector}`)
      }
      const href = nextNode?.getAttribute('href')
      if (!href) break
      currentUrl = new URL(href, result.page.url).href
    }
  }

  let records = results.flatMap((result) => result.pageRecords)
  if (['image', 'video', 'link'].includes(options.responseType)) {
    const seen = new Set()
    records = records.filter((record) => {
      const key = record?.url || JSON.stringify(record)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  if (!records.length) throw new Error('页面解析完成，但没有匹配到任何记录')
  results.forEach((result) => {
    options.onPage?.({
      index: result.index + 1,
      url: result.page.url,
      status: result.page.status,
      duration: result.page.duration,
      count: result.pageRecords.length,
    })
  })
  return {
    records,
    pages: results.map((result) => result.pageInfo),
    pageCount: results.length,
    duration: Math.round(performance.now() - startedAt),
    status: results[0]?.page.status || 200,
    lastUrl: results[results.length - 1]?.page.url || options.startUrl,
  }
}

function getPathValue(value, pathText) {
  if (!pathText) return value
  const segments = String(pathText)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  return segments.reduce(
    (current, key) => (current === null || current === undefined ? undefined : current[key]),
    value,
  )
}

function parseJsonText(text) {
  const clean = String(text || '')
    .replace(/^\uFEFF/, '')
    .trim()
  try {
    return JSON.parse(clean)
  } catch {
    const jsonp = clean.match(/^[\w$.]+\s*\(\s*([\s\S]*?)\s*\)\s*;?$/)
    if (jsonp) return JSON.parse(jsonp[1])
    throw new Error('XHR 响应不是有效 JSON')
  }
}

export async function collectDynamicXhr(options = {}) {
  const startedAt = performance.now()
  const rendered = await renderDynamicPage({
    url: options.startUrl,
    headers: options.headers || {},
    siteSessionId: options.siteSessionId || '',
    mode: 'xhr',
    xhrMatch: options.xhrMatch || '',
    waitMs: options.dynamic?.waitMs,
    timeout: options.timeout,
  })
  const responses = (rendered.xhrs || []).filter(
    (item) => !options.xhrMatch || item.url.includes(options.xhrMatch),
  )
  if (!responses.length) {
    throw new Error(
      `页面没有捕获到匹配的 XHR/Fetch 响应${options.xhrMatch ? `（匹配：${options.xhrMatch}）` : ''}；请确认请求在页面加载后自动发出，或增大渲染等待时间`,
    )
  }
  const records = []
  const pages = []
  for (const item of responses) {
    let payload
    try {
      payload = parseJsonText(item.body)
    } catch {
      continue
    }
    const extracted = getPathValue(payload, options.dataPath)
    if (extracted === undefined) continue
    const batch = Array.isArray(extracted) ? extracted : [extracted]
    records.push(...batch)
    pages.push({
      url: item.url || rendered.finalUrl,
      status: item.status || 200,
      duration: 0,
      count: batch.length,
      html: '',
    })
  }
  if (!records.length) {
    const sample = responses
      .slice(0, 3)
      .map((item) => `${item.url} · HTTP ${item.status}`)
      .join('；')
    throw new Error(
      `捕获到 ${responses.length} 个 XHR 响应，但数据路径“${options.dataPath || '完整响应'}”没有匹配到记录。响应示例：${sample}`,
    )
  }
  return {
    records,
    pages,
    pageCount: pages.length,
    duration: Math.round(performance.now() - startedAt),
    status: pages[0]?.status || 200,
    lastUrl: rendered.finalUrl || options.startUrl,
  }
}

export async function fetchHtmlPage(url, options = {}) {
  if (options.dynamic?.enabled) {
    const startedAt = performance.now()
    const rendered = await renderDynamicPage({
      url,
      headers: options.headers || {},
      siteSessionId: options.siteSessionId || '',
      mode: 'html',
      waitMs: options.dynamic.waitMs,
      timeout: options.timeout,
    })
    return {
      html: rendered.html,
      status: rendered.status || 200,
      duration: Math.round(performance.now() - startedAt),
      url: rendered.finalUrl || url,
    }
  }
  const response = await serverFetch({
    url,
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
    timeout: options.timeout,
    siteSessionId: options.siteSessionId || '',
  })
  if (!response.upstreamOk) {
    throw new Error(
      `页面返回 HTTP ${response.status}${response.text ? ` · ${trimText(response.text).slice(0, 100)}` : ''}`,
    )
  }
  return {
    html: response.text,
    status: response.status,
    duration: response.duration,
    url: response.finalUrl || url,
  }
}

function normalizeCrawlLevels(crawl) {
  return (Array.isArray(crawl?.levels) ? crawl.levels : [])
    .filter((level) => level && level.enabled !== false)
    .map((level, index) => ({
      ...level,
      key: level.key || `level${index + 2}`,
      name: level.name || `第 ${index + 2} 级`,
      linkField: String(level.linkField || '').trim(),
      itemSelector: String(level.itemSelector || '').trim(),
      fields: (level.fields || []).filter(
        (field) => field.enabled !== false && field.key?.trim(),
      ),
      dynamic: level.dynamic || null,
    }))
    .filter((level) => level.fields.length)
}

async function collectDetailLevels({
  records,
  pages,
  crawl,
  options,
  headerIndexStart = 0,
}) {
  const levels = normalizeCrawlLevels(crawl)
  if (!levels.length) return { records, pages, detailPages: 0 }
  const maxItems = Math.min(Math.max(Number(crawl.maxItems) || 100, 1), 2000)
  const concurrency = Math.min(Math.max(Number(crawl.concurrency) || 3, 1), 5)
  const skipErrors = crawl.skipErrors !== false
  const childPrefix = String(crawl.childPrefix || '').trim()
  let currentRecords = records
  let detailPages = 0
  let headerIndex = headerIndexStart

  for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
    const level = levels[levelIndex]
    if (!level.linkField) {
      throw new Error(`${level.name} 缺少链接字段`)
    }
    if (detailPages >= maxItems) break
    const seen = new Set()
    const jobs = []
    const previousPrefix = childPrefix
      ? levelIndex === 0
        ? ''
        : levelIndex === 1
          ? childPrefix
          : `${childPrefix}${levelIndex}_`
      : ''
    for (const parent of currentRecords) {
      const link = String(
        parent?.[level.linkField] ||
          (previousPrefix ? parent?.[`${previousPrefix}${level.linkField}`] : '') ||
          '',
      ).trim()
      if (!link || seen.has(link)) continue
      try {
        const parsed = new URL(link)
        if (!['http:', 'https:'].includes(parsed.protocol)) continue
      } catch {
        continue
      }
      seen.add(link)
      jobs.push({ parent, link })
      if (jobs.length >= maxItems - detailPages) break
    }
    if (!jobs.length) break

    const results = new Array(jobs.length)
    let cursor = 0
    async function worker() {
      while (cursor < jobs.length) {
        const index = cursor
        cursor += 1
        const job = jobs[index]
        const pageIndex = headerIndex + index
        try {
          const page = await fetchHtmlPage(job.link, {
            method: 'GET',
            headers: options.getHeaders?.(pageIndex, job.link) || options.headers || {},
            timeout: options.timeout,
            siteSessionId: options.siteSessionId || '',
            dynamic: level.dynamic,
          })
          const doc = parseHtmlDocument(page.html)
          const childRecords = extractRecordsFromDocument(doc, level, page.url, {
            allowEmpty: true,
          })
          results[index] = { ...job, page, childRecords }
        } catch (error) {
          if (!skipErrors) throw error
          results[index] = { ...job, error, childRecords: [], page: null }
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()),
    )
    headerIndex += jobs.length

    const nextRecords = []
    for (const result of results) {
      detailPages += 1
      if (result.error || !result.page) continue
      pages.push({
        url: result.page.url,
        status: result.page.status,
        duration: result.page.duration,
        count: result.childRecords.length,
        html: result.page.html,
        depth: levelIndex + 2,
      })
      for (const child of result.childRecords) {
        const merged = { ...result.parent }
        const levelPrefix = childPrefix
          ? levelIndex === 0
            ? childPrefix
            : `${childPrefix}${levelIndex + 1}_`
          : ''
        for (const [key, value] of Object.entries(child)) {
          merged[levelPrefix ? `${levelPrefix}${key}` : key] = value
        }
        merged._depth = levelIndex + 2
        merged._parentUrl =
          result.parent._sourceUrl ||
          result.parent._detailUrl ||
          options.startUrl ||
          ''
        merged._detailUrl = result.page.url
        nextRecords.push(merged)
      }
    }
    currentRecords = nextRecords
    if (!currentRecords.length) break
  }
  return { records: currentRecords, pages, detailPages }
}

export async function collectHtmlPages(options = {}) {
  const pageRule = options.pageRule
  const startUrl = options.startUrl
  if (!pageRule?.itemSelector?.trim()) throw new Error('站点页面规则缺少条目选择器')
  if (!(pageRule.fields || []).some((field) => field.enabled !== false && field.key?.trim())) {
    throw new Error('站点页面规则缺少可用的字段映射')
  }

  const pagination = pageRule.pagination || {}
  const mode = pagination.mode || 'none'
  const maxPages = Math.min(Math.max(Number(pagination.maxPages) || 1, 1), 10)
  const startPage = Math.max(Number(pagination.startPage) || 1, 1)
  const concurrency = Math.min(
    Math.max(Number(options.concurrency) || 1, 1),
    10,
  )
  const startedAt = performance.now()
  const records = []
  const pages = []

  async function fetchPage(pageUrl, index) {
    const page = await fetchHtmlPage(pageUrl, {
      method: options.method || 'GET',
      headers: options.getHeaders?.(index, pageUrl) || options.headers || {},
      body: options.body,
      timeout: options.timeout,
      siteSessionId: options.siteSessionId || '',
    })
    const doc = parseHtmlDocument(page.html)
    const pageRecords = extractRecordsFromDocument(doc, pageRule, page.url)
    const pageInfo = {
      url: page.url,
      status: page.status,
      duration: page.duration,
      count: pageRecords.length,
      html: page.html,
    }
    return { page, pageRecords, pageInfo, index }
  }

  if (mode === 'pageParam') {
    const pageUrls = Array.from({ length: maxPages }, (_value, index) => {
      if (index === 0) return startUrl
      const url = new URL(startUrl)
      url.searchParams.set(pagination.param?.trim() || 'page', String(startPage + index))
      return url.toString()
    })
    const results = new Array(pageUrls.length)
    let cursor = 0
    async function worker() {
      while (cursor < pageUrls.length) {
        const index = cursor
        cursor += 1
        results[index] = await fetchPage(pageUrls[index], index)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, pageUrls.length) }, () => worker()),
    )
    results.forEach((result) => {
      if (!result) return
      records.push(...result.pageRecords)
      pages.push(result.pageInfo)
      options.onPage?.({
        index: result.index + 1,
        url: result.page.url,
        status: result.page.status,
        duration: result.page.duration,
        count: result.pageRecords.length,
      })
    })
  } else {
    const visited = new Set()
    let currentUrl = startUrl
    for (let index = 0; index < maxPages; index += 1) {
      const pageUrl = currentUrl
      if (visited.has(pageUrl)) break
      visited.add(pageUrl)
      const result = await fetchPage(pageUrl, index)
      records.push(...result.pageRecords)
      pages.push(result.pageInfo)
      options.onPage?.({
        index: index + 1,
        url: result.page.url,
        status: result.page.status,
        duration: result.page.duration,
        count: result.pageRecords.length,
      })

      if (mode === 'none' || !result.pageRecords.length) break
      if (mode === 'nextLink') {
        if (!pagination.nextSelector?.trim()) break
        let nextNode
        try {
          nextNode = result.page.html
            ? parseHtmlDocument(result.page.html).querySelector(pagination.nextSelector)
            : null
        } catch {
          throw new Error(`下一页选择器无效：${pagination.nextSelector}`)
        }
        const href = nextNode?.getAttribute('href')
        if (!href) break
        currentUrl = new URL(href, result.page.url).href
      }
    }
  }

  if (!records.length) throw new Error('页面解析完成，但没有匹配到任何记录，请检查选择器')
  let finalRecords = records
  if (pageRule.crawl?.enabled) {
    const detailResult = await collectDetailLevels({
      records,
      pages,
      crawl: pageRule.crawl,
      options,
      headerIndexStart: pages.length,
    })
    finalRecords = detailResult.records
  }
  if (!finalRecords.length) {
    throw new Error('多级采集完成，但没有获取到详情页记录，请检查链接字段与详情页选择器')
  }
  return {
    records: finalRecords,
    pages,
    pageCount: pages.length,
    duration: Math.round(performance.now() - startedAt),
    status: pages[0]?.status || 200,
    lastUrl: pages[pages.length - 1]?.url || startUrl,
  }
}
