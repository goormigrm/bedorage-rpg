import { GameMap, TILE, isWall } from './map'

/**
 * 원(반지름 r)을 (dx, dy) 만큼 옮기고 벽 타일과 겹치면 밀어낸다.
 * 모서리에 닿으면 모서리 법선 방향으로 밀어내므로 미끄러지며 지나간다. 결정론적.
 */
export function moveCircle(
  map: GameMap,
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  // 한 번에 너무 멀리 가면 터널링 → 절반씩 두 번
  if (r <= TILE * 0.6) {
    const steps = Math.abs(dx) > r * 0.8 || Math.abs(dy) > r * 0.8 ? 2 : 1
    for (let s = 0; s < steps; s++) {
      x += dx / steps
      y += dy / steps
      for (let iter = 0; iter < 2; iter++) {
        const res = resolve(map, x, y, r)
        x = res.x
        y = res.y
        if (!res.moved) break
      }
    }
    return { x, y }
  }
  // 타일보다 큰 몸(거대한 막 보스 — 몸 반지름 2칸 안팎): 반 칸보다 잘게 나눠 움직이고 여러 번 밀어낸다.
  // 그래도 중심이 벽 속 · 맵 밖이면 그 걸음은 없던 것으로 (2026-09-24 사용자: "도살자가 돌진하다 벽 밖으로 나가거나 맵에서 없어진다" —
  // 큰 원이 벽 타일 여럿에 한꺼번에 걸려 밀어내기가 엇갈리면 얇은 테두리 벽을 넘어 맵 밖으로 튀어 나갔다)
  const stepLen = TILE * 0.4
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / stepLen))
  for (let s = 0; s < steps; s++) {
    const px = x
    const py = y
    x += dx / steps
    y += dy / steps
    for (let iter = 0; iter < 4; iter++) {
      const res = resolve(map, x, y, r)
      x = res.x
      y = res.y
      if (!res.moved) break
    }
    if (x < TILE || y < TILE || x > map.pw - TILE || y > map.ph - TILE || circleHitsWall(map, x, y, r * 0.5)) {
      x = px
      y = py
      break
    }
  }
  return { x, y }
}

function resolve(map: GameMap, x: number, y: number, r: number): { x: number; y: number; moved: boolean } {
  let moved = false
  const minTx = Math.floor((x - r) / TILE)
  const maxTx = Math.floor((x + r) / TILE)
  const minTy = Math.floor((y - r) / TILE)
  const maxTy = Math.floor((y + r) / TILE)
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!isWall(map, tx, ty)) continue
      const left = tx * TILE
      const right = left + TILE
      const top = ty * TILE
      const bottom = top + TILE
      const cx = x < left ? left : x > right ? right : x
      const cy = y < top ? top : y > bottom ? bottom : y
      const ddx = x - cx
      const ddy = y - cy
      const d2 = ddx * ddx + ddy * ddy
      if (d2 >= r * r) continue
      moved = true
      if (d2 === 0) {
        // 중심이 타일 안: 가장 얕은 축으로 탈출
        const pl = x - left
        const pr = right - x
        const pt = y - top
        const pb = bottom - y
        const m = Math.min(pl, pr, pt, pb)
        if (m === pl) x = left - r
        else if (m === pr) x = right + r
        else if (m === pt) y = top - r
        else y = bottom + r
      } else if (ddx !== 0 && ddy !== 0) {
        // 모서리: 법선 방향으로 밀어냄 (슬라이딩)
        const d = Math.sqrt(d2)
        const push = r - d
        x += (ddx / d) * push
        y += (ddy / d) * push
      } else if (ddx !== 0) {
        x = ddx > 0 ? right + r : left - r
      } else {
        y = ddy > 0 ? bottom + r : top - r
      }
    }
  }
  return { x, y, moved }
}

/** 원-원 겹침 */
export function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx
  const dy = ay - by
  const r = ar + br
  return dx * dx + dy * dy < r * r
}

/** 점 (cx,cy) 에서 방향 (dx,dy) 인 직선까지의 수직 거리. 탄이 얼마나 정확히 겨눴는지 잰다. */
export function pointLineDistance(cx: number, cy: number, x0: number, y0: number, dx: number, dy: number): number {
  const l = Math.sqrt(dx * dx + dy * dy)
  if (l === 0) return Math.sqrt((cx - x0) ** 2 + (cy - y0) ** 2)
  return Math.abs(dx * (y0 - cy) - dy * (x0 - cx)) / l
}

/** 점 (cx,cy) 에서 선분 (x0,y0)-(x1,y1) 까지의 최단 거리. 부위 판정에 쓴다. */
export function pointSegDistance(
  cx: number,
  cy: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0
  const dy = y1 - y0
  const a = dx * dx + dy * dy
  if (a === 0) return Math.sqrt((cx - x0) ** 2 + (cy - y0) ** 2)
  let t = ((cx - x0) * dx + (cy - y0) * dy) / a
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return Math.sqrt((x0 + dx * t - cx) ** 2 + (y0 + dy * t - cy) ** 2)
}

/**
 * 선분 (x0,y0)-(x1,y1) 이 원(cx,cy,r) 과 만나는가. 빠른 탄의 터널링 방지.
 */
export function segmentHitsCircle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  r: number,
): boolean {
  const dx = x1 - x0
  const dy = y1 - y0
  const fx = x0 - cx
  const fy = y0 - cy
  const a = dx * dx + dy * dy
  if (a === 0) return fx * fx + fy * fy <= r * r
  let t = -(fx * dx + fy * dy) / a
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const px = x0 + dx * t - cx
  const py = y0 + dy * t - cy
  return px * px + py * py <= r * r
}

/** 원이 벽 타일과 겹치나 (옮기지 않고 보기만) */
export function circleHitsWall(map: GameMap, x: number, y: number, r: number): boolean {
  for (let ty = Math.floor((y - r) / TILE); ty <= Math.floor((y + r) / TILE); ty++) {
    for (let tx = Math.floor((x - r) / TILE); tx <= Math.floor((x + r) / TILE); tx++) {
      if (!isWall(map, tx, ty)) continue
      const cx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE))
      const cy = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE))
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r - 0.01) return true
    }
  }
  return false
}
