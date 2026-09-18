// 결정론적 수학 유틸.
// core/ 안에서는 Math.sin/cos/atan2/random 을 직접 쓰지 않는다.
// 삼각함수는 1024 단계 룩업 테이블로 대체하고, 테이블 값은 1/65536 단위로 반올림해
// 엔진(V8/SpiderMonkey/JSC)별 ulp 차이를 없앤다.

export const ANGLE_STEPS = 1024
export const ANGLE_MASK = ANGLE_STEPS - 1

const SIN = new Float64Array(ANGLE_STEPS)
const COS = new Float64Array(ANGLE_STEPS)
for (let i = 0; i < ANGLE_STEPS; i++) {
  const a = (i / ANGLE_STEPS) * Math.PI * 2
  SIN[i] = Math.round(Math.sin(a) * 65536) / 65536
  COS[i] = Math.round(Math.cos(a) * 65536) / 65536
}

/** 각도(0..1023) → sin */
export function sinA(a: number): number {
  return SIN[a & ANGLE_MASK]
}
/** 각도(0..1023) → cos */
export function cosA(a: number): number {
  return COS[a & ANGLE_MASK]
}

/** 라디안 → 1024 단계 각도. 렌더/입력 쪽에서만 사용 (sim 밖). */
export function radToAngle(rad: number): number {
  let a = Math.round((rad / (Math.PI * 2)) * ANGLE_STEPS)
  a %= ANGLE_STEPS
  if (a < 0) a += ANGLE_STEPS
  return a
}
/** 1024 단계 각도 → 라디안. 렌더 전용. */
export function angleToRad(a: number): number {
  return ((a & ANGLE_MASK) / ANGLE_STEPS) * Math.PI * 2
}

/**
 * 결정론적 atan2. 벡터 (x, y) 의 방향을 0..1023 각도로 반환.
 * 이진 탐색으로 테이블에서 가장 가까운 각도를 찾는다. 봇 AI 조준에 사용.
 */
export function atan2A(y: number, x: number): number {
  if (x === 0 && y === 0) return 0
  // 8분면 축소 후 탐색
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const swap = ay > ax
  const t = swap ? ax / ay : ay / ax // 0..1 = tan(theta), theta in [0, 45°]
  // 45° = 128 스텝. 테이블 tan 비교로 이진 탐색
  let lo = 0
  let hi = 128
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    const tanMid = SIN[mid] / COS[mid]
    if (tanMid <= t) lo = mid
    else hi = mid
  }
  // lo 와 hi 중 더 가까운 쪽
  const tLo = SIN[lo] / COS[lo]
  const tHi = hi < 128 ? SIN[hi] / COS[hi] : 1
  let a = t - tLo <= tHi - t ? lo : hi
  if (swap) a = 256 - a
  if (x < 0) a = 512 - a
  if (y < 0) a = ANGLE_STEPS - a
  return a & ANGLE_MASK
}

/** 두 각도의 최소 차이 (-512..511) */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) & ANGLE_MASK
  if (d >= ANGLE_STEPS / 2) d -= ANGLE_STEPS
  return d
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function len(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}
