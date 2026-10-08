// 오류 보고 (2026-10-08 퀄리티 7단계 — 품질 지키기): 페이지에서 잡히지 않은 오류가 나면 화면 아래에 작은 "⚠ 오류 보고" 단추가 뜬다.
// 누르면 오류 내용 · 판 번호(버전) · 브라우저를 한 덩어리 글로 모아 **복사** 할 수 있다 — 플레이어가 댓글 · 디스코드에 그대로 붙여 넣는다.
// 밖으로 보내지 않는다(서버 없음). 같은 오류는 한 번만 · 최근 20개까지.

declare const __APP_VERSION__: string

interface Caught {
  at: string
  msg: string
  where: string
}

const list: Caught[] = []
const IGNORE = ['ResizeObserver loop', 'WebSocket', 'Failed to fetch', 'NetworkError', 'Load failed', 'NotAllowedError', 'AbortError', 'ICE', 'RTCPeerConnection', 'User-Initiated Abort']
let btn: HTMLButtonElement | null = null
let panel: HTMLElement | null = null

function version(): string {
  try {
    return __APP_VERSION__
  } catch {
    return '?'
  }
}

function report(): string {
  const lines = [
    `배도라지 알PG 오류 보고 — v${version()}`,
    `시각 ${new Date().toLocaleString('ko-KR')}`,
    `주소 ${location.origin}${location.pathname}`,
    `브라우저 ${navigator.userAgent}`,
    `화면 ${innerWidth}×${innerHeight} · 배율 ${devicePixelRatio}`,
    '',
    ...list.map((e, i) => `#${i + 1} [${e.at}] ${e.msg}${e.where ? `\n    ${e.where}` : ''}`),
  ]
  return lines.join('\n')
}

function add(msg: string, where: string): void {
  if (!msg) return
  // 확장 프로그램 · 크로스 출처 스크립트의 빈 오류("Script error.") · 네트워크(P2P 연결 · 받기 실패) · 소리 자동 재생 막힘은
  // 게임 결함이 아니다 — 단추를 띄우지 않는다
  if (msg === 'Script error.' || IGNORE.some((k) => msg.includes(k))) return
  if (list.some((e) => e.msg === msg)) return
  list.push({ at: new Date().toLocaleTimeString('ko-KR'), msg: msg.slice(0, 400), where: where.slice(0, 600) })
  if (list.length > 20) list.shift()
  showButton()
}

function showButton(): void {
  if (!btn) {
    btn = document.createElement('button')
    btn.className = 'errbtn'
    btn.onclick = (e) => {
      e.stopPropagation()
      openPanel()
    }
    document.body.appendChild(btn)
  }
  btn.textContent = `⚠ 오류 보고 (${list.length})`
}

function openPanel(): void {
  panel?.remove()
  panel = document.createElement('div')
  panel.className = 'errpanel'
  panel.innerHTML = `<div class="errbox">
    <b>오류가 있었습니다</b>
    <p>아래 글을 복사해 게시판 댓글이나 방송 채팅에 붙여 주시면 고치는 데 큰 도움이 됩니다. 게임은 계속하셔도 됩니다.</p>
    <textarea readonly></textarea>
    <div class="errrow"><button class="btn" data-copy>복사</button><button class="btn secondary" data-close>닫기</button></div>
  </div>`
  const ta = panel.querySelector('textarea')!
  ta.value = report()
  panel.querySelector<HTMLButtonElement>('[data-copy]')!.onclick = async (e) => {
    const b = e.currentTarget as HTMLButtonElement
    try {
      await navigator.clipboard.writeText(ta.value)
      b.textContent = '복사됨 ✓'
    } catch {
      ta.select()
      b.textContent = '글을 선택했습니다 — Ctrl+C'
    }
  }
  panel.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => {
    panel?.remove()
    panel = null
  }
  // 창 안의 누름 · 키가 게임(사격 · 단축키)으로 새지 않게
  for (const ev of ['mousedown', 'mouseup', 'click', 'keydown']) panel.addEventListener(ev, (e) => e.stopPropagation())
  document.body.appendChild(panel)
}

/** 페이지가 뜰 때 한 번 (main.ts) */
export function installErrorReport(): void {
  window.addEventListener('error', (e) => add(e.message || String(e.error ?? ''), e.error?.stack ?? (e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '')))
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | string | undefined
    add(typeof r === 'string' ? r : r?.message ?? String(r), typeof r === 'object' ? r?.stack ?? '' : '')
  })
}
