// 분위기(스킨) — 어둡게 · 밝게 (2026-10-06 사용자: "어둡고 무서운 게임 같다는 피드백 — 밝고 귀엽게" ·
// "기존 걸 다 지우는 건 아쉬우니 어두운 분위기 · 밝은 분위기를 방 설정에서 고를 수 있게").
// 계획: docs/밝은-분위기-개편-계획.md. 분위기는 **그림 · 색 · 소리 · 글만** 다르다 — sim(src/core)에는 넣지 않는다.
// 판정 · 해시 · 세이브 · 퀘스트 진행은 두 분위기에서 같다(방장이 고른 값을 방 사람 모두가 같이 본다 — SessionConfig.skin).
//
// 분위기마다 다른 것은 여기서 꺼내 쓴다:
//  - 맵 테마(색 · 빛 · 안개)  → skinMap(map)
//  - 화면 글(지역 · 괴물 · 퀘스트 이름 …) → setSkin 이 정의표의 글을 그 분위기 것으로 갈아 끼운다(applyText)
//    정의표(AREAS · MONSTER_LIST · QUESTS …)를 화면 곳곳이 바로 읽어서, 읽는 곳마다 고치는 대신 글만 바꿔 끼운다.
//    처음 갈아 끼울 때 원래 글(어둡게)을 기억해 두었다가 되돌린다. sim 은 이 글을 읽지 않는다.

import type { GameMap } from '../core/map'
import type { MapTheme } from '../core/maps'

export type Skin = 'dark' | 'bright'

// 화면 이름 (2026-10-07 사용자: "어둡게 · 밝게 말고 공포스러움 · 철면수심전용 이렇게 나눠줘") — 안쪽 값(dark · bright)은 그대로
export const SKIN_LABEL: Record<Skin, string> = { dark: '공포스러움', bright: '철면수심전용' }
export const SKIN_ICON: Record<Skin, string> = { dark: '🌙', bright: '☀' }
export const SKIN_DESC: Record<Skin, string> = {
  dark: '어두운 던전 · 실사 괴물 — 처음 분위기 그대로',
  bright: '파스텔 놀이 섬 · 귀여운 괴물 · 물감 · 색종이 — 무섭지 않게 (철면수심 방송용)',
}

const PREF_KEY = 'brpg.skin'
let current: Skin = 'dark'
const fns = new Set<(s: Skin) => void>()

export const skin = (): Skin => current
export const isBright = (): boolean => current === 'bright'
export const asSkin = (v: unknown): Skin => (v === 'bright' ? 'bright' : 'dark')

/** 지금 분위기를 바꾼다 (게임 시작 · 로비 미리보기). 글을 그 분위기 것으로 갈아 끼우고 알린다 */
export function setSkin(s: Skin): void {
  if (s === current) return
  current = s
  applyText(s)
  for (const f of [...fns]) f(s)
}

export function onSkin(f: (s: Skin) => void): () => void {
  fns.add(f)
  return () => fns.delete(f)
}

/** 방을 만들 때 처음 값 (지난번에 고른 것) */
export function loadSkinPref(): Skin {
  try {
    return asSkin(localStorage.getItem(PREF_KEY))
  } catch {
    return 'dark'
  }
}

export function saveSkinPref(s: Skin): void {
  try {
    localStorage.setItem(PREF_KEY, s)
  } catch {
    /* 저장 못 해도 이번 판은 반영된다 */
  }
}

// ---------------------------------------------------------------- 맵 테마

/** 밝은 분위기 맵 테마 (맵 번호 → 테마). 비어 있는 맵은 원래 테마 그대로 (투기장 맵 등) */
const BRIGHT_THEMES = new Map<string, MapTheme>()

/** 밝은 테마를 등록한다 (skinThemes.ts — 표가 길어 따로 둔다) */
export function registerBrightTheme(id: string, t: MapTheme): void {
  BRIGHT_THEMES.set(id, t)
}

/**
 * 맵의 테마를 지금 분위기 것으로. 맵을 만든 뒤 (화면 쪽에서) 부른다 — 원래 테마는 기억해 두었다가 되돌린다.
 * 테마는 그림만 쓴다(map.ts 의 타일 · 생성은 테마를 보지 않는다) → 판정에 영향이 없다.
 */
export function skinMap<M extends GameMap>(map: M): M {
  const m = map as M & { themeBase?: MapTheme }
  m.themeBase ??= m.theme
  m.theme = current === 'bright' ? (BRIGHT_THEMES.get(m.id) ?? m.themeBase) : m.themeBase
  return map
}

// ---------------------------------------------------------------- 화면 글

/** 글 갈아 끼우기 한 칸: 대상 객체 · 필드 · 밝은 글 */
interface TextSwap {
  obj: Record<string, unknown>
  key: string
  bright: string
  /** 원래(어두운) 글 — 처음 갈아 끼울 때 채운다 */
  dark?: string
}
const SWAPS: TextSwap[] = []

/** 밝은 분위기 글을 등록한다 (skinText.ts). 같은 칸을 두 번 적으면 뒤의 것이 이긴다 */
export function registerText(obj: object, key: string, bright: string): void {
  const o = obj as Record<string, unknown>
  let sw = SWAPS.find((s) => s.obj === o && s.key === key)
  if (sw) sw.bright = bright
  else SWAPS.push((sw = { obj: o, key, bright }))
  if (current === 'bright') applyOne(sw, 'bright')
}

function applyOne(s: TextSwap, to: Skin): void {
  if (s.dark === undefined) s.dark = String(s.obj[s.key] ?? '')
  s.obj[s.key] = to === 'bright' ? s.bright : s.dark
}

function applyText(to: Skin): void {
  for (const s of SWAPS) applyOne(s, to)
}

/** 정의표 밖에 박힌 짧은 글의 낱말 (밝게) — 길이가 긴 것부터 */
const WORDS: [string, string][] = [
  ['촌장 카인', '안내원 모모'],
  ['촌장', '안내원'],
  ['보물 고블린', '보물 토끼'],
  ['심연이 닫혔다', '마지막 도장!'],
  // 받침이 바뀌는 이름은 조사까지 (군주가 → 드래곤이 · 도살자를 → 버섯왕을)
  ['심연의 군주가', '파티 드래곤이'],
  ['심연의 군주를', '파티 드래곤을'],
  ['심연의 군주는', '파티 드래곤은'],
  ['심연의 군주', '파티 드래곤'],
  ['거미 여왕', '여왕벌'],
  ['관리인', '진행요원 반장'],
  ['도살자가', '술래 버섯왕이'],
  ['도살자를', '술래 버섯왕을'],
  ['도살자는', '술래 버섯왕은'],
  ['도살자', '술래 버섯왕'],
  ['그림자가 흘러나온다', '유령이 흘러나온다'],
  ['지옥불', '축포'],
  ['고기 비', '사탕 비'],
  ['거미줄이', '꿀 부채가'],
  ['새끼가 쏟아진다', '꿀벌이 쏟아진다'],
  // 시련 (반복 끝 콘텐츠 — 2026-10-08): 밝게는 "도전 놀이". 조사가 바뀌는 것부터
  ['시련의 문', '도전의 문'],
  ['시련의 수호자', '도전 놀이 수호자'],
  ['시련이', '도전 놀이가'],
  ['시련은', '도전 놀이는'],
  ['시련을', '도전 놀이를'],
  ['시련', '도전 놀이'],
]
/** 화면 글 한 줄을 지금 분위기로 (밝게면 촌장 → 안내원). 배너 · HUD · 창 글처럼 코드에 박힌 글에 쓴다 */
export function bt(s: string): string {
  if (current !== 'bright') return s
  for (const [a, b] of WORDS) s = s.split(a).join(b)
  return s
}
