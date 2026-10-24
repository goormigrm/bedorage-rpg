// 조준선 모양 하나 그리기 — HUD 조준선(hud.ts drawCursor)과 설정 창 미리 보기(ui/settings.ts)가 같이 쓴다 (2026-10-24 사용자: "에임 모양 · 크기는 실제 모양을 그림으로")
import type { AimShape } from '../ui/settings'

/** (x, y) 에 모양 shape · 크기 배율 k · 안쪽 반지름 r 로. on = 약점 위(금색). 어두운 테두리를 먼저 둘러 ☀ 밝은 바닥에서도 보인다 */
export function drawAimShape(ctx: CanvasRenderingContext2D, x: number, y: number, shape: AimShape, k: number, r: number, on: boolean): void {
  const tick = 6 * k
  const col = on ? 'rgba(255,216,74,0.95)' : 'rgba(255,255,255,0.92)'
  const path = () => {
    ctx.beginPath()
    if (shape === 'cross' || shape === 'crossring') {
      ctx.moveTo(x - r - tick, y)
      ctx.lineTo(x - r, y)
      ctx.moveTo(x + r, y)
      ctx.lineTo(x + r + tick, y)
      ctx.moveTo(x, y - r - tick)
      ctx.lineTo(x, y - r)
      ctx.moveTo(x, y + r)
      ctx.lineTo(x, y + r + tick)
    }
    if (shape === 'crossring' || shape === 'ring') {
      ctx.moveTo(x + r + (shape === 'ring' ? 2 * k : 0), y)
      ctx.arc(x, y, r + (shape === 'ring' ? 2 * k : 0), 0, Math.PI * 2)
    }
  }
  const lw = (on ? 2.5 : 2) * Math.max(1, k * 0.85)
  if (shape !== 'dot') {
    ctx.strokeStyle = 'rgba(20,14,30,0.55)'
    ctx.lineWidth = lw + 2.2
    path()
    ctx.stroke()
    ctx.strokeStyle = col
    ctx.lineWidth = lw
    path()
    ctx.stroke()
  }
  const dr = (shape === 'dot' ? 3.2 : on ? 2.2 : 1.5) * k * (shape === 'dot' && on ? 1.25 : 1)
  ctx.fillStyle = 'rgba(20,14,30,0.55)'
  ctx.beginPath()
  ctx.arc(x, y, dr + 1.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = col
  ctx.beginPath()
  ctx.arc(x, y, dr, 0, Math.PI * 2)
  ctx.fill()
}
