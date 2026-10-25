import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

function caifengApiPlugin() {
  return {
    name: 'caifeng-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          next()
          return
        }
        import('./server/api-router.mjs')
          .then(({ handleApiRequest }) => handleApiRequest(req, res))
          .catch((error) => {
            if (!res.headersSent) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
            }
            res.end(
              JSON.stringify({
                ok: false,
                error: error?.message || '服务端内部错误',
              }),
            )
          })
      })
    },
  }
}

export default defineConfig({
  plugins: [caifengApiPlugin(), vue()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
})
