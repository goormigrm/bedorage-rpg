// mulberry32 시드 난수. 상태는 32비트 정수 하나라 스냅샷/해시가 쉽다.

export interface Rng {
  s: number
}

export function makeRng(seed: number): Rng {
  return { s: seed >>> 0 }
}

/** [0, 1) */
export function rand(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0
  let t = r.s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** [lo, hi) 정수 */
export function randInt(r: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rand(r) * (hi - lo))
}

/** [-1, 1) */
export function randSigned(r: Rng): number {
  return rand(r) * 2 - 1
}
