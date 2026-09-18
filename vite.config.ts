import { defineConfig, Plugin } from 'vite'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * 개발 서버 전용 스크린샷 저장 엔드포인트.
 * 페이지에서 캔버스를 합쳐 POST /__shot {name, data} 하면 docs/img/<name>.png 로 떨어진다.
 * {dir: 'frames'} 를 붙이면 .frames/<name>.png 로 떨어진다 — GIF 재료(tools/gif.py 가 모아 붙인다, git 에는 안 올린다).
 * 빌드 결과물에는 포함되지 않는다(apply: 'serve').
 */
function shotEndpoint(): Plugin {
  return {
    name: 'bd-shot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (c) => chunks.push(c as Buffer))
        req.on('end', () => {
          try {
            const { name, data, dir: which } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              name: string
              data: string
              dir?: 'frames'
            }
            // 프레임은 한 단계 하위 폴더(장면 이름)까지 허용한다: frames/scope/000
            const safe = name.replace(which === 'frames' ? /[^a-z0-9_\/-]/gi : /[^a-z0-9_-]/gi, '').replace(/\.\./g, '')
            const dir = root + (which === 'frames' ? '.frames' : 'docs/img')
            mkdirSync(dir + '/' + safe.split('/').slice(0, -1).join('/'), { recursive: true })
            const buf = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')
            const ext = data.startsWith('data:image/jpeg') ? 'jpg' : 'png'
            writeFileSync(`${dir}/${safe}.${ext}`, buf)
            res.end(`${safe}.${ext} ${buf.length}`)
          } catch (e) {
            res.statusCode = 500
            res.end(String(e))
          }
        })
      })
    },
  }
}

export default defineConfig({
  base: '/bedorage-rpg/',
  plugins: [shotEndpoint()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: { main: root + 'index.html' },
    },
  },
  server: {
    port: 5173,
    // GIF 프레임(.frames/)이 수십 장씩 떨어질 때 감시기가 페이지를 새로고침해 녹화 중인 판이 날아갔다 → 감시에서 뺀다
    watch: { ignored: ['**/.frames/**', '**/docs/img/**'] },
  },
})
