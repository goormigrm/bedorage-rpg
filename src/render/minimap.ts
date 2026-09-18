// 맵 타일을 작은 캔버스에 그린다. 게임 중 미니맵과 로비 맵 미리보기가 같이 쓴다.

import { GameMap, TILE_CRATE, TILE_FLOOR, TILE_SANDBAG, TILE_WALL } from '../core/map'

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0')
}

/** 타일 1개 = 1px 캔버스 */
export function renderMapTiles(map: GameMap): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = map.w
  c.height = map.h
  const g = c.getContext('2d')!
  g.fillStyle = hex(map.theme.floor)
  g.fillRect(0, 0, map.w, map.h)
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const t = map.tiles[ty * map.w + tx]
      if (t === TILE_FLOOR) continue
      g.fillStyle =
        t === TILE_WALL ? hex(map.theme.wall) : t === TILE_CRATE ? hex(map.theme.crate) : t === TILE_SANDBAG ? '#efe4bd' : '#888'
      g.fillRect(tx, ty, 1, 1)
    }
  }
  return c
}

/** 로비 미리보기: 캔버스에 맵을 꽉 차게 그린다 (스폰 지점은 노란 점) */
export function drawMapPreview(canvas: HTMLCanvasElement, map: GameMap): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = canvas.clientWidth || 260
  const h = canvas.clientHeight || 150
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const tiles = renderMapTiles(map)
  const sc = Math.min(w / map.w, h / map.h)
  const dw = map.w * sc
  const dh = map.h * sc
  const ox = (w - dw) / 2
  const oy = (h - dh) / 2
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tiles, ox, oy, dw, dh)
  ctx.fillStyle = 'rgba(255,216,74,0.9)'
  for (const sp of map.spawns.slice(0, 8)) {
    ctx.beginPath()
    ctx.arc(ox + (sp.x / 32) * sc, oy + (sp.y / 32) * sc, 2, 0, Math.PI * 2)
    ctx.fill()
  }
}
