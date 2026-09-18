// 맵 → 3D 월드 (바닥, 벽, 상자, 조명). 단위 1 = 타일 한 칸. sim 좌표 (px) → 월드: x/32, y/32 → (x, 0, z)

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GameMap, TILE, TILE_CRATE, TILE_SANDBAG, TILE_WALL } from '../core/map'

export const WALL_H = 1.8
export const CRATE_H = 0.75
/** 모래주머니 높이 (허리 높이 엄폐물) */
export const SANDBAG_H = 0.52
export const U = 1 / TILE

export interface World3D {
  group: THREE.Group
  sun: THREE.DirectionalLight
  /** 부서진 모래주머니를 화면에서 지운다 */
  breakSandbag(tx: number, ty: number): void
  /** 남은 내구도 비율(0~1)에 따라 색을 어둡게 — 곧 터진다는 신호 */
  setSandbagHealth(tx: number, ty: number, k: number): void
  dispose(): void
}

export function buildWorld(map: GameMap): World3D {
  const t = map.theme
  const group = new THREE.Group()

  // ---- 바닥 (캔버스 텍스처: 타일 색 변화 + 격자) ----
  const fc = document.createElement('canvas')
  const px = 16
  fc.width = map.w * px
  fc.height = map.h * px
  const g = fc.getContext('2d')!
  g.fillStyle = hex(t.floor)
  g.fillRect(0, 0, fc.width, fc.height)
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0
      if (h % 7 === 0) {
        g.fillStyle = hex(t.floorAlt)
        g.fillRect(tx * px, ty * px, px, px)
      }
    }
  }
  g.strokeStyle = hex(t.floorLine)
  g.lineWidth = 1
  g.beginPath()
  for (let x = 0; x <= map.w; x++) {
    g.moveTo(x * px + 0.5, 0)
    g.lineTo(x * px + 0.5, fc.height)
  }
  for (let y = 0; y <= map.h; y++) {
    g.moveTo(0, y * px + 0.5)
    g.lineTo(fc.width, y * px + 0.5)
  }
  g.stroke()
  const floorTex = new THREE.CanvasTexture(fc)
  floorTex.colorSpace = THREE.SRGBColorSpace
  floorTex.anisotropy = 8
  floorTex.magFilter = THREE.LinearFilter
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(map.w, map.h),
    new THREE.MeshLambertMaterial({ map: floorTex }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.set(map.w / 2, 0, map.h / 2)
  floor.receiveShadow = true
  group.add(floor)

  // 맵 밖 바닥 (넓게, 어둡게)
  const outside = new THREE.Mesh(
    new THREE.PlaneGeometry(map.w * 4, map.h * 4),
    new THREE.MeshLambertMaterial({ color: t.outside }),
  )
  outside.rotation.x = -Math.PI / 2
  outside.position.set(map.w / 2, -0.02, map.h / 2)
  outside.receiveShadow = true
  group.add(outside)

  // ---- 벽 / 상자 (인스턴스) ----
  let wallCount = 0
  let crateCount = 0
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] === TILE_WALL) wallCount++
    else if (map.tiles[i] === TILE_CRATE) crateCount++
  }
  const wallSide = new THREE.MeshLambertMaterial({ color: t.wall })
  const wallTop = new THREE.MeshLambertMaterial({ color: t.wallTop })
  const wallGeo = new THREE.BoxGeometry(1, WALL_H, 1)
  const walls = new THREE.InstancedMesh(wallGeo, [wallSide, wallSide, wallTop, wallSide, wallSide, wallSide], Math.max(1, wallCount))
  walls.castShadow = true
  walls.receiveShadow = true
  let bagCount = 0
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE_SANDBAG) bagCount++
  const crateM = new THREE.MeshLambertMaterial({ color: t.crate })
  const crateTopM = new THREE.MeshLambertMaterial({ color: lighten(t.crate, 1.18) })
  const crateGeo = new THREE.BoxGeometry(0.92, CRATE_H, 0.92)
  const crates = new THREE.InstancedMesh(crateGeo, [crateM, crateM, crateTopM, crateM, crateM, crateM], Math.max(1, crateCount))
  crates.castShadow = true
  crates.receiveShadow = true
  const m4 = new THREE.Matrix4()
  let wi = 0
  let ci = 0
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const tile = map.tiles[ty * map.w + tx]
      if (tile === TILE_WALL) {
        m4.makeTranslation(tx + 0.5, WALL_H / 2, ty + 0.5)
        walls.setMatrixAt(wi++, m4)
      } else if (tile === TILE_CRATE) {
        m4.makeTranslation(tx + 0.5, CRATE_H / 2, ty + 0.5)
        crates.setMatrixAt(ci++, m4)
      }
    }
  }
  walls.count = wallCount
  crates.count = crateCount
  walls.instanceMatrix.needsUpdate = true
  crates.instanceMatrix.needsUpdate = true
  group.add(walls, crates)

  // ---- 모래주머니 (허리 높이 엄폐물) ----
  // 그냥 네모가 아니라 '자루를 쌓아 놓은 더미' 로 보이도록 눌린 구를 두 줄로 합쳐 쓴다
  const bagM = new THREE.MeshLambertMaterial({ color: 0xdcd3b4 })
  const bagGeo = sandbagStackGeometry()
  const bags = new THREE.InstancedMesh(bagGeo, bagM, Math.max(1, bagCount))
  bags.castShadow = true
  bags.receiveShadow = true
  const bagIndex = new Map<number, number>()
  let bi = 0
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (map.tiles[ty * map.w + tx] !== TILE_SANDBAG) continue
      // 지오메트리가 y=0 에서 시작하므로 바닥 높이 그대로 놓는다 (올리면 떠 보인다)
      m4.makeTranslation(tx + 0.5, 0, ty + 0.5)
      bags.setMatrixAt(bi, m4)
      bagIndex.set(ty * map.w + tx, bi)
      bi++
    }
  }
  bags.count = bagCount
  bags.instanceMatrix.needsUpdate = true
  const white = new THREE.Color(1, 1, 1)
  for (let i = 0; i < Math.max(1, bagCount); i++) bags.setColorAt(i, white)
  if (bags.instanceColor) bags.instanceColor.needsUpdate = true
  group.add(bags)

  // 벽 윗면 테두리 느낌: 벽보다 살짝 큰 어두운 밑단 (바닥 그림자 대용)
  const skirtGeo = new THREE.BoxGeometry(1.06, 0.06, 1.06)
  const skirt = new THREE.InstancedMesh(skirtGeo, new THREE.MeshLambertMaterial({ color: darken(t.wall, 0.6) }), Math.max(1, wallCount))
  wi = 0
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (map.tiles[ty * map.w + tx] === TILE_WALL) {
        m4.makeTranslation(tx + 0.5, 0.03, ty + 0.5)
        skirt.setMatrixAt(wi++, m4)
      }
    }
  }
  skirt.count = wallCount
  skirt.instanceMatrix.needsUpdate = true
  group.add(skirt)

  // ---- 조명 ----
  const hemi = new THREE.HemisphereLight(t.ambientColor, darken(t.floor, 0.5), 0.9)
  group.add(hemi)
  const sun = new THREE.DirectionalLight(t.sunColor, 2.2)
  sun.position.set(8, 18, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 60
  sun.shadow.camera.left = -18
  sun.shadow.camera.right = 18
  sun.shadow.camera.top = 18
  sun.shadow.camera.bottom = -18
  sun.shadow.bias = -0.0008
  sun.shadow.normalBias = 0.02
  group.add(sun)
  group.add(sun.target)

  const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
  const tint = new THREE.Color()
  return {
    group,
    sun,
    breakSandbag(tx: number, ty: number) {
      const id = bagIndex.get(ty * map.w + tx)
      if (id === undefined) return
      bags.setMatrixAt(id, hidden)
      bags.instanceMatrix.needsUpdate = true
      bagIndex.delete(ty * map.w + tx)
    },
    setSandbagHealth(tx: number, ty: number, k: number) {
      const id = bagIndex.get(ty * map.w + tx)
      if (id === undefined) return
      // 성할 때는 원래 색, 닳을수록 어둡고 붉게
      const t = Math.max(0, Math.min(1, k))
      tint.setRGB(0.55 + 0.45 * t, 0.42 + 0.58 * t, 0.36 + 0.64 * t)
      bags.setColorAt(id, tint)
      if (bags.instanceColor) bags.instanceColor.needsUpdate = true
    },
    dispose() {
      floorTex.dispose()
      wallGeo.dispose()
      crateGeo.dispose()
      bagGeo.dispose()
      skirtGeo.dispose()
    },
  }
}

/** 자루 6개(아래 4 + 위 2)를 쌓은 더미 하나. 타일 1칸 크기 */
function sandbagStackGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const bag = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rot: number) => {
    const g = new THREE.SphereGeometry(0.5, 9, 7)
    g.scale(sx, sy, sz)
    g.rotateY(rot)
    g.translate(x, y, z)
    parts.push(g)
  }
  // 실제 모래주머니 방벽처럼 3 - 2 - 3 세 단. 가운데 단은 이음매가 어긋나도록 반 자루씩 밀어 쌓는다.
  // 지오메트리 바닥이 y = 0 이어야 바닥에 딱 붙는다 (instance 는 y=0 에 놓는다).
  const h = SANDBAG_H
  const tier = h / 3
  const sy = tier * 1.16 // 살짝 겹쳐 단 사이가 벌어져 보이지 않게
  // 1단 (바닥) — 세 자루
  bag(0, tier * 0.5, -0.3, 0.9, sy, 0.31, 0.05)
  bag(0, tier * 0.5, 0.0, 0.9, sy, 0.31, -0.04)
  bag(0, tier * 0.5, 0.3, 0.9, sy, 0.31, 0.06)
  // 2단 — 두 자루, 이음매를 어긋나게 (조금 넓게 눕힌다)
  bag(0.02, tier * 1.5, -0.16, 0.86, sy, 0.34, -0.07)
  bag(-0.02, tier * 1.5, 0.16, 0.86, sy, 0.34, 0.08)
  // 3단 (위) — 세 자루, 조금 좁게 쌓여 위로 갈수록 살짝 좁아진다
  bag(0, tier * 2.5, -0.27, 0.78, sy, 0.29, -0.06)
  bag(0, tier * 2.5, 0.0, 0.78, sy, 0.29, 0.07)
  bag(0, tier * 2.5, 0.27, 0.78, sy, 0.29, -0.05)
  return mergeGeometries(parts, false) ?? parts[0]
}

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0')
}
function darken(c: number, k: number): number {
  const r = Math.round(((c >> 16) & 255) * k)
  const g = Math.round(((c >> 8) & 255) * k)
  const b = Math.round((c & 255) * k)
  return (r << 16) | (g << 8) | b
}
function lighten(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k))
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k))
  const b = Math.min(255, Math.round((c & 255) * k))
  return (r << 16) | (g << 8) | b
}
