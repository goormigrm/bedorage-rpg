// 키 재설정 (2026-09-23 — "RPG 에 보통 있는데 없는 것" 목록의 키 재설정). 설정 창(ui/settings.ts)에서 바꾼다.
//
// **키는 e.code 로 적는다**(KeyW · Digit1 · Space). e.key 는 자판 배열과 입력기를 따라 바뀐다 —
// 한글 입력 상태에서는 W 가 'ㅈ' 이거나 'Process' 로 와서 전에는 한/영 키를 잘못 누르면 움직이지 않았다.
// 왼쪽 · 오른쪽 Shift/Ctrl/Alt 는 하나로 본다(ShiftLeft · ShiftRight → Shift).
// 화살표는 이동의 **두 번째 키**로 늘 살아 있다(바꾸지 않는다). Esc · Enter · Tab 은 정해진 뜻이 있어 걸 수 없다.

export type Action =
  | 'up' | 'down' | 'left' | 'right'
  | 'dash' | 'sprint' | 'use' | 'portal'
  | 'skill1' | 'skill2' | 'ult' | 'skill3' | 'skill4'
  | 'bag' | 'skills' | 'attr' | 'quest' | 'map'
  | 'voice' | 'mark' | 'mute'

export const ACTIONS: { id: Action; label: string; def: string; group: string }[] = [
  { id: 'up', label: '위로', def: 'KeyW', group: '이동' },
  { id: 'down', label: '아래로', def: 'KeyS', group: '이동' },
  { id: 'left', label: '왼쪽', def: 'KeyA', group: '이동' },
  { id: 'right', label: '오른쪽', def: 'KeyD', group: '이동' },
  { id: 'dash', label: '구르기', def: 'Space', group: '이동' },
  { id: 'sprint', label: '달리기', def: 'Shift', group: '이동' },
  { id: 'skill1', label: '스킬 1', def: 'KeyQ', group: '전투' },
  { id: 'skill2', label: '스킬 2', def: 'KeyE', group: '전투' },
  { id: 'ult', label: '궁극기', def: 'KeyR', group: '전투' },
  { id: 'skill3', label: '배운 스킬 1', def: 'Digit1', group: '전투' },
  { id: 'skill4', label: '배운 스킬 2', def: 'Digit2', group: '전투' },
  { id: 'use', label: '이동 · 열기 · 일으키기', def: 'KeyF', group: '전투' },
  { id: 'portal', label: '타운 포털', def: 'KeyT', group: '전투' },
  { id: 'bag', label: '가방', def: 'KeyI', group: '창' },
  { id: 'skills', label: '스킬 창', def: 'KeyK', group: '창' },
  { id: 'attr', label: '능력치', def: 'KeyC', group: '창' },
  { id: 'quest', label: '퀘스트', def: 'KeyJ', group: '창' },
  { id: 'map', label: '지도', def: 'KeyM', group: '창' },
  { id: 'voice', label: '음성(누르고 말하기)', def: 'KeyB', group: '기타' },
  { id: 'mark', label: '신호', def: 'KeyV', group: '기타' },
  { id: 'mute', label: '소리 켜고 끄기', def: 'KeyN', group: '기타' },
]

/** 걸 수 없는 키 (정해진 뜻이 있다) */
export const RESERVED = new Set(['Escape', 'Enter', 'NumpadEnter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'])

const STORE = 'brpg.keymap'
const DEFAULTS: Record<Action, string> = Object.fromEntries(ACTIONS.map((a) => [a.id, a.def])) as Record<Action, string>

let map: Record<Action, string> = load()
const listeners = new Set<() => void>()

function load(): Record<Action, string> {
  const out = { ...DEFAULTS }
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, unknown>
    for (const a of ACTIONS) {
      const v = raw[a.id]
      if (typeof v === 'string' && v && !RESERVED.has(v)) out[a.id] = v
    }
  } catch {
    /* 저장소가 없거나 깨졌으면 기본값 */
  }
  return out
}

function save(): void {
  try {
    const diff: Partial<Record<Action, string>> = {}
    for (const a of ACTIONS) if (map[a.id] !== a.def) diff[a.id] = map[a.id]
    if (Object.keys(diff).length === 0) localStorage.removeItem(STORE)
    else localStorage.setItem(STORE, JSON.stringify(diff))
  } catch {
    /* 저장 못 해도 이번 판은 반영된다 */
  }
  for (const f of listeners) f()
}

/** 키 이벤트 → 저장하는 이름 (좌우 Shift 등은 하나로) */
export function codeOf(e: { code: string; key?: string }): string {
  const c = e.code || ''
  for (const m of ['Shift', 'Control', 'Alt', 'Meta']) if (c.startsWith(m)) return m
  // 아주 드물게 code 가 비는 자판이 있다 — 그때는 글자로 (A → KeyA)
  if (!c && e.key && e.key.length === 1) return /[a-z]/i.test(e.key) ? `Key${e.key.toUpperCase()}` : /\d/.test(e.key) ? `Digit${e.key}` : e.key
  return c
}

export const keyOf = (a: Action): string => map[a]
/** 이 키 이벤트가 그 행동인가 */
export const isKey = (e: { code: string; key?: string }, a: Action): boolean => codeOf(e) === map[a]
/** 그 키가 걸린 행동 (없으면 null) */
export function actionOf(code: string): Action | null {
  for (const a of ACTIONS) if (map[a.id] === code) return a.id
  return null
}

/** 키를 건다. 이미 다른 행동에 걸려 있으면 **서로 바꾼다** (한 키가 둘을 하지 않게) */
export function bind(a: Action, code: string): boolean {
  if (RESERVED.has(code)) return false
  const other = actionOf(code)
  if (other && other !== a) map[other] = map[a]
  map[a] = code
  save()
  return true
}

export function resetKeys(): void {
  map = { ...DEFAULTS }
  save()
}

/** 바뀔 때 알려 준다 (조작 안내 띠 · 창 단추 글자를 다시 쓰려고) */
export function onKeymap(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

/** 화면에 보일 이름 (KeyW → W · Digit1 → 1 · Space → Space) */
export function label(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `숫자판 ${code.slice(6)}`
  const named: Record<string, string> = {
    Space: 'Space', Shift: 'Shift', Control: 'Ctrl', Alt: 'Alt', Meta: 'Win', CapsLock: 'Caps',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  }
  return named[code] ?? code
}
export const keyLabel = (a: Action): string => label(map[a])

/** 스킬 칸 번호(0 Q · 1 E · 2 R · 3 1 · 4 2) → 그 칸의 키 이름 (HUD) */
const SLOT_ACTIONS: Action[] = ['skill1', 'skill2', 'ult', 'skill3', 'skill4']
export const skillKeyLabel = (slot: number): string => keyLabel(SLOT_ACTIONS[slot] ?? 'skill1')

/** 이동 네 키를 한 덩어리로 (기본이면 "WASD") */
export function moveLabel(): string {
  const s = ['up', 'left', 'down', 'right'].map((a) => keyLabel(a as Action))
  return s.join('') === 'WASD' ? 'WASD' : s.join(' · ')
}

/** 조작 안내 띠 (게임 화면 아래) */
export function keysHintHtml(): string {
  const k = keyLabel
  return (
    `<b>${moveLabel()}</b> 이동 · <b>마우스</b> 조준·<b>좌클릭</b> 사격 · <b>우클릭</b> 정조준 · <b>${k('skill1')}·${k('skill2')}</b> 스킬 · <b>${k('ult')}</b> 궁극기 · ` +
    `<b>${k('dash')}</b> 구르기 · <b>${k('sprint')}</b> 달리기 · <b>${k('use')}</b> 이동·열기·일으키기 · <b>${k('portal')}</b> 타운 포털 · ` +
    `<b>${k('bag')}</b> 가방 · <b>${k('skills')}</b> 스킬 · <b>${k('attr')}</b> 능력치 · <b>${k('quest')}</b> 퀘스트 · <b>${k('map')}</b> 지도 · ` +
    `<b>${k('skill3')}·${k('skill4')}</b> 배운 스킬 · <b>${k('voice')}</b> 음성 · <b>${k('mark')}</b> 신호 · <b>Enter</b> 채팅 · <b>Esc</b> 메뉴`
  )
}

/** 시험용: 저장 없이 처음 상태로 */
export function _resetForTest(): void {
  map = { ...DEFAULTS }
}
