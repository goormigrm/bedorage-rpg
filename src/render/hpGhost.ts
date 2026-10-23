// 체력 띠의 깎인 몫 잔상 (2026-10-24 사용자: "피가 줄어들 때 피 게이지 효과" — 덕코프처럼 맞은 몫이 흰 띠로 잠깐 남았다가 줄어든다).
// 괴물 · 보스 · 내 체력 구슬 · 파티 띠가 같이 쓴다. 판(sim)과 무관한 그림 상태라 열쇠(문자열)마다 하나 — 한 프레임에 같은 열쇠를 여러 번 불러도 된다.

/** 맞은 뒤 잔상이 그대로 서 있는 시간 (ms) */
const HOLD = 350
/** 맞은 순간 띠가 번쩍이는 시간 (ms) */
const FLASH = 140

interface Ghost {
  /** 잔상 끝 (0..1) */
  v: number
  /** 지난번 채움 */
  k: number
  /** 이때까지 잔상이 줄지 않는다 */
  hold: number
  /** 마지막으로 깎인 때 */
  hit: number
  /** 마지막으로 부른 때 */
  t: number
}

const ghosts = new Map<string, Ghost>()
let swept = 0

/**
 * 채움 k(0..1) → 잔상 끝 ghost(k 이상)와 번쩍임 flash(1 → 0). now 는 performance.now() (시험은 직접 준다).
 * 차오르면 잔상은 바로 따라온다(회복은 잔상 없음)
 */
export function hpGhost(key: string, k: number, now = performance.now()): { ghost: number; flash: number } {
  let g = ghosts.get(key)
  if (!g) {
    g = { v: k, k, hold: 0, hit: -1e9, t: now }
    ghosts.set(key, g)
  }
  const dt = Math.min(0.1, Math.max(0, (now - g.t) / 1000))
  g.t = now
  if (k < g.k - 1e-4) {
    g.hit = now
    g.hold = now + HOLD
  }
  g.k = k
  if (k >= g.v) g.v = k
  else if (now >= g.hold) g.v = Math.max(k, g.v - (g.v - k) * (1 - Math.exp(-7 * dt)) - 0.2 * dt)
  // 오래 안 불린 것(죽은 괴물 · 나간 사람)은 치운다
  if (now - swept > 1000) {
    swept = now
    for (const [id, o] of ghosts) if (now - o.t > 3000) ghosts.delete(id)
  }
  return { ghost: g.v, flash: Math.max(0, 1 - (now - g.hit) / FLASH) }
}

/** 가로 띠 그리기 도우미: 잔상 몫(k ~ ghost)을 흰 띠로 — 채움 막대를 그리기 **전에** 부른다 */
export function drawGhostBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, ghost: number): void {
  if (ghost <= k + 1e-3) return
  ctx.fillStyle = 'rgba(255,244,222,0.92)'
  ctx.fillRect(x + w * k, y, w * (ghost - k), h)
}

/** 맞은 순간 채움 막대 위를 희게 덮는다 — 채움 막대를 그린 **뒤에** 부른다 */
export function drawFlashBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, flash: number): void {
  if (flash <= 0 || k <= 0) return
  ctx.fillStyle = `rgba(255,255,255,${(0.55 * flash).toFixed(3)})`
  ctx.fillRect(x, y, w * k, h)
}
