// 배도라지RPG 치지직 Open API 프록시 (Cloudflare Workers) — 2026-09-23, 먹방 룰렛 proxy/worker.js 를 옮겨 왔다.
//
// openapi.chzzk.naver.com 은 브라우저에서 직접 부를 수 없다(CORS 차단). 이 워커가 요청을 그대로 넘기고 CORS 헤더만 붙인다.
// 토큰 교환(/auth/v1/token)에는 워커의 환경 변수에 둔 Client ID · Secret 을 채워 넣는다 — Secret 은 게임 코드 · 저장소에 없다.
//
// 배포 (proxy 폴더에서):
//   npx wrangler login                                                      # 처음 한 번 (브라우저에서 Cloudflare 로그인)
//   npx wrangler deploy                                                     # 워커 올리기 → https://bedorage-proxy.<계정>.workers.dev
//   npx wrangler secret put CHZZK_CLIENT_ID                                 # 물으면 Client ID 를 붙여 넣고 Enter
//   npx wrangler secret put CHZZK_CLIENT_SECRET                             # 물으면 Client Secret 을 붙여 넣고 Enter (셸 기록에 남지 않는다)
// 값을 파이프로 넣을 때는 PowerShell 을 쓰지 말 것 — 끝에 개행이 붙어 INVALID_CLIENT 가 난다(먹방 룰렛에서 겪음).

const UPSTREAM = 'https://openapi.chzzk.naver.com'
// 이 프록시를 쓸 수 있는 사이트 — 배포된 게임과 로컬 개발 서버만
const ALLOWED_ORIGINS = ['https://goormigrm.github.io', 'http://localhost:5173']
const ALLOWED_PATHS = /^\/(auth\/v1\/|open\/v1\/)/

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : 'null'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') || ''

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }
    if (!ALLOWED_PATHS.test(url.pathname)) {
      return new Response('Forbidden path', { status: 403, headers: corsHeaders(origin) })
    }

    let body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text()

    // 토큰 교환: 워커에 저장된 Client ID · Secret 을 채워 넣는다 (게임 쪽에 Secret 이 없게)
    if (url.pathname === '/auth/v1/token' && request.method === 'POST') {
      let parsed = {}
      try {
        parsed = JSON.parse(body || '{}')
      } catch {
        parsed = {}
      }
      if (env && env.CHZZK_CLIENT_ID) parsed.clientId = env.CHZZK_CLIENT_ID
      if (env && env.CHZZK_CLIENT_SECRET) parsed.clientSecret = env.CHZZK_CLIENT_SECRET
      body = JSON.stringify(parsed)
    }

    const upstream = await fetch(
      new Request(UPSTREAM + url.pathname + url.search, {
        method: request.method,
        headers: {
          'Content-Type': request.headers.get('Content-Type') || 'application/json',
          Authorization: request.headers.get('Authorization') || '',
        },
        body,
      }),
    )
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', ...corsHeaders(origin) },
    })
  },
}
