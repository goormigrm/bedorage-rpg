// 보스 패턴의 예고 범위 (2026-09-23 사용자: "각 막의 보스들은 적어도 3가지 정도의 일정한 패턴 스킬 — 피하지 않으면 클리어가 어렵게").
// 모양은 넷: 원 · 고리(안쪽은 안전) · 줄(광선 · 갈고리) · 부채(휘두르기). sim(맞았나) · 봇(어디로 비키나) · 렌더(그리기)가 같이 쓴다.

import { angleDiff, atan2A, cosA, len, sinA } from './fixedmath'
import { ZS_CONE, ZS_LINE, ZS_RING, Zone } from './state'

/** 모양 칸만 (Zone 과 'bzone' 이벤트가 같이 쓴다) */
export type ZoneShape = Pick<Zone, 'x' | 'y' | 'r' | 'shape' | 'a' | 'len' | 'r2' | 'arc'>

/** (px, py) 가 범위 안인가. pad = 몸이 걸쳐도 맞는 너비 (사람 몸 반지름의 일부) */
export function inZone(z: ZoneShape, px: number, py: number, pad: number): boolean {
  const dx = px - z.x
  const dy = py - z.y
  const shape = z.shape ?? 0
  if (shape === ZS_LINE) {
    const cx = cosA(z.a ?? 0)
    const cy = sinA(z.a ?? 0)
    const along = dx * cx + dy * cy
    if (along < -pad || along > (z.len ?? 0) + pad) return false
    return Math.abs(-dx * cy + dy * cx) <= z.r + pad
  }
  const d = len(dx, dy)
  if (shape === ZS_RING) return d <= z.r + pad && d >= (z.r2 ?? 0) - pad
  if (shape === ZS_CONE) {
    if (d > z.r + pad) return false
    if (d < pad) return true
    return Math.abs(angleDiff(atan2A(dy, dx), z.a ?? 0)) <= (z.arc ?? 0)
  }
  return d <= z.r + pad
}

/** 범위에서 빠져나갈 방향 (크기는 아무렇게나 — 봇이 atan2 로 쓴다) */
export function zoneEscape(z: ZoneShape, px: number, py: number): { x: number; y: number } {
  const dx = px - z.x
  const dy = py - z.y
  const shape = z.shape ?? 0
  if (shape === ZS_LINE) {
    // 줄: 옆으로 (가까운 쪽)
    const cx = cosA(z.a ?? 0)
    const cy = sinA(z.a ?? 0)
    const side = -dx * cy + dy * cx >= 0 ? 1 : -1
    return { x: -cy * side, y: cx * side }
  }
  const d = len(dx, dy) || 1
  if (shape === ZS_RING) {
    // 고리: 안쪽 안전 원이 가까우면 안으로, 아니면 밖으로
    const inward = d - (z.r2 ?? 0) < z.r - d
    return inward ? { x: -dx / d, y: -dy / d } : { x: dx / d, y: dy / d }
  }
  if (shape === ZS_CONE) {
    // 반 바퀴가 넘는 부채(관리인 처형): 등 뒤로
    if ((z.arc ?? 0) >= 256) {
      const a = ((z.a ?? 0) + 512) & 1023
      return { x: cosA(a), y: sinA(a) }
    }
    // 부채: 끝이 가까우면 밖으로, 아니면 옆으로 (가까운 옆)
    if (d > z.r * 0.6) return { x: dx / d, y: dy / d }
    const side = angleDiff(atan2A(dy, dx), z.a ?? 0) >= 0 ? 1 : -1
    const a = ((z.a ?? 0) + side * 256) & 1023
    return { x: cosA(a), y: sinA(a) }
  }
  return { x: dx / d || 1, y: dy / d }
}
