// 치지직 공식 Open API 연동 (2026-09-23 — 먹방 룰렛 src/chzzk.ts 를 옮겨 왔다):
// OAuth 로그인 → 세션(Socket.IO) → 채팅(CHAT) · 후원(DONATION) 이벤트 구독 → game/stream.ts 허브로 넘긴다.
// openapi.chzzk.naver.com 은 브라우저 CORS 를 막으므로 REST 는 프록시(Cloudflare Worker)를 거친다. 웹소켓은 직접.
// Client Secret 은 프록시 워커의 환경 변수에만 있다 — 여기(공개 저장소)에는 없다.
// 치지직 세션 서버는 Socket.IO 클라이언트 2.0.3 까지만 받는다 → socket.io-client 2.5.0 으로 고정.

import type { ChzzkSocket } from 'socket.io-client'
import { stream } from '../game/stream'

/**
 * 치지직 개발자센터 앱 "배도라지RPG"(bedorage-rpg) · 전용 프록시 워커(저장소 proxy/) — 공개되어도 되는 값.
 * 앱 스코프: 채팅 메시지 조회 · 후원 조회 · 유저 조회. 로그인 리디렉션 URL = https://goormigrm.github.io/bedorage-rpg/ (아래 redirectUri()).
 */
export const CHZZK_CLIENT_ID = 'bfdcb9ed-15d7-4405-ba0b-d93c1b8d0abf'
export const CHZZK_PROXY = 'https://bedorage-proxy.1117tkdrms.workers.dev'

const LS_TOKEN = 'brpg.chzzk.token'
const LS_STATE = 'brpg.chzzk.state'
/** 작은 창 로그인의 확인 값 — 돌아온 창이 이것과 같으면 작은 창이다 (entry.ts) */
const LS_POPUP = 'brpg.chzzk.popup'
/** 작은 창이 돌아온 code 를 원래 창에 넘기는 통로 (entry.ts 와 같은 이름) */
const CZ_CHANNEL = 'brpg-chzzk'

interface TokenSet {
  accessToken: string
  refreshToken: string
}

let socket: ChzzkSocket | null = null
let ioP: Promise<(typeof import('socket.io-client'))['default']> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 5000
let manualOff = true
let connectGen = 0
/** 이번 세션에서 구독에 성공한 것 · 실패한 것(앱 권한 부족 등 — 상태 줄에 남긴다) */
const subscribed = new Set<string>()
let subFail = ''
/** 치지직 이벤트에는 고유 ID 가 없다 — 네트워크 중복 전달만 거른다(같은 사람 · 금액 · 글이 1초 안에 두 번) */
const DEDUPE_MS = 1000
const recent = new Map<string, number>()

class AuthExpiredError extends Error {
  constructor() {
    super('로그인이 만료되었습니다 — [치지직 로그인]을 다시 눌러 주세요')
    this.name = 'AuthExpiredError'
  }
}

function tokens(): TokenSet | null {
  try {
    return JSON.parse(localStorage.getItem(LS_TOKEN) ?? 'null') as TokenSet | null
  } catch {
    return null
  }
}

function saveTokens(t: TokenSet | null): void {
  try {
    if (t) localStorage.setItem(LS_TOKEN, JSON.stringify(t))
    else localStorage.removeItem(LS_TOKEN)
  } catch {
    /* 저장소 없음 */
  }
}

export function hasToken(): boolean {
  return tokens() !== null
}

/** 개발자센터에 등록해야 하는 로그인 리디렉션 URL */
export function redirectUri(): string {
  return location.origin + location.pathname
}

/** 이 창이 연 로그인의 확인 값 (작은 창이 넘긴 code 가 이 창 것일 때만 받는다 — 게임 탭이 둘이어도) */
let pendingState = ''

/**
 * 치지직 로그인(계정 연동)을 **작은 창**으로 연다 — 동의하면 그 창이 code 를 들고 이 주소로 돌아와 이 창에 넘기고 닫힌다(entry.ts).
 * 전에는 이 창을 통째로 옮겨 방 · P2P 연결이 끊겼다 (2026-10-23 사용자: "최초 치지직 로그인하면 방이 나가지고 다시 방을 만들어야").
 * 팝업이 막히면 안내만 한다 — 이 창을 옮기면 방이 나가진다
 */
export function startLogin(): void {
  const state = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  try {
    localStorage.setItem(LS_STATE, state)
    localStorage.setItem(LS_POPUP, state)
  } catch {
    /* 저장소 없음 */
  }
  const u = new URL('https://chzzk.naver.com/account-interlock')
  u.searchParams.set('clientId', CHZZK_CLIENT_ID)
  u.searchParams.set('redirectUri', redirectUri())
  u.searchParams.set('state', state)
  pendingState = state
  listenLoginPopup()
  const w = window.open(u.toString(), 'brpg-chzzk', 'popup,width=520,height=760')
  if (w) w.focus()
  else stream.setStatus('error', '로그인 창(팝업)이 막혔습니다 — 주소창 오른쪽에서 팝업을 허용하고 다시 눌러 주세요')
}

let loginChannel: BroadcastChannel | null = null
/** 작은 창이 넘기는 code 를 받는다 — 토큰으로 바꾸고 연결 (방 · 판은 그대로) */
function listenLoginPopup(): void {
  if (loginChannel || typeof BroadcastChannel === 'undefined') return
  loginChannel = new BroadcastChannel(CZ_CHANNEL)
  loginChannel.onmessage = (e: MessageEvent<{ code?: string; state?: string }>) => {
    const { code, state } = e.data ?? {}
    if (!code || !state || state !== pendingState) return
    pendingState = ''
    try {
      localStorage.removeItem(LS_POPUP)
    } catch {
      /* 저장소 없음 */
    }
    void exchangeCode(code, state).then((ok) => {
      if (!ok) return
      onLoginDone?.()
      void connect()
    })
  }
}

/** 작은 창 로그인이 끝났을 때 (main.ts — 자동 연결을 켠다) */
let onLoginDone: (() => void) | null = null
export function setOnLoginDone(f: () => void): void {
  onLoginDone = f
}

/** 로그인 뒤 돌아온 code 를 토큰으로 바꾼다. 바꿨으면 true (주소의 code · state 는 지운다) — 예전처럼 이 창으로 돌아온 경우 */
export async function handleOAuthRedirect(): Promise<boolean> {
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const st = params.get('state')
  if (!code) return false
  history.replaceState(null, '', location.pathname + location.hash)
  return exchangeCode(code, st)
}

/** code → 토큰 (확인 값 state 가 이 브라우저가 연 로그인 것이어야 한다) */
async function exchangeCode(code: string, st: string | null): Promise<boolean> {
  if (!st || st !== localStorage.getItem(LS_STATE)) {
    stream.setStatus('error', '로그인 확인 값(state)이 맞지 않습니다 — 다시 로그인해 주세요')
    return false
  }
  localStorage.removeItem(LS_STATE)
  try {
    saveTokens(await tokenRequest({ grantType: 'authorization_code', code, state: st }))
    return true
  } catch (e) {
    stream.setStatus('error', `토큰 교환 실패: ${msg(e)}`)
    return false
  }
}

async function tokenRequest(extra: Record<string, string>): Promise<TokenSet> {
  // Client Secret 은 프록시 워커가 채워 넣는다
  const res = await fetch(`${CHZZK_PROXY}/auth/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: CHZZK_CLIENT_ID, ...extra }),
  })
  const json = (await res.json().catch(() => null)) as { content?: { accessToken?: string; refreshToken?: string }; message?: string } | null
  if (!res.ok || !json?.content?.accessToken) throw Object.assign(new Error(json?.message ?? `HTTP ${res.status}`), { status: res.status })
  return { accessToken: json.content.accessToken, refreshToken: json.content.refreshToken ?? '' }
}

async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const t = tokens()
  if (!t) throw new Error('로그인이 필요합니다')
  const res = await fetch(CHZZK_PROXY + path, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${t.accessToken}`, 'Content-Type': 'application/json' },
  })
  if (res.status === 401) {
    if (retry && t.refreshToken) {
      try {
        saveTokens(await tokenRequest({ grantType: 'refresh_token', refreshToken: t.refreshToken }))
      } catch (e) {
        // 네트워크 · 프록시 5xx · 429 는 잠깐의 실패 — 로그인을 지우지 않고 보통처럼 다시 붙는다 (전에는 무엇이든 지워 방송 중에 다시 로그인해야 했다)
        const st = (e as { status?: number }).status
        if (st !== 400 && st !== 401) throw e
        // 다른 탭이 먼저 갱신했으면(갱신 토큰이 바뀜) 그 토큰으로 — 지우면 둘 다 로그아웃된다
        if (tokens()?.refreshToken !== t.refreshToken) return api<T>(path, init, false)
        saveTokens(null)
        throw new AuthExpiredError()
      }
      return api<T>(path, init, false)
    }
    saveTokens(null)
    throw new AuthExpiredError()
  }
  const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null
  if (!res.ok) throw new Error(json?.message ?? `HTTP ${res.status}`)
  return json as T
}

function msg(e: unknown): string {
  if (e instanceof TypeError) return '네트워크 · 프록시에 닿지 못했습니다'
  return e instanceof Error ? e.message : String(e)
}

function handleFailure(e: unknown): void {
  if (e instanceof AuthExpiredError) {
    manualOff = true
    disconnectSocket()
    stream.setStatus('error', e.message)
    return
  }
  stream.setStatus('error', msg(e))
  scheduleReconnect()
}

/** 세션을 열고 채팅 · 후원을 구독한다 */
export async function connect(): Promise<void> {
  if (!hasToken()) {
    manualOff = true
    stream.setStatus('error', '로그인이 필요합니다 — [치지직 로그인]을 눌러 주세요')
    return
  }
  const gen = ++connectGen
  manualOff = false
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  disconnectSocket()
  stream.setStatus('connecting', '세션 주소를 받는 중…')
  try {
    const auth = await api<{ content?: { url?: string } }>('/open/v1/sessions/auth')
    if (gen !== connectGen) return
    const url = auth.content?.url
    if (!url) throw new Error('세션 주소를 받지 못했습니다')
    // socket.io(65KB)는 처음 연결할 때 한 번 받는다 — 방송하지 않는 사람은 받을 일이 없다 (2026-10-25 검토)
    ioP ??= import('socket.io-client').then((m) => m.default)
    const io = await ioP
    if (gen !== connectGen) return
    openSocket(io, url)
  } catch (e) {
    if (gen !== connectGen) return
    handleFailure(e)
  }
}

function parse(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** 채팅 글의 이모티콘 표시({:d_12:})를 뗀다 — 말풍선에는 글만 */
export function stripEmotes(s: string): string {
  return s.replace(/\{:[^:}]{1,40}:\}/g, '').replace(/\s+/g, ' ').trim()
}

function dupe(key: string): boolean {
  const now = Date.now()
  const last = recent.get(key)
  recent.set(key, now)
  if (recent.size > 500) recent.clear()
  return last !== undefined && now - last < DEDUPE_MS
}

function openSocket(io: (typeof import('socket.io-client'))['default'], url: string): void {
  stream.setStatus('connecting', '웹소켓 연결 중…')
  subscribed.clear()
  subFail = ''
  const s = io(url, { reconnection: false, transports: ['websocket'], timeout: 8000, forceNew: true })
  socket = s
  s.on('SYSTEM', (raw) => {
    if (socket !== s) return
    const ev = parse(raw) as { type?: string; data?: { sessionKey?: string; eventType?: string } } | null
    if (!ev) return
    if (ev.type === 'connected' && ev.data?.sessionKey) void subscribeAll(ev.data.sessionKey)
    else if (ev.type === 'subscribed') {
      subscribed.add((ev.data?.eventType ?? '').toUpperCase())
      reconnectDelay = 5000
      const what = [subscribed.has('CHAT') ? '채팅' : '', subscribed.has('DONATION') ? '후원' : ''].filter(Boolean).join(' · ')
      stream.setStatus('on', `${what} 받는 중${subFail ? ` · ${subFail}` : ''}`)
    } else if (ev.type === 'revoked') stream.setStatus('error', '구독이 해제되었습니다(권한 철회) — 다시 로그인해 주세요')
  })
  s.on('CHAT', (raw) => {
    const c = parse(raw) as { senderChannelId?: string; profile?: { nickname?: string }; content?: string; userRoleCode?: string } | null
    if (!c) return
    const text = stripEmotes(c.content ?? '')
    if (!text) return
    const nick = (c.profile?.nickname ?? '').trim() || '시청자'
    if (dupe(`c|${c.senderChannelId ?? nick}|${text}`)) return
    stream.chat({ nick, text })
  })
  s.on('DONATION', (raw) => {
    const d = parse(raw) as { donatorNickname?: string; donatorChannelId?: string; payAmount?: string | number; donationText?: string } | null
    if (!d) return
    const amount = Number(d.payAmount) || 0
    const nick = (d.donatorNickname ?? '').trim() || '익명의 후원자'
    const text = stripEmotes(d.donationText ?? '')
    if (dupe(`d|${d.donatorChannelId ?? nick}|${amount}|${text}`)) return
    stream.donation({ nick, amount, text })
  })
  // 옛 소켓의 처리기는 무시한다 — connect() 가 옛 소켓을 끊을 때 그 'disconnect' 가 바로 불려 다시 붙기를 또 걸었다
  // (구독이 한 번 실패한 뒤로 5초마다 끊고 붙기를 끝없이 되풀이 — 2026-10-25 검토)
  s.on('disconnect', () => {
    if (socket !== s) return
    if (!manualOff) {
      stream.setStatus('error', '연결이 끊어졌습니다 — 다시 연결하는 중')
      scheduleReconnect()
    }
  })
  s.on('connect_error', () => {
    if (socket !== s) return
    stream.setStatus('error', '웹소켓 연결 실패')
    scheduleReconnect()
  })
  s.on('connect_timeout', () => {
    if (socket !== s) return
    stream.setStatus('error', '웹소켓 연결 시간 초과')
    scheduleReconnect()
  })
}

/** 채팅 · 후원을 따로 구독한다 — 앱에 채팅 권한이 없어도 후원은 받게 */
async function subscribeAll(sessionKey: string): Promise<void> {
  const q = `sessionKey=${encodeURIComponent(sessionKey)}`
  const fails: string[] = []
  for (const [what, path] of [['후원', 'donation'], ['채팅', 'chat']] as const) {
    try {
      await api(`/open/v1/sessions/events/subscribe/${path}?${q}`, { method: 'POST' })
    } catch (e) {
      if (e instanceof AuthExpiredError) {
        handleFailure(e)
        return
      }
      fails.push(`${what}(${msg(e)})`)
    }
  }

  if (fails.length === 2) handleFailure(new Error(`구독 실패: ${fails.join(' · ')}`))
  else if (fails.length === 1) {
    subFail = `${fails[0]} 구독 실패 — 앱 권한을 확인하세요`
    if (stream.status === 'on') stream.setStatus('on', `${stream.detail} · ${subFail}`)
  }
}

function scheduleReconnect(): void {
  if (manualOff || reconnectTimer !== null) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (!manualOff) void connect()
  }, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, 15000)
}

function disconnectSocket(): void {
  const s = socket
  if (!s) return
  // 먼저 비운다 — 끊는 그 자리에서 불리는 옛 소켓의 'disconnect' 처리기가 제가 옛 것임을 알게 (openSocket 의 socket !== s)
  socket = null
  try {
    s.disconnect()
  } catch {
    /* 이미 끊김 */
  }
}

export function disconnect(): void {
  manualOff = true
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  disconnectSocket()
  stream.setStatus('off')
}

export function logout(): void {
  disconnect()
  saveTokens(null)
}
