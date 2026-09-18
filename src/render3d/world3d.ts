// 맵 → 3D 월드 (바닥, 벽, 장애물, 소품, 횃불, 조명). 단위 1 = 타일 한 칸. sim 좌표 (px) → 월드: x/32, y/32 → (x, 0, z)
//
// 분위기(GUIDE 11장 — D2 "첫인상"): 상자 벽 금지. 지역 테마(`theme.style`)마다
//   돌벽(지하 묘지·성당·도살장) · 바위(들판·굴) · 목책과 천막(마을)으로 벽을 세우고, 장애물(상자 타일)은 관·돌무더기·통·도마로,
//   바닥은 판석·흙·바위에 금·핏자국·이끼를 칠하고, 뼈·해골·양초·풀·묘비 같은 **밟히지 않는 소품**을 흩뿌린다.
//   벽에는 횃불 — 가까운 여섯 개만 진짜 빛(성능), 나머지는 불꽃만.
// 전부 타일 좌표 해시로 정하므로 같은 맵이면 모든 브라우저에서 같은 모습이다(화면만의 일 — sim 과 무관).
// 덕의 대전 맵(style 없음)은 예전 상자 모습 그대로.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GameMap, TILE, TILE_CRATE, TILE_FLOOR, TILE_SANDBAG, TILE_WALL } from '../core/map'
import { MAPS, WorldStyle } from '../core/maps'

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
  /** 매 프레임: 횃불·모닥불 깜빡임, 가까운 횃불에 빛 옮기기 (x, z = 카메라가 보는 곳) */
  update(t: number, x: number, z: number): void
  dispose(): void
}

/** 타일 좌표 해시 (0..1) — 같은 맵이면 같은 모습 */
function hash(tx: number, ty: number, salt = 0): number {
  let h = (Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663) ^ Math.imul(salt + 1, 83492791)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

export function buildWorld(map: GameMap): World3D {
  const style = map.theme.style
  return style ? buildDark(map, style) : buildClassic(map)
}

// ================================================================ 어두운 지역 (디아블로)

/** 테마별 재료 */
const LOOK: Record<WorldStyle, {
  wall: 'stone' | 'rock' | 'town' | 'tree'
  wallH: [number, number]
  floor: 'flag' | 'marble' | 'dirt' | 'rock' | 'earth'
  crate: 'coffin' | 'rubble' | 'table' | 'boulder' | 'barrel'
  props: ('bone' | 'skull' | 'candle' | 'grass' | 'tomb' | 'blood' | 'straw' | 'shroom')[]
  decal: { crack: number; blood: number; moss: number }
  torches: number
}> = {
  crypt: { wall: 'stone', wallH: [1.7, 2.0], floor: 'flag', crate: 'coffin', props: ['bone', 'skull', 'candle'], decal: { crack: 0.12, blood: 0.03, moss: 0.08 }, torches: 0.09 },
  cathedral: { wall: 'stone', wallH: [2.2, 2.6], floor: 'marble', crate: 'rubble', props: ['candle', 'bone', 'skull'], decal: { crack: 0.1, blood: 0.02, moss: 0.03 }, torches: 0.11 },
  butchery: { wall: 'stone', wallH: [1.8, 2.1], floor: 'flag', crate: 'table', props: ['bone', 'skull', 'blood'], decal: { crack: 0.08, blood: 0.14, moss: 0.02 }, torches: 0.12 },
  fields: { wall: 'rock', wallH: [0.9, 1.6], floor: 'dirt', crate: 'boulder', props: ['grass', 'tomb', 'bone'], decal: { crack: 0.02, blood: 0.02, moss: 0.1 }, torches: 0 },
  cave: { wall: 'rock', wallH: [1.6, 2.3], floor: 'rock', crate: 'boulder', props: ['bone', 'skull'], decal: { crack: 0.08, blood: 0.03, moss: 0.06 }, torches: 0.05 },
  forest: { wall: 'tree', wallH: [2.2, 3.4], floor: 'dirt', crate: 'boulder', props: ['grass', 'shroom', 'bone'], decal: { crack: 0.01, blood: 0.02, moss: 0.2 }, torches: 0 },
  town: { wall: 'town', wallH: [1.9, 1.9], floor: 'earth', crate: 'barrel', props: ['straw', 'grass'], decal: { crack: 0.01, blood: 0, moss: 0.03 }, torches: 0.12 },
}

function buildDark(map: GameMap, style: WorldStyle): World3D {
  const t = map.theme
  const look = LOOK[style]
  const group = new THREE.Group()
  const disposables: { dispose(): void }[] = []
  const isFloor = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && map.tiles[ty * map.w + tx] === TILE_FLOOR
  const isWall = (tx: number, ty: number) => tx < 0 || ty < 0 || tx >= map.w || ty >= map.h || map.tiles[ty * map.w + tx] === TILE_WALL

  // ---- 바닥 ----
  const floorTex = paintFloor(map, style)
  disposables.push(floorTex)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.w, map.h), new THREE.MeshLambertMaterial({ map: floorTex }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(map.w / 2, 0, map.h / 2)
  floor.receiveShadow = true
  group.add(floor)
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(map.w * 4, map.h * 4), new THREE.MeshLambertMaterial({ color: t.outside }))
  outside.rotation.x = -Math.PI / 2
  outside.position.set(map.w / 2, -0.02, map.h / 2)
  group.add(outside)

  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const col = new THREE.Color()
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], n: number, shadow = true) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n))
    m.castShadow = shadow
    m.receiveShadow = true
    m.count = 0
    disposables.push(geo)
    group.add(m)
    return m
  }
  const put = (m: THREE.InstancedMesh, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0, color?: THREE.Color) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY)
    m4.compose(pos.set(x, y, z), q, scl.set(sx, sy, sz))
    m.setMatrixAt(m.count, m4)
    if (color) m.setColorAt(m.count, color)
    m.count++
  }

  // ---- 벽 ----
  const walls: [number, number][] = []
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) if (map.tiles[ty * map.w + tx] === TILE_WALL) walls.push([tx, ty])
  const [h0, h1] = look.wallH
  // 안쪽(바닥과 닿은) 벽만 그린다 — 맵 밖 테두리 덩어리는 어둠에 묻힌다
  const touching = (tx: number, ty: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isFloor(tx + dx, ty + dy) || map.tiles[(ty + dy) * map.w + tx + dx] === TILE_CRATE) return true
    return false
  }
  const vis = walls.filter(([tx, ty]) => touching(tx, ty))
  if (look.wall === 'stone') {
    const side = new THREE.MeshLambertMaterial({ color: 0xffffff })
    const block = inst(new THREE.BoxGeometry(1, 1, 1), side, vis.length)
    const cap = inst(new THREE.BoxGeometry(1.08, 0.14, 1.08), new THREE.MeshLambertMaterial({ color: 0xffffff }), vis.length)
    const base = new THREE.Color(t.wall)
    const top = new THREE.Color(t.wallTop)
    for (const [tx, ty] of vis) {
      const h = h0 + (h1 - h0) * hash(tx, ty, 1)
      const k = 0.82 + 0.3 * hash(tx, ty, 2)
      put(block, tx + 0.5, h / 2, ty + 0.5, 1, h, 1, 0, col.copy(base).multiplyScalar(k))
      put(cap, tx + 0.5, h + 0.07, ty + 0.5, 1, 1, 1, 0, col.copy(top).multiplyScalar(0.85 + 0.25 * hash(tx, ty, 3)))
    }
    // 무너진 모서리: 벽 끝(이웃 벽이 하나뿐)에 돌 부스러기
    const rubble = inst(new THREE.DodecahedronGeometry(0.22, 0), new THREE.MeshLambertMaterial({ color: t.wallTop }), vis.length)
    for (const [tx, ty] of vis) {
      let n = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isWall(tx + dx, ty + dy)) n++
      if (n !== 1 || hash(tx, ty, 4) > 0.6) continue
      for (let k = 0; k < 3; k++) {
        const a = hash(tx, ty, 10 + k) * Math.PI * 2
        put(rubble, tx + 0.5 + Math.cos(a) * 0.7, 0.1, ty + 0.5 + Math.sin(a) * 0.7, 1, 0.7, 1, a)
      }
    }
  } else if (look.wall === 'rock') {
    const rock = inst(new THREE.IcosahedronGeometry(0.62, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), vis.length)
    const base = new THREE.Color(t.wall)
    for (const [tx, ty] of vis) {
      const h = h0 + (h1 - h0) * hash(tx, ty, 1)
      put(rock, tx + 0.5 + (hash(tx, ty, 5) - 0.5) * 0.2, h * 0.42, ty + 0.5 + (hash(tx, ty, 6) - 0.5) * 0.2, 1.05 + hash(tx, ty, 7) * 0.2, h * 0.85, 1.05 + hash(tx, ty, 8) * 0.2, hash(tx, ty, 9) * 6.28, col.copy(base).multiplyScalar(0.75 + 0.45 * hash(tx, ty, 2)))
    }
    // 들판: 바위 사이 죽은 나무
    if (style === 'fields') {
      const trunkGeo = mergeGeometries([
        new THREE.CylinderGeometry(0.06, 0.12, 2.2, 5).translate(0, 1.1, 0),
        new THREE.CylinderGeometry(0.03, 0.06, 0.9, 4).rotateZ(0.9).translate(0.32, 1.6, 0),
        new THREE.CylinderGeometry(0.03, 0.05, 0.8, 4).rotateZ(-1.0).translate(-0.3, 1.35, 0),
        new THREE.CylinderGeometry(0.02, 0.04, 0.6, 4).rotateX(0.8).translate(0, 1.85, 0.2),
      ])!
      const trees = inst(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x2a221c }), vis.length)
      for (const [tx, ty] of vis) if (hash(tx, ty, 20) < 0.12) put(trees, tx + 0.5, 0, ty + 0.5, 1, 0.8 + hash(tx, ty, 21) * 0.6, 1, hash(tx, ty, 22) * 6.28)
    }
  } else if (look.wall === 'tree') {
    // 숲: 벽 칸마다 전나무 (줄기 + 겹친 잎 원뿔 셋). 높이·색이 저마다
    const trunk = inst(new THREE.CylinderGeometry(0.1, 0.16, 1, 6).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0x2e2218 }), vis.length)
    const leafGeo = mergeGeometries([
      new THREE.ConeGeometry(0.72, 1.1, 7).translate(0, 1.0, 0),
      new THREE.ConeGeometry(0.58, 0.95, 7).translate(0, 1.55, 0),
      new THREE.ConeGeometry(0.4, 0.8, 7).translate(0, 2.05, 0),
    ])!
    const leaves = inst(leafGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), vis.length)
    const base = new THREE.Color(t.wall)
    for (const [tx, ty] of vis) {
      const h = (h0 + (h1 - h0) * hash(tx, ty, 1)) / 2.4
      const x = tx + 0.5 + (hash(tx, ty, 5) - 0.5) * 0.25
      const z = ty + 0.5 + (hash(tx, ty, 6) - 0.5) * 0.25
      put(trunk, x, 0, z, 1, 0.9 * h, 1)
      put(leaves, x, 0, z, 1 + hash(tx, ty, 7) * 0.2, h, 1 + hash(tx, ty, 8) * 0.2, hash(tx, ty, 9) * 6.28, col.copy(base).multiplyScalar(0.8 + 0.5 * hash(tx, ty, 2)))
    }
  } else {
    // 마을: 테두리는 목책(끝이 뾰족한 말뚝), 안쪽 벽 덩어리는 천막
    const stakeGeo = mergeGeometries([new THREE.CylinderGeometry(0.13, 0.15, 1.7, 6).translate(0, 0.85, 0), new THREE.ConeGeometry(0.13, 0.35, 6).translate(0, 1.87, 0)])!
    const stakes = inst(stakeGeo, new THREE.MeshLambertMaterial({ color: 0x5a4330 }), vis.length * 3)
    const clusters = wallClusters(map)
    for (const [tx, ty] of vis) {
      const border = tx <= 3 || ty <= 3 || tx >= map.w - 4 || ty >= map.h - 4
      if (!border && clusters.has(ty * map.w + tx)) continue
      for (let k = 0; k < 3; k++) put(stakes, tx + 0.2 + k * 0.3, 0, ty + 0.5 + (hash(tx, ty, k) - 0.5) * 0.3, 1, 0.85 + hash(tx, ty, 10 + k) * 0.3, 1, hash(tx, ty, 20 + k) * 6)
    }
    // 천막: 덩어리마다 하나 — 천 벽 + 박공 지붕 + 꼭대기 깃발
    const cloths = [0x6a4a3a, 0x4a4a3a, 0x5a3a3a, 0x4a3e52, 0x3e4a44]
    let ci = 0
    for (const c of clusters.values()) {
      if (c.done) continue
      c.done = true
      const w = c.x1 - c.x0 + 1
      const d = c.y1 - c.y0 + 1
      if (c.x0 <= 3 || c.y0 <= 3 || c.x1 >= map.w - 4 || c.y1 >= map.h - 4) continue
      const color = cloths[ci++ % cloths.length]
      const cloth = new THREE.MeshLambertMaterial({ color })
      const body = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 1.0, d - 0.1), cloth)
      body.position.set(c.x0 + w / 2, 0.5, c.y0 + d / 2)
      body.castShadow = true
      const roofGeo = new THREE.CylinderGeometry(0.01, (Math.min(w, d) / 2) * 1.15, 1.2, 4, 1)
      roofGeo.rotateY(Math.PI / 4)
      roofGeo.scale(w / Math.min(w, d), 1, d / Math.min(w, d))
      const roof = new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(1.25) }))
      roof.position.set(c.x0 + w / 2, 1.6, c.y0 + d / 2)
      roof.castShadow = true
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4), new THREE.MeshLambertMaterial({ color: 0x3a2a1a }))
      pole.position.set(c.x0 + w / 2, 2.55, c.y0 + d / 2)
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshLambertMaterial({ color: 0x8a2a22, side: THREE.DoubleSide }))
      flag.position.set(c.x0 + w / 2 + 0.26, 2.85, c.y0 + d / 2)
      group.add(body, roof, pole, flag)
      disposables.push(body.geometry, roofGeo, pole.geometry, flag.geometry)
    }
  }

  // ---- 장애물 (상자 타일) ----
  const crates: [number, number][] = []
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) if (map.tiles[ty * map.w + tx] === TILE_CRATE) crates.push([tx, ty])
  const fire = MAPS[map.id]?.fire
  const isFire = (tx: number, ty: number) => !!fire && tx >= fire[0] && tx < fire[0] + 2 && ty >= fire[1] && ty < fire[1] + 2
  const cc = new THREE.Color(t.crate)
  if (look.crate === 'coffin') {
    const box = inst(new THREE.BoxGeometry(0.62, 0.5, 0.95), new THREE.MeshLambertMaterial({ color: 0xffffff }), crates.length)
    const lid = inst(new THREE.BoxGeometry(0.7, 0.1, 1.02), new THREE.MeshLambertMaterial({ color: 0xffffff }), crates.length)
    for (const [tx, ty] of crates) {
      const r = hash(tx, ty, 1) < 0.5 ? 0 : Math.PI / 2
      const k = 0.85 + hash(tx, ty, 2) * 0.25
      put(box, tx + 0.5, 0.25, ty + 0.5, 1, 1, 1, r, col.copy(cc).multiplyScalar(k))
      // 뚜껑이 비껴 열린 관
      const off = hash(tx, ty, 3) < 0.35 ? 0.3 : 0
      put(lid, tx + 0.5 + (r ? off : 0), 0.55, ty + 0.5 + (r ? 0 : off), 1, 1, 1, r + off * 0.6, col.copy(cc).multiplyScalar(k * 1.15))
    }
  } else if (look.crate === 'barrel') {
    const barrel = inst(new THREE.CylinderGeometry(0.3, 0.26, 0.72, 10).translate(0, 0.36, 0), new THREE.MeshLambertMaterial({ color: 0x6a4a2e }), crates.length * 2)
    for (const [tx, ty] of crates) {
      if (isFire(tx, ty)) continue
      put(barrel, tx + 0.32, 0, ty + 0.4, 1, 1, 1)
      if (hash(tx, ty, 1) < 0.6) put(barrel, tx + 0.7, 0, ty + 0.62, 0.9, 0.9, 0.9)
    }
  } else if (look.crate === 'table') {
    const table = inst(new THREE.BoxGeometry(0.95, 0.12, 0.8), new THREE.MeshLambertMaterial({ color: 0x4a3226 }), crates.length)
    const leg = inst(new THREE.BoxGeometry(0.1, 0.62, 0.1), new THREE.MeshLambertMaterial({ color: 0x2e2018 }), crates.length * 2)
    const meat = inst(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshLambertMaterial({ color: 0x7a2420 }), crates.length)
    for (const [tx, ty] of crates) {
      put(table, tx + 0.5, 0.68, ty + 0.5, 1, 1, 1)
      put(leg, tx + 0.12, 0.31, ty + 0.5, 1, 1, 6)
      put(leg, tx + 0.88, 0.31, ty + 0.5, 1, 1, 6)
      if (hash(tx, ty, 1) < 0.7) put(meat, tx + 0.4, 0.82, ty + 0.5, 1.3, 0.6, 1)
    }
  } else {
    // 돌무더기 · 바위
    const rock = inst(new THREE.DodecahedronGeometry(0.42, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), crates.length * 2)
    for (const [tx, ty] of crates) {
      put(rock, tx + 0.5, 0.3, ty + 0.5, 1.1, 0.8 + hash(tx, ty, 1) * 0.4, 1.1, hash(tx, ty, 2) * 6, col.copy(cc).multiplyScalar(0.8 + 0.3 * hash(tx, ty, 3)))
      if (hash(tx, ty, 4) < 0.5) put(rock, tx + 0.2 + hash(tx, ty, 5) * 0.6, 0.18, ty + 0.2 + hash(tx, ty, 6) * 0.6, 0.6, 0.5, 0.6, hash(tx, ty, 7) * 6, col.copy(cc).multiplyScalar(0.7))
    }
  }

  // ---- 소품 (밟히지 않는 장식 — sim 과 무관) ----
  const floors: [number, number][] = []
  for (let ty = 1; ty < map.h - 1; ty++) for (let tx = 1; tx < map.w - 1; tx++) if (isFloor(tx, ty)) floors.push([tx, ty])
  const nearWall = (tx: number, ty: number) => isWall(tx + 1, ty) || isWall(tx - 1, ty) || isWall(tx, ty + 1) || isWall(tx, ty - 1)
  const candles: { x: number; z: number }[] = []
  const P = new Set(look.props)
  const boneGeo = mergeGeometries([new THREE.CylinderGeometry(0.03, 0.03, 0.34, 4).rotateZ(Math.PI / 2), new THREE.SphereGeometry(0.05, 5, 4).translate(0.17, 0, 0), new THREE.SphereGeometry(0.05, 5, 4).translate(-0.17, 0, 0)])!
  const bones = P.has('bone') ? inst(boneGeo, new THREE.MeshLambertMaterial({ color: 0xcfc6ae }), floors.length, false) : null
  const skulls = P.has('skull') ? inst(new THREE.SphereGeometry(0.11, 8, 6).scale(1, 0.85, 1.1), new THREE.MeshLambertMaterial({ color: 0xd8cfb6 }), floors.length, false) : null
  const candleM = P.has('candle') ? inst(new THREE.CylinderGeometry(0.04, 0.045, 0.22, 6).translate(0, 0.11, 0), new THREE.MeshLambertMaterial({ color: 0xe8e0c8 }), floors.length, false) : null
  const grass = P.has('grass') ? inst(grassGeometry(), new THREE.MeshLambertMaterial({ color: style === 'town' ? 0x4a4a2a : 0x3e4a2a, side: THREE.DoubleSide }), floors.length, false) : null
  const shroomGeo = mergeGeometries([new THREE.CylinderGeometry(0.03, 0.04, 0.16, 5).translate(0, 0.08, 0), new THREE.SphereGeometry(0.11, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(0, 0.16, 0)])!
  const shrooms = P.has('shroom') ? inst(shroomGeo, new THREE.MeshBasicMaterial({ color: 0x8ad8a8 }), floors.length, false) : null
  const straw = P.has('straw') ? inst(new THREE.CylinderGeometry(0.3, 0.38, 0.28, 8).translate(0, 0.14, 0), new THREE.MeshLambertMaterial({ color: 0x8a7a42 }), floors.length, false) : null
  const tombGeo = mergeGeometries([new THREE.BoxGeometry(0.42, 0.6, 0.1).translate(0, 0.3, 0), new THREE.CylinderGeometry(0.21, 0.21, 0.1, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0.6, 0)])!
  const tombs = P.has('tomb') ? inst(tombGeo, new THREE.MeshLambertMaterial({ color: 0x6a6a64 }), floors.length) : null
  const bloodM = P.has('blood') ? inst(new THREE.CircleGeometry(0.4, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a0606, transparent: true, opacity: 0.8, depthWrite: false }), floors.length, false) : null
  for (const [tx, ty] of floors) {
    const r = hash(tx, ty, 30)
    const wallSide = nearWall(tx, ty)
    const x = tx + 0.2 + hash(tx, ty, 31) * 0.6
    const z = ty + 0.2 + hash(tx, ty, 32) * 0.6
    const rot = hash(tx, ty, 33) * 6.28
    if (bones && r < 0.035) put(bones, x, 0.04, z, 1, 1, 1, rot)
    else if (skulls && r < 0.05) put(skulls, x, 0.09, z, 1, 1, 1, rot)
    else if (candleM && wallSide && r < 0.09) {
      put(candleM, x, 0, z, 1, 0.7 + hash(tx, ty, 34) * 0.8, 1)
      candles.push({ x, z })
    } else if (grass && r < 0.2) put(grass, x, 0, z, 0.8 + hash(tx, ty, 35) * 0.6, 0.7 + hash(tx, ty, 36) * 0.8, 1, rot)
    else if (straw && wallSide && r < 0.205) put(straw, x, 0, z, 1, 1, 1)
    else if (shrooms && r < 0.24) put(shrooms, x, 0, z, 0.8 + hash(tx, ty, 40) * 1.4, 0.8 + hash(tx, ty, 41) * 1.6, 0.8 + hash(tx, ty, 40) * 1.4, rot)
    else if (tombs && wallSide && r < 0.26) put(tombs, x, 0, z, 1, 0.8 + hash(tx, ty, 37) * 0.5, 1, rot)
    else if (bloodM && r < 0.3) put(bloodM, x, 0.012, z, 0.6 + hash(tx, ty, 38), 1, 0.6 + hash(tx, ty, 39))
  }
  for (const m of group.children) if (m instanceof THREE.InstancedMesh) {
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }

  // ---- 불: 벽 횃불 · 양초 · 모닥불 ----
  const flames: { x: number; y: number; z: number; s: number; phase: number }[] = []
  const torchSpots: { x: number; y: number; z: number }[] = []
  if (look.torches > 0) {
    const bracket = inst(new THREE.CylinderGeometry(0.04, 0.06, 0.45, 5).rotateX(0.5), new THREE.MeshLambertMaterial({ color: 0x3a2a1e }), 400, false)
    let last: [number, number][] = []
    for (const [tx, ty] of vis) {
      if (hash(tx, ty, 40) > look.torches || torchSpots.length >= 400) continue
      // 바닥 쪽 면에 건다 (한 면만)
      const dirs: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]
      const d = dirs.find(([dx, dy]) => isFloor(tx + dx, ty + dy))
      if (!d) continue
      if (last.some(([lx, ly]) => Math.abs(lx - tx) + Math.abs(ly - ty) < 6)) continue
      last.push([tx, ty])
      if (last.length > 30) last = last.slice(-30)
      const x = tx + 0.5 + d[0] * 0.58
      const z = ty + 0.5 + d[1] * 0.58
      put(bracket, x, 1.25, z, 1, 1, 1, Math.atan2(d[0], d[1]))
      torchSpots.push({ x, y: 1.55, z })
      flames.push({ x, y: 1.6, z, s: 0.55, phase: hash(tx, ty, 41) * 10 })
    }
    bracket.instanceMatrix.needsUpdate = true
  }
  for (const c of candles) flames.push({ x: c.x, y: 0.3, z: c.z, s: 0.2, phase: c.x * 3 + c.z })
  if (fire) {
    // 모닥불: 돌 둘레 + 장작 + 큰 불꽃 + 빛
    const fx = fire[0] + 1
    const fz = fire[1] + 1
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.16, 6, 14), new THREE.MeshLambertMaterial({ color: 0x5a5650 }))
    ring.rotation.x = -Math.PI / 2
    ring.position.set(fx, 0.12, fz)
    const logs = new THREE.Mesh(mergeGeometries([new THREE.CylinderGeometry(0.07, 0.07, 1.1, 5).rotateZ(Math.PI / 2), new THREE.CylinderGeometry(0.07, 0.07, 1.1, 5).rotateX(Math.PI / 2)])!, new THREE.MeshLambertMaterial({ color: 0x3a2618 }))
    logs.position.set(fx, 0.14, fz)
    group.add(ring, logs)
    disposables.push(ring.geometry, logs.geometry)
    for (let k = 0; k < 5; k++) flames.push({ x: fx + Math.cos(k * 1.3) * 0.18, y: 0.45 + (k % 2) * 0.2, z: fz + Math.sin(k * 1.3) * 0.18, s: 1.1 - k * 0.12, phase: k * 1.7 })
    torchSpots.push({ x: fx, y: 1.2, z: fz })
  }
  // 불꽃 스프라이트 (가산 혼합 — 어둠 속에서 빛나 보인다)
  const flameTex = glowTexture()
  disposables.push(flameTex)
  const flameMat = new THREE.SpriteMaterial({ map: flameTex, color: 0xffa24a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  const sprites = flames.map((f) => {
    const sp = new THREE.Sprite(flameMat)
    sp.position.set(f.x, f.y, f.z)
    sp.scale.setScalar(f.s)
    group.add(sp)
    return sp
  })
  // 진짜 빛은 가까운 여섯에만 (빛 수가 셰이더 비용이다)
  const lights = Array.from({ length: Math.min(6, torchSpots.length) }, () => {
    const l = new THREE.PointLight(0xff9a4a, 0, 9, 1.6)
    group.add(l)
    return l
  })
  const fireLight = fire ? torchSpots[torchSpots.length - 1] : null

  // ---- 조명 ----
  const hemi = new THREE.HemisphereLight(t.ambientColor, darken(t.floor, 0.5), t.dark ? t.dark.hemi : 0.9)
  group.add(hemi)
  const sun = makeSun(t.sunColor, t.dark ? t.dark.sun : 2.2)
  group.add(sun, sun.target)

  let lastPick = -1
  return {
    group,
    sun,
    breakSandbag() {},
    setSandbagHealth() {},
    update(time: number, x: number, z: number) {
      for (let i = 0; i < sprites.length; i++) {
        const f = flames[i]
        const k = 1 + Math.sin(time * 11 + f.phase) * 0.08 + Math.sin(time * 23 + f.phase * 2) * 0.05
        sprites[i].scale.set(f.s * k * 0.8, f.s * k * 1.15, 1)
      }
      // 0.25초마다 가까운 횃불을 골라 빛을 옮긴다
      const pick = Math.floor(time * 4)
      if (pick !== lastPick && lights.length) {
        lastPick = pick
        const near = torchSpots
          .map((s, i) => ({ i, d: (s.x - x) ** 2 + (s.z - z) ** 2 }))
          .sort((a, b) => a.d - b.d)
          .slice(0, lights.length)
        near.forEach((n, k) => {
          const s = torchSpots[n.i]
          lights[k].position.set(s.x, s.y, s.z)
          lights[k].userData.fire = s === fireLight
        })
      }
      for (let k = 0; k < lights.length; k++) {
        const big = lights[k].userData.fire
        // 모닥불은 마을 한가운데를 넓게 밝힌다 (2026-09-19 — 마을이 어둡다는 점검)
        lights[k].intensity = (big ? 32 : 7) * (1 + Math.sin(time * 13 + k * 2.1) * 0.08 + Math.sin(time * 7.7 + k) * 0.06)
        lights[k].distance = big ? 20 : 9
      }
    },
    dispose() {
      for (const d of disposables) d.dispose()
      flameMat.dispose()
    },
  }
}

/** 마을의 안쪽 벽 덩어리(천막 자리): 타일 → 덩어리 상자 */
function wallClusters(map: GameMap): Map<number, { x0: number; y0: number; x1: number; y1: number; done: boolean }> {
  const out = new Map<number, { x0: number; y0: number; x1: number; y1: number; done: boolean }>()
  const seen = new Uint8Array(map.w * map.h)
  for (let i = 0; i < map.tiles.length; i++) {
    if (seen[i] || map.tiles[i] !== TILE_WALL) continue
    const tx0 = i % map.w
    const ty0 = Math.floor(i / map.w)
    if (tx0 === 0 || ty0 === 0 || tx0 === map.w - 1 || ty0 === map.h - 1) continue
    const c = { x0: tx0, y0: ty0, x1: tx0, y1: ty0, done: false }
    const stack = [i]
    const members: number[] = []
    seen[i] = 1
    while (stack.length) {
      const j = stack.pop()!
      members.push(j)
      const x = j % map.w
      const y = Math.floor(j / map.w)
      c.x0 = Math.min(c.x0, x)
      c.y0 = Math.min(c.y0, y)
      c.x1 = Math.max(c.x1, x)
      c.y1 = Math.max(c.y1, y)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (nx <= 0 || ny <= 0 || nx >= map.w - 1 || ny >= map.h - 1) continue
        const k = ny * map.w + nx
        if (seen[k] || map.tiles[k] !== TILE_WALL) continue
        seen[k] = 1
        stack.push(k)
      }
    }
    // 테두리에 붙은 덩어리(모서리 막음)는 목책으로 둔다
    if (c.x0 <= 1 || c.y0 <= 1 || c.x1 >= map.w - 2 || c.y1 >= map.h - 2) continue
    for (const j of members) out.set(j, c)
  }
  return out
}

/** 바닥 그림: 타일마다 판석·흙·바위를 칠하고 금·핏자국·이끼를 얹는다 */
function paintFloor(map: GameMap, style: WorldStyle): THREE.CanvasTexture {
  const t = map.theme
  const look = LOOK[style]
  const px = 24
  const fc = document.createElement('canvas')
  fc.width = map.w * px
  fc.height = map.h * px
  const g = fc.getContext('2d')!
  const base = new THREE.Color(t.floor)
  const alt = new THREE.Color(t.floorAlt)
  const line = hex(t.floorLine)
  const shade = (c: THREE.Color, k: number) => `rgb(${Math.round(c.r * 255 * k)},${Math.round(c.g * 255 * k)},${Math.round(c.b * 255 * k)})`
  g.fillStyle = hex(t.floor)
  g.fillRect(0, 0, fc.width, fc.height)
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const x = tx * px
      const y = ty * px
      const r = hash(tx, ty, 50)
      const k = 0.82 + 0.3 * hash(tx, ty, 51)
      if (look.floor === 'flag' || look.floor === 'marble') {
        const c = look.floor === 'marble' && (tx + ty) % 2 === 0 ? alt : base
        g.fillStyle = shade(c, k)
        g.fillRect(x + 1, y + 1, px - 2, px - 2)
        g.strokeStyle = line
        g.lineWidth = 2
        g.strokeRect(x + 1, y + 1, px - 2, px - 2)
      } else {
        // 흙·바위·다진 땅: 얼룩덜룩하게 (격자 없음)
        g.fillStyle = shade(r < 0.3 ? alt : base, k)
        g.fillRect(x, y, px, px)
        for (let s = 0; s < 3; s++) {
          g.fillStyle = shade(base, 0.7 + 0.5 * hash(tx, ty, 52 + s))
          g.beginPath()
          g.arc(x + hash(tx, ty, 55 + s) * px, y + hash(tx, ty, 58 + s) * px, 2 + hash(tx, ty, 61 + s) * 4, 0, Math.PI * 2)
          g.fill()
        }
      }
      if (map.tiles[ty * map.w + tx] !== TILE_FLOOR) continue
      // 금
      if (hash(tx, ty, 70) < look.decal.crack) {
        g.strokeStyle = 'rgba(0,0,0,0.55)'
        g.lineWidth = 1.2
        g.beginPath()
        let cx = x + hash(tx, ty, 71) * px
        let cy = y + hash(tx, ty, 72) * px
        g.moveTo(cx, cy)
        for (let s = 0; s < 4; s++) {
          cx += (hash(tx, ty, 73 + s) - 0.5) * 14
          cy += (hash(tx, ty, 77 + s) - 0.5) * 14
          g.lineTo(cx, cy)
        }
        g.stroke()
      }
      // 핏자국
      if (hash(tx, ty, 80) < look.decal.blood) {
        g.fillStyle = 'rgba(70,6,6,0.6)'
        for (let s = 0; s < 4; s++) {
          g.beginPath()
          g.arc(x + px / 2 + (hash(tx, ty, 81 + s) - 0.5) * px, y + px / 2 + (hash(tx, ty, 85 + s) - 0.5) * px, 3 + hash(tx, ty, 89 + s) * 7, 0, Math.PI * 2)
          g.fill()
        }
      }
      // 이끼
      if (hash(tx, ty, 90) < look.decal.moss) {
        g.fillStyle = 'rgba(60,78,40,0.45)'
        g.beginPath()
        g.arc(x + hash(tx, ty, 91) * px, y + hash(tx, ty, 92) * px, 5 + hash(tx, ty, 93) * 8, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
  const tex = new THREE.CanvasTexture(fc)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** 풀 한 포기: 엇갈린 잎 셋 */
function grassGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 3; k++) {
    const p = new THREE.PlaneGeometry(0.1, 0.34)
    p.translate(0, 0.17, 0)
    p.rotateZ((k - 1) * 0.35)
    p.rotateY(k * 1.05)
    parts.push(p)
  }
  return mergeGeometries(parts)!
}

/** 부드러운 빛 방울 텍스처 (불꽃) */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 36, 2, 32, 32, 30)
  grad.addColorStop(0, 'rgba(255,240,200,1)')
  grad.addColorStop(0.3, 'rgba(255,170,70,0.9)')
  grad.addColorStop(0.7, 'rgba(200,70,20,0.3)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

function makeSun(color: number, intensity: number): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(color, intensity)
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
  return sun
}

// ================================================================ 덕의 대전 맵 (투기장) — 예전 그대로

function buildClassic(map: GameMap): World3D {
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
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.w, map.h), new THREE.MeshLambertMaterial({ map: floorTex }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(map.w / 2, 0, map.h / 2)
  floor.receiveShadow = true
  group.add(floor)

  // 맵 밖 바닥 (넓게, 어둡게)
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(map.w * 4, map.h * 4), new THREE.MeshLambertMaterial({ color: t.outside }))
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

  const hemi = new THREE.HemisphereLight(t.ambientColor, darken(t.floor, 0.5), t.dark ? t.dark.hemi : 0.9)
  group.add(hemi)
  const sun = makeSun(t.sunColor, t.dark ? t.dark.sun : 2.2)
  group.add(sun, sun.target)

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
      const t2 = Math.max(0, Math.min(1, k))
      tint.setRGB(0.55 + 0.45 * t2, 0.42 + 0.58 * t2, 0.36 + 0.64 * t2)
      bags.setColorAt(id, tint)
      if (bags.instanceColor) bags.instanceColor.needsUpdate = true
    },
    update() {},
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
  const h = SANDBAG_H
  const tier = h / 3
  const sy = tier * 1.16
  bag(0, tier * 0.5, -0.3, 0.9, sy, 0.31, 0.05)
  bag(0, tier * 0.5, 0.0, 0.9, sy, 0.31, -0.04)
  bag(0, tier * 0.5, 0.3, 0.9, sy, 0.31, 0.06)
  bag(0.02, tier * 1.5, -0.16, 0.86, sy, 0.34, -0.07)
  bag(-0.02, tier * 1.5, 0.16, 0.86, sy, 0.34, 0.08)
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
