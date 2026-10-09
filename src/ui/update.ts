// 판 번호(버전) · 새 판 알림 (2026-10-09 사용자: "구조물 위 흰 박스 · 철면수심전용 안개 없애라고 한 거 · 발소리 없애라고 한 거 적용이 안 됐다").
// 고친 판은 이미 배포돼 있었다(v0.99.1). 예전에 열어 둔 탭은 새 판이 나와도 옛 코드로 계속 돌고, 판 번호가 화면 어디에도 없어
// 어느 판인지 알 수 없었다. 그래서:
//  - 로비 구석에 지금 판 번호를 작게 보인다
//  - 배포본(version.json — vite.config.ts 가 빌드 때 만든다)을 2분마다 · 창으로 돌아올 때 확인해, 더 새 판이 있으면 로비 위에 "새로 고침" 띠
//  - 판 번호가 다른 사람과는 같은 방에 들어가지 않는다(sameVersion — 섞이면 같은 판을 다르게 계산해 어긋난다 · ui/lobby.ts · game/session.ts)
// 게임 중에는 띠를 띄우지 않는다(방송 화면) — 로비로 돌아오면 뜬다

declare const __APP_VERSION__: string

/** 지금 도는 판 번호 (package.json version) */
export const APP_VERSION: string = (() => {
  try {
    return __APP_VERSION__
  } catch {
    return 'dev'
  }
})()

/** a 가 b 보다 새 판인가 (0.100.2 > 0.99.9) */
export function newerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => Number(x) || 0)
  const pb = b.split('.').map((x) => Number(x) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

/** 같은 방에 들어가도 되는 판인가 — 옛 판(번호를 안 보내는 판)은 다르다 */
export function sameVersion(v: unknown): boolean {
  return typeof v === 'string' && v === APP_VERSION
}

/**
 * 판이 달라 같이 못 할 때 보여 줄 말. theirs = 상대(방장 또는 손님)의 판 번호.
 * theyAreHost: 상대가 방장인가(이 말을 받는 사람이 손님) — 누가 새로 고쳐야 하는지 알려 준다
 */
export function versionMismatchText(theirs: unknown, theyAreHost: boolean): string {
  const t = typeof theirs === 'string' ? theirs : ''
  const tv = t ? `v${t}` : '옛 판'
  const who = theyAreHost ? '방장' : '들어오려는 사람'
  // 상대가 더 새 판이면 내가 새로 고친다 · 내가 더 새 판이면(또는 상대가 번호를 모르는 옛 판이면) 상대가 새로 고친다
  const iRefresh = !!t && newerVersion(t, APP_VERSION)
  return `판 번호가 달라 같이 할 수 없습니다 — ${who} ${tv} · 나 v${APP_VERSION}. ${iRefresh ? '새로 고침(F5) 뒤 다시 들어오세요' : `${who}이 새로 고침(F5)해야 합니다`}`
}

let latest: string | null = null
let inLobby = false
let bar: HTMLElement | null = null
let tag: HTMLElement | null = null
let started = false

function render(): void {
  if (!tag) {
    tag = document.createElement('div')
    tag.id = 'ver-tag'
    tag.textContent = `v${APP_VERSION}`
    document.body.appendChild(tag)
  }
  tag.hidden = !inLobby
  const show = inLobby && latest !== null
  if (show && !bar) {
    bar = document.createElement('div')
    bar.id = 'update-bar'
    bar.innerHTML = `<span></span><button class="btn" type="button">새로 고침</button>`
    bar.querySelector('button')!.addEventListener('click', () => location.reload())
    document.body.appendChild(bar)
  }
  if (bar) {
    bar.hidden = !show
    if (show) bar.querySelector('span')!.textContent = `새 판 v${latest} 이 나왔습니다 (지금 v${APP_VERSION})`
  }
}

async function check(): Promise<void> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return
    const v = ((await r.json()) as { version?: unknown }).version
    if (typeof v === 'string' && newerVersion(v, APP_VERSION) && v !== latest) {
      latest = v
      render()
    }
  } catch {
    // 연결이 없으면 다음에
  }
}

/** 로비에 있는가 (main.ts — 로비를 열 때 true · 게임을 열 때 false). 판 번호 · 새 판 띠는 로비에서만 보인다 */
export function setInLobby(v: boolean): void {
  inLobby = v
  render()
  if (v && started) void check()
}

/** 새 판 확인을 시작한다 (배포본에서만 — 개발 서버는 vite 가 알아서 다시 불러온다) */
export function watchUpdates(): void {
  if (started || !import.meta.env.PROD) return
  started = true
  void check()
  window.setInterval(() => void check(), 120_000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
}

/** 방장이 판이 다른 손님을 돌려보낼 때 손님 화면에 뜨는 말 (rejoinNo — 손님 눈으로: "방장 v… · 나 v…") */
export function rejectGuestText(guestVer: unknown): string {
  const g = typeof guestVer === 'string' ? guestVer : ''
  const guestNewer = !!g && newerVersion(g, APP_VERSION)
  return `판 번호가 달라 같이 할 수 없습니다 — 방장 v${APP_VERSION} · 나 ${g ? 'v' + g : '옛 판'}. ${guestNewer ? '방장이 새로 고침(F5)해야 합니다' : '새로 고침(F5) 뒤 다시 들어오세요'}`
}
