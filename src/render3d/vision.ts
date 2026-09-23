// 시야 (덕코프식 전장의 안개). 렌더 전용 — sim 은 모든 것을 알고, 여기서 보이는 것만 그린다.
// 시야는 내(또는 우리 팀) 위치에서 360° 로 벽까지 뻗은 다각형 ∩ 반경 원. 그 밖의 바닥·벽 윗면은 어둡게 덮고,
// 적은 시야 안(벽에 가리지 않고 반경 안)일 때만 그린다. 탄·이펙트는 그대로 보인다(총성이 나는 곳을 알 수 있게).

import * as THREE from 'three'
import { GameMap, TILE, TILE_CRATE, TILE_SANDBAG, TILE_WALL, blocksSight, rayBlocked } from '../core/map'
import { CRATE_H, SANDBAG_H, WALL_H } from './world3d'

/** 시야 반경 (타일). 13 → 15 (2026-09-23 — 카메라를 높이면서 화면 가장자리가 어둠에 먹히지 않게 같이 늘렸다) */
export const VIEW_RADIUS_TILES = 15
export const VIEW_RADIUS_PX = VIEW_RADIUS_TILES * TILE
const RAYS = 360
/** 마스크 해상도 (타일당 px). GPU 로 그리니 비용은 작다 — 넓은 맵은 조금 낮춘다 */
function pxFor(map: GameMap): number {
  const tiles = map.w * map.h
  return tiles > 4000 ? 8 : 12
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

/** 벽 끝을 부드럽게: 광선 끝에서 바깥으로 이만큼(타일) 흐려지는 띠 — 예전 캔버스 흐림(0.35 타일)을 대신한다 */
const FEATHER = 0.45
/** 한 번에 보는 사람 (파티 넷) */
const MAX_VIEWERS = 4

/**
 * 시야 마스크. **GPU 에서 그린다** (2026-09-23 최적화): 예전에는 맵 크기 캔버스(864×648 등)에 흐림 필터로 매 프레임 다시 그려
 * 통째로 WebGL 텍스처로 올렸는데, 그 복사가 한 프레임 GPU 약 10ms 로 괴물 100마리 그리기보다 비쌌다.
 * 이제 보는 사람마다 광선 부채꼴(가장자리 흐림 띠 포함)을 작은 렌더 타깃에 MAX 섞기로 그린다 — 삼각형 천여 개.
 * 마스크의 R = 보임(0~1). 덮개 재질이 어둠색 · (1 - 보임) × 진하기로 칠한다. 보는 자리 · 반경이 그대로면 다시 그리지 않는다.
 */
export class Vision {
  readonly group = new THREE.Group()
  private rt: THREE.WebGLRenderTarget | null = null
  private mat: THREE.ShaderMaterial
  private sideMat: THREE.ShaderMaterial
  private geos: THREE.BufferGeometry[] = []
  private fogScene = new THREE.Scene()
  private fogCam: THREE.OrthographicCamera
  private fans: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; pos: Float32Array; alpha: Float32Array; mat: THREE.ShaderMaterial }[] = []
  private key = ''
  private dirty = true
  private px: number
  private readonly clear = new THREE.Color()

  constructor(readonly map: GameMap) {
    this.px = pxFor(map)
    // 던전은 시야 밖이 더 캄캄하다 (디아블로의 빛 반경 느낌)
    const fogAlpha = map.theme.dark ? map.theme.dark.fogAlpha : 0.78
    const fogColor = map.theme.dark ? new THREE.Vector3(3 / 255, 3 / 255, 5 / 255) : new THREE.Vector3(6 / 255, 8 / 255, 5 / 255)
    const cover = (side: boolean) =>
      new THREE.ShaderMaterial({
        uniforms: { mask: { value: null }, color: { value: fogColor }, alpha: { value: fogAlpha } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader:
          'uniform sampler2D mask; uniform vec3 color; uniform float alpha; varying vec2 vUv;' +
          'void main() { float v = texture2D(mask, vUv).r; gl_FragColor = vec4(color, alpha * (1.0 - v)); }',
        transparent: true,
        depthWrite: false,
        side: side ? THREE.DoubleSide : THREE.FrontSide,
      })
    this.mat = cover(false)
    this.sideMat = cover(true)
    // 마스크 좌표 = 타일 (x 오른쪽, y 아래). 덮개 uv 는 (x / w, 1 - y / h)
    this.fogCam = new THREE.OrthographicCamera(0, map.w, 0, map.h, -10, 10)
    for (let i = 0; i < MAX_VIEWERS; i++) this.fans.push(this.makeFan())

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
  }

  /** 보는 사람 하나의 부채꼴: 가운데 1 + 광선 끝 RAYS + 흐림 띠 끝 RAYS */
  private makeFan(): Vision['fans'][number] {
    const n = 1 + RAYS * 2
    const pos = new Float32Array(n * 3)
    const alpha = new Float32Array(n)
    const idx: number[] = []
    for (let i = 0; i < RAYS; i++) {
      const c0 = 1 + i
      const c1 = 1 + ((i + 1) % RAYS)
      const f0 = 1 + RAYS + i
      const f1 = 1 + RAYS + ((i + 1) % RAYS)
      idx.push(0, c0, c1, c0, f0, c1, c1, f0, f1)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('edge', new THREE.BufferAttribute(alpha, 1))
    geo.setIndex(idx)
    const mat = new THREE.ShaderMaterial({
      uniforms: { center: { value: new THREE.Vector2() }, radius: { value: VIEW_RADIUS_TILES } },
      vertexShader:
        'attribute float edge; varying float vEdge; varying vec2 vP;' +
        'void main() { vEdge = edge; vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // 반경의 74% 부터 가장자리까지 옅어진다 (예전 캔버스 방사 그라데이션과 같다)
      fragmentShader:
        'uniform vec2 center; uniform float radius; varying float vEdge; varying vec2 vP;' +
        'void main() { float d = distance(vP, center); float v = vEdge * (1.0 - smoothstep(radius * 0.74, radius, d)); gl_FragColor = vec4(v, v, v, 1.0); }',
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.frustumCulled = false
    mesh.visible = false
    this.fogScene.add(mesh)
    return { mesh, geo, pos, alpha, mat }
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

  /** 시청자(들) 기준으로 마스크 모양을 다시 잰다. radius 는 타일 단위 (스코프 조준 시 넓어진다). 그리기는 draw() */
  update(viewers: Viewer[], radiusTiles = VIEW_RADIUS_TILES): void {
    // 보는 자리(2px 단위) · 반경이 그대로면 그대로 둔다 — 서 있을 때는 광선도 그리기도 없다
    let key = radiusTiles.toFixed(2)
    for (let i = 0; i < viewers.length && i < MAX_VIEWERS; i++) key += '|' + Math.round(viewers[i].x / 2) + ',' + Math.round(viewers[i].y / 2)
    if (key === this.key) return
    this.key = key
    this.dirty = true
    const map = this.map
    for (let k = 0; k < MAX_VIEWERS; k++) {
      const f = this.fans[k]
      const v = viewers[k]
      f.mesh.visible = !!v
      if (!v) continue
      const cx = v.x / TILE
      const cy = v.y / TILE
      f.pos[0] = cx
      f.pos[1] = cy
      f.alpha[0] = 1
      for (let i = 0; i < RAYS; i++) {
        const a = (i / RAYS) * Math.PI * 2
        const dx = Math.cos(a)
        const dy = Math.sin(a)
        const p = castRay(map, cx, cy, dx, dy, radiusTiles)
        const o = (1 + i) * 3
        f.pos[o] = p.x
        f.pos[o + 1] = p.y
        f.alpha[1 + i] = 1
        const q = (1 + RAYS + i) * 3
        f.pos[q] = p.x + dx * FEATHER
        f.pos[q + 1] = p.y + dy * FEATHER
        f.alpha[1 + RAYS + i] = 0
      }
      ;(f.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
      ;(f.geo.attributes.edge as THREE.BufferAttribute).needsUpdate = true
      f.mat.uniforms.center.value.set(cx, cy)
      f.mat.uniforms.radius.value = radiusTiles
    }
  }

  /** 바뀌었으면 마스크를 렌더 타깃에 그린다 (본 장면을 그리기 전에) */
  draw(gl: THREE.WebGLRenderer): void {
    if (!this.rt) {
      const w = Math.min(2048, this.map.w * this.px)
      const h = Math.min(2048, this.map.h * this.px)
      this.rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
      this.mat.uniforms.mask.value = this.rt.texture
      this.sideMat.uniforms.mask.value = this.rt.texture
      this.dirty = true
    }
    if (!this.dirty) return
    this.dirty = false
    const prevRt = gl.getRenderTarget()
    gl.getClearColor(this.clear)
    const prevA = gl.getClearAlpha()
    gl.setRenderTarget(this.rt)
    gl.setClearColor(0x000000, 1)
    gl.clear(true, false, false)
    gl.render(this.fogScene, this.fogCam)
    gl.setRenderTarget(prevRt)
    gl.setClearColor(this.clear, prevA)
  }

  setVisible(v: boolean): void {
    this.group.visible = v
  }

  dispose(): void {
    this.rt?.dispose()
    this.mat.dispose()
    this.sideMat.dispose()
    for (const g of this.geos) g.dispose()
    for (const f of this.fans) {
      f.geo.dispose()
      f.mat.dispose()
    }
  }
}
