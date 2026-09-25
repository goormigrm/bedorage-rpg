// 소리 크기 (2026-09-25 사용자 고른 개선 1: "소리 크기 따로 조절 — 배경음 · 효과음 · 괴물 소리 · 보스 목소리").
// 전에는 켜고 끄기뿐이라 방송하며 괴물 소리만 줄이는 일이 안 됐다. 값은 브라우저에 남고(localStorage), 바꾸면 곧장 들린다.

export type VolKey = 'all' | 'bgm' | 'sfx' | 'mon' | 'boss'
export const VOL_KEYS: VolKey[] = ['all', 'bgm', 'sfx', 'mon', 'boss']
export const VOL_NAMES: Record<VolKey, string> = { all: '전체', bgm: '배경음', sfx: '효과음', mon: '괴물 소리', boss: '보스 목소리' }

const KEY = 'brpg.vol'
const DEFAULT: Record<VolKey, number> = { all: 1, bgm: 1, sfx: 1, mon: 1, boss: 1 }

function load(): Record<VolKey, number> {
  const out = { ...DEFAULT }
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<VolKey, unknown>>
    for (const k of VOL_KEYS) {
      const v = Number(o[k])
      if (Number.isFinite(v)) out[k] = Math.max(0, Math.min(1, v))
    }
  } catch {
    /* 기본값 */
  }
  return out
}

let cur = load()
const subs = new Set<() => void>()

/** 지금 크기 (0 ~ 1) */
export function volumes(): Readonly<Record<VolKey, number>> {
  return cur
}

export function setVolume(k: VolKey, v: number): void {
  cur = { ...cur, [k]: Math.max(0, Math.min(1, v)) }
  try {
    localStorage.setItem(KEY, JSON.stringify(cur))
  } catch {
    /* 저장 못 해도 이번 판은 반영된다 */
  }
  for (const f of subs) f()
}

/** 크기가 바뀌면 부른다 (소리 쪽이 곧장 반영) — 끊는 함수를 돌려준다 */
export function onVolume(f: () => void): () => void {
  subs.add(f)
  return () => subs.delete(f)
}
