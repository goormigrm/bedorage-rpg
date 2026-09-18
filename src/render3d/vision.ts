// 시야 (덕코프식 전장의 안개). 렌더 전용 — sim 은 모든 것을 알고, 여기서 보이는 것만 그린다.
// 시야는 내(또는 우리 팀) 위치에서 360° 로 벽까지 뻗은 다각형 ∩ 반경 원. 그 밖의 바닥·벽 윗면은 어둡게 덮고,
// 적은 시야 안(벽에 가리지 않고 반경 안)일 때만 그린다. 탄·이펙트는 그대로 보인다(총성이 나는 곳을 알 수 있게).

import * as THREE from 'three'
import { GameMap, TILE, TILE_CRATE, TILE_SANDBAG, TILE_WALL, blocksSight, rayBlocked } from '../core/map'
import { CRATE_H, SANDBAG_H, WALL_H } from './world3d'

/** 시야 반경 (타일) */
export const VIEW_RADIUS_TILES = 13
export const VIEW_RADIUS_PX = VIEW_RADIUS_TILES * TILE
const RAYS = 360
/** 마스크 캔버스 해상도 (타일당 px). 넓은 맵은 낮춰서 비용을 맞춘다 */
function pxFor(map: GameMap): number {
  const tiles = map.w * map.h
  return tiles > 4000 ? 8 : tiles > 1600 ? 12 : 16
}

export interface Viewer {
  /** sim 좌표 (px) */
  x: number
  y: number
}

/** 격자 DDA: (x,y) 타일 단위에서 방향 (dx,dy) 로 벽에 닿거나 maxDist 까지 간 점 */
function castRay(map: GameMap, x: number, y: number, dx: number, dy: number, maxDist: number): { x: number; y: number } {
  let tx = Math.floor(x)
  let ty = Math.floor(y)
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity
  let tMaxX = stepX > 0 ? (tx + 1 - x) / dx : stepX < 0 ? (tx - x) / dx : Infinity
  let tMaxY = stepY > 0 ? (ty + 1 - y) / dy : stepY < 0 ? (ty - y) / dy : Infinity
  let t = 0
  let guard = map.w + map.h + 4
  while (guard-- > 0) {
    if (tMaxX < tMaxY) {
      t = tMaxX
      tMaxX += tDeltaX
      tx += stepX
    } else {
      t = tMaxY
      tMaxY += tDeltaY
      ty += stepY
    }
    if (t >= maxDist) {
      t = maxDist
      break
    }
    if (blocksSight(map, tx, ty)) break
  }
  return { x: x + dx * t, y: y + dy * t }
}

/** 시야 판정: 어느 시청자에게서든 반경 안이고 벽에 가리지 않으면 보인다 (sim 좌표 px) */
export function canSee(map: GameMap, viewers: Viewer[], x: number, y: number, radiusPx = VIEW_RADIUS_PX): boolean {
  for (const v of viewers) {
    const dx = x - v.x
    const dy = y - v.y
    if (dx * dx + dy * dy > radiusPx * radiusPx) continue
    if (!rayBlocked(map, v.x, v.y, x, y)) return true
  }
  return false
}

export class Vision {
  readonly group = new THREE.Group()
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private tex: THREE.CanvasTexture
  private mat: THREE.MeshBasicMaterial
  private sideMat: THREE.MeshBasicMaterial
  private geos: THREE.BufferGeometry[] = []
  private darkness = 'rgba(6,8,5,0.78)'

  private px: number

  constructor(readonly map: GameMap) {
    this.px = pxFor(map)
    this.canvas = document.createElement('canvas')
    this.canvas.width = map.w * this.px
    this.canvas.height = map.h * this.px
    this.ctx = this.canvas.getContext('2d')!
    this.tex = new THREE.CanvasTexture(this.canvas)
    this.tex.colorSpace = THREE.SRGBColorSpace
    this.tex.minFilter = THREE.LinearFilter
    this.tex.magFilter = THREE.LinearFilter
    this.tex.generateMipmaps = false
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false })
    this.sideMat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide })

    // 바닥 덮개
    const floorGeo = new THREE.PlaneGeometry(map.w, map.h)
    const floor = new THREE.Mesh(floorGeo, this.mat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(map.w / 2, 0.035, map.h / 2)
    floor.renderOrder = 10
    this.group.add(floor)
    this.geos.push(floorGeo)
    // 벽·상자 윗면 덮개 (타일마다 사각형, uv 는 맵 좌표)
    this.group.add(this.topQuads(TILE_WALL, WALL_H + 0.02))
    this.group.add(this.topQuads(TILE_CRATE, CRATE_H + 0.02))
    this.group.add(this.topQuads(TILE_SANDBAG, SANDBAG_H + 0.02))
    // 벽·상자 옆면 덮개: 바닥과 맞닿은 면마다 세로 사각형. 밝기는 그 앞 바닥 타일이 보이는지로 정한다
    this.group.add(this.sideQuads(TILE_WALL, WALL_H))
    this.group.add(this.sideQuads(TILE_CRATE, CRATE_H))
    this.group.add(this.sideQuads(TILE_SANDBAG, SANDBAG_H))
    this.fill([])
  }

  private sideQuads(tile: number, h: number): THREE.Mesh {
    const map = this.map
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    let n = 0
    const eps = 0.012
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (map.tiles[ty * map.w + tx] !== tile) continue
        for (const [dx, dy] of dirs) {
          const nx = tx + dx
          const ny = ty + dy
          if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue
          if (map.tiles[ny * map.w + nx] !== 0) continue // 바닥과 맞닿은 면만
          // 면의 네 꼭짓점 (바깥으로 eps 만큼 띄움)
          let ax: number, az: number, bx: number, bz: number
          if (dx === 1) { ax = tx + 1 + eps; az = ty; bx = tx + 1 + eps; bz = ty + 1 }
          else if (dx === -1) { ax = tx - eps; az = ty + 1; bx = tx - eps; bz = ty }
          else if (dy === 1) { ax = tx + 1; az = ty + 1 + eps; bx = tx; bz = ty + 1 + eps }
          else { ax = tx; az = ty - eps; bx = tx + 1; bz = ty - eps }
          pos.push(ax, 0.02, az, bx, 0.02, bz, bx, h, bz, ax, h, az)
          const u = (nx + 0.5) / map.w
          const v = 1 - (ny + 0.5) / map.h
          uv.push(u, v, u, v, u, v, u, v)
          idx.push(n, n + 1, n + 2, n, n + 2, n + 3)
          n += 4
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    const mesh = new THREE.Mesh(g, this.sideMat)
    mesh.renderOrder = 11
    this.geos.push(g)
    return mesh
  }

  private topQuads(tile: number, h: number): THREE.Mesh {
    const map = this.map
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    let n = 0
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (map.tiles[ty * map.w + tx] !== tile) continue
        const x0 = tx
        const x1 = tx + 1
        const z0 = ty
        const z1 = ty + 1
        pos.push(x0, h, z0, x1, h, z0, x1, h, z1, x0, h, z1)
        uv.push(x0 / map.w, 1 - z0 / map.h, x1 / map.w, 1 - z0 / map.h, x1 / map.w, 1 - z1 / map.h, x0 / map.w, 1 - z1 / map.h)
        idx.push(n, n + 2, n + 1, n, n + 3, n + 2)
        n += 4
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    const mesh = new THREE.Mesh(g, this.mat)
    mesh.renderOrder = 11
    this.geos.push(g)
    return mesh
  }

  /** 시청자(들) 기준으로 마스크를 다시 그린다. radius 는 타일 단위 (스코프 조준 시 넓어진다) */
  update(viewers: Viewer[], radiusTiles = VIEW_RADIUS_TILES): void {
    this.fill(viewers, radiusTiles)
  }

  private fill(viewers: Viewer[], radiusTiles = VIEW_RADIUS_TILES): void {
    const ctx = this.ctx
    const map = this.map
    const PX = this.px
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.fillStyle = this.darkness
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    // 가장자리를 부드럽게: 다각형을 지울 때만 블러를 건다 (계단 현상 제거)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.filter = `blur(${(PX * 0.35).toFixed(1)}px)`
    for (const v of viewers) {
      const cx = v.x / TILE
      const cy = v.y / TILE
      ctx.beginPath()
      for (let i = 0; i < RAYS; i++) {
        const a = (i / RAYS) * Math.PI * 2
        const p = castRay(map, cx, cy, Math.cos(a), Math.sin(a), radiusTiles)
        if (i === 0) ctx.moveTo(p.x * PX, p.y * PX)
        else ctx.lineTo(p.x * PX, p.y * PX)
      }
      ctx.closePath()
      const g = ctx.createRadialGradient(cx * PX, cy * PX, 0, cx * PX, cy * PX, radiusTiles * PX)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(0.74, 'rgba(0,0,0,1)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fill()
    }
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
    this.tex.needsUpdate = true
  }

  setVisible(v: boolean): void {
    this.group.visible = v
  }

  dispose(): void {
    this.tex.dispose()
    this.mat.dispose()
    this.sideMat.dispose()
    for (const g of this.geos) g.dispose()
  }
}
