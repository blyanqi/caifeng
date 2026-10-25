import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleApiRequest } from './api-router.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(rootDir, 'dist')
const port = Number(process.env.PORT) || 8787
const host = process.env.HOST || '127.0.0.1'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

async function serveFile(res, filePath, method) {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error('not-file')
  const data = await readFile(filePath)
  const ext = path.extname(filePath).toLowerCase()
  res.statusCode = 200
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')
  res.setHeader('Content-Length', data.length)
  res.setHeader(
    'Cache-Control',
    /\/assets\//.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache',
  )
  if (method === 'HEAD') {
    res.end()
    return
  }
  res.end(data)
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (requestUrl.pathname === '/api/health' || requestUrl.pathname.startsWith('/api/')) {
    await handleApiRequest(req, res)
    return
  }
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(requestUrl.pathname)
  } catch {
    res.statusCode = 400
    res.end('Bad Request')
    return
  }

  const relative = pathname.replace(/^\/+/, '') || 'index.html'
  let filePath = path.resolve(distDir, relative)

  if (filePath !== distDir && !filePath.startsWith(`${distDir}${path.sep}`)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  try {
    if (pathname === '/' || pathname.endsWith('/')) {
      filePath = path.join(distDir, 'index.html')
    }
    await serveFile(res, filePath, req.method || 'GET')
  } catch {
    if (!path.extname(pathname)) {
      try {
        await serveFile(res, path.join(distDir, 'index.html'), req.method || 'GET')
        return
      } catch {
        // fall through to 404
      }
    }
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Not Found')
  }
})

server.listen(port, host, () => {
  console.log(
    `\n  采风 Collect Studio\n  ➜  http://${host}:${port}/\n  ➜  backend: /api/*\n  ➜  external API: /api/v1/*\n`,
  )
})
