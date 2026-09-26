// 개발자 모드 (2026-09-26 사용자: "치지직 관련 시험은 특정 버튼(Ctrl+Shift+D)이나 개발자만 아는 모드로 해야만 시험 버튼이 보이게 —
// 악성 시청자가 같이 게임하는데 게임을 망치는 게 가능하니까"). 켜면 치지직 창에 시험 단추(채팅 · 참여 · 금액별 · 응원)가 보인다.
// 단추를 숨기는 것만으로는 막을 수 없으므로 시험 후원 자체도 **방장만** 된다(game/stream.ts testBlock · session).
// 이 브라우저에만 저장한다. 단축키는 플레이 가이드 · 공지에 적지 않는다(HANDOVER 에만).

const KEY = 'brpg.dev'

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let on = read()
const fns = new Set<(v: boolean) => void>()

export function isDev(): boolean {
  return on
}

/** 켜고 끌 때마다 (열린 치지직 창이 시험 단추를 다시 그린다) */
export function onDevChange(f: (v: boolean) => void): () => void {
  fns.add(f)
  return () => fns.delete(f)
}

export function toggleDev(): boolean {
  on = !on
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* 저장 못 해도 이번 페이지에는 반영된다 */
  }
  for (const f of [...fns]) f(on)
  return on
}

/** 잠깐 뜨는 안내 (화면 위 가운데) */
function toast(text: string): void {
  const el = document.createElement('div')
  el.className = 'devtoast'
  el.textContent = text
  document.body.appendChild(el)
  window.setTimeout(() => el.remove(), 2200)
}

let installed = false

/** Ctrl + Shift + D — 잡는 단계에서 먼저 받아 게임 키(D = 오른쪽)로 가지 않게 한다 */
export function installDevKey(): void {
  if (installed) return
  installed = true
  window.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey && e.shiftKey && e.code === 'KeyD') || e.repeat) return
      e.preventDefault()
      e.stopPropagation()
      toast(toggleDev() ? '개발자 모드 켜짐 — 치지직 창에 시험 단추가 보입니다' : '개발자 모드 꺼짐')
    },
    true,
  )
}
