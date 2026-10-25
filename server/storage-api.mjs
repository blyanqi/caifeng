import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const storageRoot = path.join(rootDir, 'data')
const MAX_CONTENT_BYTES = 30 * 1024 * 1024
const MAX_MEDIA_ITEMS = 50
const MAX_HTML_PAGES = 100
const FOLDER_TYPES = new Set(['image_folder', 'video_folder', 'html_folder'])
const FILE_TYPES = new Set(['json', 'csv', 'html'])
const PREVIEW_BYTES = 200 * 1024
const MEDIA_MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogg',
  'video/quicktime': 'mov',
  'application/vnd.apple.mpegurl': 'm3u8',
}

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
      if (size > MAX_CONTENT_BYTES) {
        reject(new Error('写入内容超过 30MB 上限'))
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

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function resolveStorageFile(target, type) {
  const raw = String(target || '').trim().replace(/\\/g, '/')
  if (!raw) throw new Error('缺少存储位置')
  if (path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
    throw new Error('存储位置必须使用项目内的相对路径')
  }
  if (!raw.startsWith('data/')) {
    throw new Error('存储位置需位于 data/ 目录下')
  }
  const relative = raw.slice('data/'.length)
  if (!relative || relative.split('/').includes('..')) {
    throw new Error('存储位置不合法')
  }
  const fullPath = path.resolve(storageRoot, relative)
  if (fullPath === storageRoot || !fullPath.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error('存储位置超出 data/ 目录')
  }
  if (type === 'json' && !/\.json$/i.test(fullPath)) {
    throw new Error('JSON 存储位置必须以 .json 结尾')
  }
  if (type === 'csv' && !/\.csv$/i.test(fullPath)) {
    throw new Error('CSV 存储位置必须以 .csv 结尾')
  }
  if (type === 'html' && !/\.html?$/i.test(fullPath)) {
    throw new Error('HTML 存储位置必须以 .html 结尾')
  }
  return fullPath
}

function resolveStorageFolder(target) {
  const raw = String(target || '').trim().replace(/\\/g, '/')
  if (!raw) throw new Error('缺少存储文件夹位置')
  if (path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
    throw new Error('存储位置必须使用项目内的相对路径')
  }
  if (!raw.startsWith('data/')) {
    throw new Error('存储位置需位于 data/ 目录下')
  }
  const relative = raw.slice('data/'.length)
  if (!relative || relative.split('/').includes('..')) {
    throw new Error('存储位置不合法')
  }
  const fullPath = path.resolve(storageRoot, relative)
  if (fullPath === storageRoot || !fullPath.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error('存储位置超出 data/ 目录')
  }
  return fullPath
}

function safeFileBase(url, kind, contentType = '') {
  let base = ''
  try {
    const pathname = new URL(url).pathname
    base = path.basename(decodeURIComponent(pathname))
  } catch {
    base = ''
  }
  base = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/^\.+/, '').slice(0, 80)
  let extension = path.extname(base).slice(1).toLowerCase()
  if (!extension) {
    extension = MEDIA_MIME_EXT[contentType.split(';')[0].trim()] || (kind === 'video' ? 'mp4' : 'jpg')
    base = `${base || kind}.${extension}`
  }
  if (!base) base = `${kind}.${extension}`
  const hash = createHash('sha1').update(String(url)).digest('hex').slice(0, 8)
  return `${hash}-${base}`
}

async function readBinaryLimited(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

async function downloadMediaItem(item, kind, folder) {
  const sourceUrl = String(item.sourceUrl || '')
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: '*/*',
  }
  if (sourceUrl) headers.Referer = sourceUrl
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(item.url, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    const maxBytes = kind === 'video' ? 120 * 1024 * 1024 : 30 * 1024 * 1024
    const buffer = await readBinaryLimited(response, maxBytes)
    const filename = safeFileBase(item.url, kind, contentType)
    const filePath = path.join(folder, filename)
    await writeFile(filePath, buffer)
    return {
      url: item.url,
      file: filePath,
      relativePath: path.relative(rootDir, filePath).replace(/\\/g, '/'),
      bytes: buffer.length,
      contentType,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function writeMediaFiles(payload) {
  const kind = String(payload.kind || '').toLowerCase()
  if (!['image', 'video'].includes(kind)) {
    throw new Error('媒体类型必须是 image 或 video')
  }
  const folder = resolveStorageFolder(payload.target)
  await mkdir(folder, { recursive: true })
  const items = (Array.isArray(payload.items) ? payload.items : [])
    .filter((item) => item?.url && /^https?:\/\//i.test(item.url))
    .slice(0, MAX_MEDIA_ITEMS)
  const files = []
  const errors = []
  const concurrency = Math.min(Math.max(Number(payload.concurrency) || 1, 1), 10)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      const item = items[index]
      try {
        files.push(await downloadMediaItem(item, kind, folder))
      } catch (error) {
        if (error.name === 'AbortError') {
          errors.push({ url: item.url, error: '下载超时' })
        } else {
          errors.push({ url: item.url, error: error?.message || '下载失败' })
        }
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(items.length, 1)) },
      () => worker(),
    ),
  )
  const manifestPath = path.join(folder, '_manifest.json')
  const manifest = {
    kind,
    updatedAt: new Date().toISOString(),
    total: files.length,
    files,
    errors,
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  return {
    folder,
    manifest: manifestPath,
    files,
    errors,
    limited: (Array.isArray(payload.items) ? payload.items.length : 0) > MAX_MEDIA_ITEMS,
  }
}

async function writeHtmlFiles(payload) {
  const folder = resolveStorageFolder(payload.target)
  await mkdir(folder, { recursive: true })
  const pages = (Array.isArray(payload.pages) ? payload.pages : [])
    .filter((page) => page?.html)
    .slice(0, MAX_HTML_PAGES)
  const files = []
  for (const page of pages) {
    if (Buffer.byteLength(page.html) > 8 * 1024 * 1024) continue
    const hash = createHash('sha1').update(String(page.url || page.html)).digest('hex').slice(0, 10)
    const filePath = path.join(folder, `page-${hash}.html`)
    await writeFile(filePath, page.html, 'utf8')
    files.push({
      url: page.url || '',
      file: filePath,
      relativePath: path.relative(rootDir, filePath).replace(/\\/g, '/'),
      bytes: Buffer.byteLength(page.html),
    })
  }
  const manifestPath = path.join(folder, '_manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify(
      { kind: 'html', updatedAt: new Date().toISOString(), total: files.length, files },
      null,
      2,
    ),
    'utf8',
  )
  return { folder, manifest: manifestPath, files }
}

async function writeStorageFile(payload) {
  const type = String(payload.type || '').toLowerCase()
  if (!FILE_TYPES.has(type)) {
    throw new Error('数据库类型不支持本地文件写入')
  }
  if (typeof payload.content !== 'string') {
    throw new Error('缺少文件内容')
  }
  if (Buffer.byteLength(payload.content) > MAX_CONTENT_BYTES) {
    throw new Error('文件内容超过 30MB 上限')
  }
  const filePath = resolveStorageFile(payload.target, type)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, payload.content, 'utf8')
  const info = await stat(filePath)
  return {
    path: filePath,
    folder: path.dirname(filePath),
    bytes: info.size,
    updatedAt: info.mtime.toISOString(),
  }
}

async function sendDownload(req, res, url) {
  const target = url.searchParams.get('target') || ''
  const type = (url.searchParams.get('type') || '').toLowerCase()
  if (!FILE_TYPES.has(type)) {
    sendJson(res, 400, { ok: false, error: '该存储类型不支持文件下载' })
    return
  }
  const filePath = resolveStorageFile(target, type)
  let info
  try {
    info = await stat(filePath)
  } catch {
    sendJson(res, 404, { ok: false, error: '文件尚未生成，请先运行一次关联任务' })
    return
  }
  if (!info.isFile()) {
    sendJson(res, 404, { ok: false, error: '存储路径不是文件' })
    return
  }
  const data = await readFile(filePath)
  const filename = path.basename(filePath)
  res.statusCode = 200
  res.setHeader(
    'Content-Type',
    type === 'csv'
      ? 'text/csv; charset=utf-8'
      : type === 'html'
        ? 'text/html; charset=utf-8'
        : 'application/json; charset=utf-8',
  )
  res.setHeader('Content-Length', data.length)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  )
  res.end(data)
}

async function previewStorageFile(payload) {
  const type = String(payload.type || '').toLowerCase()
  if (!FILE_TYPES.has(type)) {
    throw new Error('该存储类型没有可预览的文件')
  }
  const filePath = resolveStorageFile(payload.target, type)
  let info
  try {
    info = await stat(filePath)
  } catch {
    throw new Error('文件尚未生成，请先运行一次关联任务')
  }
  if (!info.isFile()) throw new Error('存储路径不是文件')
  const data = await readFile(filePath)
  const content = data.subarray(0, PREVIEW_BYTES).toString('utf8')
  return {
    path: filePath,
    bytes: info.size,
    updatedAt: info.mtime.toISOString(),
    truncated: data.length > PREVIEW_BYTES,
    content,
    mimeType:
      type === 'csv'
        ? 'text/csv'
        : type === 'html'
          ? 'text/html'
          : 'application/json',
  }
}

async function openStorageFolder(payload) {
  const type = String(payload.type || '').toLowerCase()
  let folder
  if (FOLDER_TYPES.has(type)) {
    folder = resolveStorageFolder(payload.target)
  } else if (FILE_TYPES.has(type)) {
    folder = path.dirname(resolveStorageFile(payload.target, type))
  } else {
    throw new Error('数据库类型没有本地文件夹')
  }
  await mkdir(folder, { recursive: true })

  const command =
    process.platform === 'win32'
      ? 'explorer.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open'
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, [folder], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })
  } catch {
    throw new Error('无法打开系统文件管理器')
  }
  return { folder }
}

function actionFromUrl(req) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname
  return pathname.split('/').filter(Boolean).pop() || ''
}

export async function handleStorageApi(req, res) {
  if (!sameOrigin(req)) {
    sendJson(res, 403, { ok: false, error: '仅允许同源页面调用存储服务' })
    return
  }
  const action = actionFromUrl(req)
  try {
    if (action === 'write') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: '写入接口只接受 POST 请求' })
        return
      }
      const payload = await readJsonBody(req)
      const result = await writeStorageFile(payload)
      sendJson(res, 200, { ok: true, ...result })
      return
    }

    if (action === 'write-media' || action === 'write-html') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: '写入接口只接受 POST 请求' })
        return
      }
      const payload = await readJsonBody(req)
      const result =
        action === 'write-media'
          ? await writeMediaFiles(payload)
          : await writeHtmlFiles(payload)
      sendJson(res, 200, { ok: true, ...result })
      return
    }

    if (action === 'preview') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: '预览接口只接受 POST 请求' })
        return
      }
      const payload = await readJsonBody(req)
      const result = await previewStorageFile(payload)
      sendJson(res, 200, { ok: true, ...result })
      return
    }

    if (action === 'download') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: '下载接口只接受 GET 请求' })
        return
      }
      await sendDownload(req, res, new URL(req.url || '/', 'http://localhost'))
      return
    }

    if (action === 'open-folder') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: '打开文件夹只接受 POST 请求' })
        return
      }
      const payload = await readJsonBody(req)
      const result = await openStorageFolder(payload)
      sendJson(res, 200, { ok: true, ...result })
      return
    }

    sendJson(res, 404, { ok: false, error: '未知的存储操作' })
  } catch (error) {
    sendJson(res, error?.statusCode || 400, {
      ok: false,
      error: error?.message || '存储操作失败',
    })
  }
}
