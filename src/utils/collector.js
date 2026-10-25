import { taskRelations } from '../stores/collector'
import { collectDynamicXhr, collectHtmlPages, collectSinglePage } from './pageCollector'
import { resolveHeader, headersOf } from './headerRotation'
import { resolveParamRows } from './params'
import { normalizeExecution } from './schedule'
import { serverFetch } from './serverFetch'
import { resolveRiskProfile } from './risk'
import { parseJsonpPayload } from './jsonp'

export function resolveEndpoint(baseUrl, path = '') {
  const raw = String(baseUrl || '').trim()
  if (!raw) throw new Error('采集站点缺少基础地址')
  let base
  if (/^https?:\/\//i.test(raw)) {
    base = raw.endsWith('/') ? raw : `${raw}/`
  } else {
    const relative = raw.startsWith('/') ? raw : `/${raw}`
    base = new URL(relative.endsWith('/') ? relative : `${relative}/`, window.location.origin).href
  }
  const cleanPath = String(path || '').replace(/^\/+/, '')
  try {
    return new URL(cleanPath, base).href
  } catch {
    throw new Error('无法拼接请求地址，请检查站点地址与请求路径')
  }
}

export function extractByPath(payload, dataPath = '') {
  const path = String(dataPath || '').trim()
  if (!path) return payload
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
  let current = payload
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    current = current[segment]
  }
  return current
}

export function normalizeRecords(value) {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value
  return [value]
}

function parseJsonPayload(text) {
  const clean = String(text || '')
    .replace(/^\uFEFF/, '')
    .trim()
  try {
    return JSON.parse(clean)
  } catch (jsonError) {
    const jsonpMatch = clean.match(/^[\w$.]+\s*\(\s*([\s\S]*?)\s*\)\s*;?$/)
    if (jsonpMatch) {
      try {
        return JSON.parse(jsonpMatch[1])
      } catch {
        // fall through to the normal JSON error
      }
    }
    throw new Error('响应不是有效的 JSON / JSONP，请检查采集配置中的响应类型')
  }
}

function resolveRequest(task, options = {}) {
  const relations = taskRelations(task)
  const { site, config, header, param } = relations
  if (!site) throw new Error('关联的采集站点不存在，请重新选择')
  if (!config) throw new Error('关联的采集配置不存在，请重新选择')
  if (site.enabled === false) throw new Error('采集站点已停用，请先在站点管理中启用')
  if (!relations.storage) throw new Error('关联的存储不存在，请重新选择')

  const endpoint = resolveEndpoint(site.baseUrl, config.path)
  const url = new URL(endpoint)
  const queryRows = resolveParamRows(param, {
    now: options.now || new Date(),
    iterationRowId: options.iteration?.rowId,
    iterationIndex: options.iteration?.index,
  })
  queryRows.forEach((row) => {
    url.searchParams.set(row.key, row.value ?? '')
  })

  const selectedHeader = resolveHeader(config, header)
  const activeHeader = selectedHeader.header
  const requestHeaders = headersOf(activeHeader)

  return {
    relations,
    site,
    config,
    header,
    param,
    storage: relations.storage,
    method: (config.method || 'GET').toUpperCase(),
    url: url.toString(),
    queryRows,
    requestHeaders,
    activeHeader,
    headerRotated: selectedHeader.rotated,
    rotation: selectedHeader.rotation,
  }
}

export async function collectTask(task, options = {}) {
  const resolved = resolveRequest(task, options)
  const {
    method,
    url,
    config,
    storage,
    site,
    activeHeader,
    headerRotated,
  } = resolved
  let requestHeaders = { ...resolved.requestHeaders }
  let riskCookie = ''
  if (task.riskProfileId) {
    const risk = await resolveRiskProfile(task.riskProfileId, url, task.id)
    riskCookie = risk?.cookieHeader || ''
    if (riskCookie) {
      requestHeaders.Cookie = [requestHeaders.Cookie, riskCookie]
        .filter(Boolean)
        .join('; ')
    }
  }
  const withRiskCookie = (headers) => {
    if (!riskCookie) return headers
    return {
      ...headers,
      Cookie: [headers?.Cookie, riskCookie].filter(Boolean).join('; '),
    }
  }
  const execution = normalizeExecution(config)
  let initialHeaderUsed = false
  const getHeaders = () => {
    if (!headerRotated) return requestHeaders
    if (!initialHeaderUsed) {
      initialHeaderUsed = true
      return requestHeaders
    }
    const next = resolveHeader(config, activeHeader)
    return withRiskCookie(headersOf(next.header))
  }

  if (config.responseType === 'html') {
    if (!site.pageRule?.enabled) {
      throw new Error(
        '该配置使用 HTML 页面解析，请先在采集站点中配置并启用页面规则；也可以将配置类型改为「图片」「视频」或「网页片段」采集',
      )
    }
    const pageResult = await collectHtmlPages({
      startUrl: url,
      headers: requestHeaders,
      getHeaders,
      method,
      body: ['GET', 'HEAD'].includes(method) ? undefined : config.body || undefined,
      pageRule: site.pageRule,
      timeout: options.timeout,
      concurrency: execution.concurrency,
      siteSessionId: task.siteSessionId || '',
      onPage: options.onPage,
    })
    return {
      records: pageResult.records,
      payload: null,
      extracted: null,
      duration: pageResult.duration,
      status: pageResult.status,
      pageCount: pageResult.pageCount,
      pages: pageResult.pages,
      url,
      method,
      storage,
      site,
      config,
      requestHeaders,
      queryRows: resolved.queryRows,
    }
  }

  if (['web', 'image', 'video', 'link'].includes(config.responseType)) {
    if (
      config.responseType === 'web' &&
      !(config.fragmentRule?.fields || []).some(
        (field) => field.enabled !== false && field.key?.trim(),
      )
    ) {
      throw new Error('网页片段采集尚未配置字段，请编辑采集配置添加 CSS 片段映射')
    }
    const pageResult = await collectSinglePage({
      startUrl: url,
      headers: requestHeaders,
      getHeaders,
      method,
      body: ['GET', 'HEAD'].includes(method) ? undefined : config.body || undefined,
      responseType: config.responseType,
      fragmentRule: config.fragmentRule,
      linkRule: config.linkRule,
      maxItems: config.media?.maxItems,
      pagination: config.pagination,
      dynamic: config.dynamic,
      concurrency: config.dynamic?.enabled ? 1 : execution.concurrency,
      timeout: options.timeout,
      siteSessionId: task.siteSessionId || '',
      onPage: options.onPage,
    })
    return {
      records: pageResult.records,
      payload: null,
      extracted: null,
      duration: pageResult.duration,
      status: pageResult.status,
      pageCount: pageResult.pageCount,
      pages: pageResult.pages,
      url: pageResult.lastUrl || url,
      method,
      storage,
      site,
      config,
      requestHeaders,
      queryRows: resolved.queryRows,
    }
  }

  if (config.responseType === 'xhr' && config.dynamic?.enabled) {
    const xhrResult = await collectDynamicXhr({
      startUrl: url,
      headers: requestHeaders,
      dataPath: config.dataPath,
      xhrMatch: config.dynamic.xhrMatch || '',
      dynamic: config.dynamic,
      timeout: options.timeout,
      siteSessionId: task.siteSessionId || '',
      onPage: options.onPage,
    })
    return {
      records: xhrResult.records,
      payload: null,
      extracted: null,
      duration: xhrResult.duration,
      status: xhrResult.status,
      pageCount: xhrResult.pageCount,
      pages: xhrResult.pages,
      url: xhrResult.lastUrl || url,
      method,
      storage,
      site,
      config,
      requestHeaders,
      queryRows: resolved.queryRows,
    }
  }

  const fetchHeaders =
    config.responseType === 'xhr'
      ? {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          ...requestHeaders,
        }
      : requestHeaders
  const response = await serverFetch({
    url,
    method,
    headers: fetchHeaders,
    body: ['GET', 'HEAD'].includes(method) ? undefined : config.body || undefined,
    timeout: options.timeout,
    siteSessionId: task.siteSessionId || '',
  })

  if (!response.upstreamOk) {
    throw new Error(
      `接口返回 HTTP ${response.status}${response.text ? ` · ${response.text.slice(0, 120)}` : ''}`,
    )
  }

  let payload = response.text
  if (config.responseType !== 'text') {
    if (config.responseType === 'jsonp') {
      payload = parseJsonpPayload(response.text)
      if (payload === null) {
        throw new Error(
          `JSONP 响应解析失败；响应预览：${String(response.text || '').slice(0, 180)}`,
        )
      }
    } else {
      try {
        payload = parseJsonPayload(response.text)
      } catch (error) {
        if (config.responseType === 'xhr') {
          const jsonp = parseJsonpPayload(response.text)
          if (jsonp !== null) {
            payload = jsonp
          } else {
            throw new Error(
              `${error.message}；响应预览：${String(response.text || '').slice(0, 180)}`,
            )
          }
        } else {
          throw error
        }
      }
    }
  }

  const extracted = extractByPath(payload, config.dataPath)
  if (extracted === undefined) {
    const preview =
      config.responseType === 'xhr'
        ? `；响应预览：${String(response.text || '').slice(0, 180)}`
        : ''
    throw new Error(
      config.dataPath
        ? `数据路径 “${config.dataPath}” 未匹配到任何数据${preview}`
        : `响应中没有可用的采集数据${preview}`,
    )
  }
  const records = normalizeRecords(extracted)
  if (!records.length) throw new Error('本次响应返回 0 条数据')

  return {
    records,
    payload,
    extracted,
    duration: response.duration,
    status: response.status,
    url: response.finalUrl || url,
    method,
    storage,
    site: resolved.site,
    config: resolved.config,
    requestHeaders,
    queryRows: resolved.queryRows,
  }
}
