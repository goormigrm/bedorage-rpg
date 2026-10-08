// 맵 → 3D 월드 (바닥, 벽, 장애물, 소품, 횃불, 조명). 단위 1 = 타일 한 칸. sim 좌표 (px) → 월드: x/32, y/32 → (x, 0, z)
//
// 분위기(GUIDE 11장 — D2 "첫인상"): 상자 벽 금지. 지역 테마(`theme.style`)마다
//   돌벽(지하 묘지·성당·도살장) · 바위(들판·굴) · 목책과 천막(마을)으로 벽을 세우고, 장애물(상자 타일)은 관·돌무더기·통·도마로,
//   바닥은 판석·흙·바위에 금·핏자국·이끼를 칠하고, 뼈·해골·양초·풀·묘비 같은 **밟히지 않는 소품**을 흩뿌린다.
//   벽에는 횃불 — 가까운 여섯 개만 진짜 빛(성능), 나머지는 불꽃만.
// 전부 타일 좌표 해시로 정하므로 같은 맵이면 모든 브라우저에서 같은 모습이다(화면만의 일 — sim 과 무관).
// 덕의 대전 맵(style 없음)은 예전 상자 모습 그대로.
//
// 밝은 분위기(2026-10-06 — docs/밝은-분위기-개편-계획.md 3장): 같은 자리 · 같은 크기에 **놀이터 모습**만 바꾼다.
//   돌벽 → 장난감 블록 · 바위 → 커다란 공 · 관 → 선물 상자 · 도마 → 케이크 탁자 · 통 → 장난감 북,
//   뼈 → 구슬 · 해골 → 딱지 · 묘비 → 훌라후프 · 핏물 → 물감 · 죽은 나무 → 막대 사탕 나무 · 횃불 → 풍선,
//   마을 천막 → 숙소(돼지 저금통 · 큰 시계 · 이층 침대). 바닥엔 분필 ♡ ☆ ◇. 판정(sim)은 그대로.

import { isBright } from '../game/skin'
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

/** floorTex = 미리 그려 둔 바닥 그림 (paintFloorSteps — 마을에서 나눠 그린 것). 없으면 여기서 그린다 */
export function buildWorld(map: GameMap, floorTex?: THREE.CanvasTexture): World3D {
  const style = map.theme.style
  return style ? buildDark(map, style, floorTex) : buildClassic(map)
}

// ================================================================ 어두운 지역 (디아블로)

/** 밝은 분위기의 장난감 색 (분홍 · 민트 · 노랑 · 하늘 · 보라 · 살구) */
const TOY = [0xff8fb8, 0x7fdcc0, 0xffd36e, 0x8fbfff, 0xc6a4ff, 0xffa47a]
const toy = (tx: number, ty: number, salt: number): number => TOY[Math.floor(hash(tx, ty, salt) * TOY.length) % TOY.length]

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

function buildDark(map: GameMap, style: WorldStyle, painted?: THREE.CanvasTexture): World3D {
  const t = map.theme
  const look = LOOK[style]
  const bright = isBright()
  const group = new THREE.Group()
  const disposables: { dispose(): void }[] = []
  const isFloor = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && map.tiles[ty * map.w + tx] === TILE_FLOOR
  const isWall = (tx: number, ty: number) => tx < 0 || ty < 0 || tx >= map.w || ty >= map.h || map.tiles[ty * map.w + tx] === TILE_WALL

  // ---- 바닥 ----
  const floorTex = painted ?? paintFloor(map, style)
  disposables.push(floorTex)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.w, map.h), new THREE.MeshLambertMaterial({ map: floorTex }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(map.w / 2, 0, map.h / 2)
  floor.receiveShadow = true
  group.add(floor)
  // 맵 밖: 바닥이 이어지다 안개로 사라진다 (2026-10-08 퀄리티 2차 1단계 — 전에는 한 색 판이라 밝은 분위기에서 하늘에 뜬 섬 같았다)
  const outTex = paintOutside(map)
  disposables.push(outTex)
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(map.w * 4, map.h * 4), new THREE.MeshBasicMaterial({ map: outTex }))
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
    const toyCol = new THREE.Color()
    for (const [tx, ty] of vis) {
      const h = h0 + (h1 - h0) * hash(tx, ty, 1)
      const k = 0.82 + 0.3 * hash(tx, ty, 2)
      // 밝게: 칸마다 다른 색의 장난감 블록 (테마 색과 반쯤 섞어 지역 느낌은 남긴다)
      if (bright) col.copy(base).lerp(toyCol.setHex(toy(tx, ty, 2)), 0.45)
      else col.copy(base).multiplyScalar(k)
      put(block, tx + 0.5, h / 2, ty + 0.5, 1, h, 1, 0, col)
      put(cap, tx + 0.5, h + 0.07, ty + 0.5, 1, 1, 1, 0, col.copy(top).multiplyScalar(0.85 + 0.25 * hash(tx, ty, 3)))
    }
    // 무너진 모서리: 벽 끝(이웃 벽이 하나뿐)에 돌 부스러기 (밝게: 흩어진 작은 블록)
    const rubble = bright
      ? inst(new THREE.BoxGeometry(0.26, 0.26, 0.26), new THREE.MeshLambertMaterial({ color: 0xffffff }), vis.length * 3)
      : inst(new THREE.DodecahedronGeometry(0.22, 0), new THREE.MeshLambertMaterial({ color: t.wallTop }), vis.length)
    for (const [tx, ty] of vis) {
      let n = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isWall(tx + dx, ty + dy)) n++
      if (n !== 1 || hash(tx, ty, 4) > 0.6) continue
      for (let k = 0; k < 3; k++) {
        const a = hash(tx, ty, 10 + k) * Math.PI * 2
        if (bright) put(rubble, tx + 0.5 + Math.cos(a) * 0.7, 0.13, ty + 0.5 + Math.sin(a) * 0.7, 1, 1, 1, a, col.setHex(toy(tx, ty, 14 + k)))
        else put(rubble, tx + 0.5 + Math.cos(a) * 0.7, 0.1, ty + 0.5 + Math.sin(a) * 0.7, 1, 0.7, 1, a)
      }
    }
  } else if (look.wall === 'rock') {
    const rock = inst(new THREE.IcosahedronGeometry(0.62, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), vis.length)
    const base = new THREE.Color(t.wall)
    for (const [tx, ty] of vis) {
      const h = h0 + (h1 - h0) * hash(tx, ty, 1)
      put(rock, tx + 0.5 + (hash(tx, ty, 5) - 0.5) * 0.2, h * 0.42, ty + 0.5 + (hash(tx, ty, 6) - 0.5) * 0.2, 1.05 + hash(tx, ty, 7) * 0.2, h * 0.85, 1.05 + hash(tx, ty, 8) * 0.2, hash(tx, ty, 9) * 6.28, col.copy(base).multiplyScalar(0.75 + 0.45 * hash(tx, ty, 2)))
    }
    // 들판 (밝게): 바위 사이 막대 사탕 나무 — 흰 막대 + 동그란 사탕
    if (style === 'fields' && bright) {
      const stick = inst(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 6).translate(0, 0.85, 0), new THREE.MeshLambertMaterial({ color: 0xfff4ea }), vis.length)
      const candy = inst(new THREE.SphereGeometry(0.46, 14, 10).scale(1, 1, 0.55).translate(0, 1.95, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), vis.length)
      for (const [tx, ty] of vis) {
        if (hash(tx, ty, 20) >= 0.12) continue
        const s = 0.8 + hash(tx, ty, 21) * 0.6
        const r = hash(tx, ty, 22) * 6.28
        put(stick, tx + 0.5, 0, ty + 0.5, 1, s, 1, r)
        put(candy, tx + 0.5, 0, ty + 0.5, s, s, s, r, col.setHex(toy(tx, ty, 23)))
      }
    }
    // 들판: 바위 사이 죽은 나무
    else if (style === 'fields') {
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
    const trunk = inst(new THREE.CylinderGeometry(0.1, 0.16, 1, 6).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: bright ? 0xa8764c : 0x2e2218 }), vis.length)
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
    // 밝게: 흰색 · 분홍 줄무늬 울타리
    const stakes = inst(stakeGeo, new THREE.MeshLambertMaterial({ color: bright ? 0xffffff : 0x5a4330 }), vis.length * 3)
    const clusters = wallClusters(map)
    for (const [tx, ty] of vis) {
      const border = tx <= 3 || ty <= 3 || tx >= map.w - 4 || ty >= map.h - 4
      if (!border && clusters.has(ty * map.w + tx)) continue
      for (let k = 0; k < 3; k++) put(stakes, tx + 0.2 + k * 0.3, 0, ty + 0.5 + (hash(tx, ty, k) - 0.5) * 0.3, 1, 0.85 + hash(tx, ty, 10 + k) * 0.3, 1, hash(tx, ty, 20 + k) * 6, bright ? col.setHex((tx + ty + k) % 2 ? 0xffffff : 0xffc2da) : undefined)
    }
    // 천막: 덩어리마다 하나 — 천 벽 + 박공 지붕 + 꼭대기 깃발
    // (밝게: 숙소 — 가장 큰 덩어리는 돼지 저금통, 다음은 큰 시계, 나머지는 이층 침대)
    const cloths = [0x6a4a3a, 0x4a4a3a, 0x5a3a3a, 0x4a3e52, 0x3e4a44]
    let ci = 0
    if (bright) {
      const inner = [...new Set(clusters.values())]
        .filter((c) => !(c.x0 <= 3 || c.y0 <= 3 || c.x1 >= map.w - 4 || c.y1 >= map.h - 4))
        .sort((a, b) => (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) - (a.x1 - a.x0 + 1) * (a.y1 - a.y0 + 1))
      inner.forEach((c, i) => {
        c.done = true
        const obj = i === 0 ? piggyBank(c) : i === 1 ? bigClock(c) : bunkBed(c, i)
        group.add(obj)
        obj.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true
            disposables.push(o.geometry, o.material as THREE.Material)
          }
        })
      })
    }
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
  if (bright && look.crate === 'coffin') {
    // 선물 상자: 색 상자 + 흰 리본 두 줄 + 나비 매듭
    const box = inst(new THREE.BoxGeometry(0.66, 0.52, 0.66).translate(0, 0.26, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), crates.length)
    const ribbonGeo = mergeGeometries([
      new THREE.BoxGeometry(0.14, 0.545, 0.685).translate(0, 0.2725, 0),
      new THREE.BoxGeometry(0.685, 0.545, 0.14).translate(0, 0.2725, 0),
      new THREE.TorusGeometry(0.09, 0.03, 6, 12).translate(-0.08, 0.6, 0),
      new THREE.TorusGeometry(0.09, 0.03, 6, 12).translate(0.08, 0.6, 0),
    ])!
    const ribbon = inst(ribbonGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), crates.length)
    for (const [tx, ty] of crates) {
      const r = hash(tx, ty, 1) * 0.8
      const s = 0.85 + hash(tx, ty, 2) * 0.25
      put(box, tx + 0.5, 0, ty + 0.5, s, s, s, r, col.setHex(toy(tx, ty, 3)))
      put(ribbon, tx + 0.5, 0, ty + 0.5, s, s, s, r, col.setHex(hash(tx, ty, 4) < 0.5 ? 0xffffff : 0xffe680))
    }
  } else if (bright && look.crate === 'table') {
    // 케이크 탁자: 하얀 탁자 + 분홍 케이크 (도마 · 고기 대신)
    const table = inst(new THREE.BoxGeometry(0.95, 0.12, 0.8), new THREE.MeshLambertMaterial({ color: 0xfff6ee }), crates.length)
    const leg = inst(new THREE.BoxGeometry(0.1, 0.62, 0.1), new THREE.MeshLambertMaterial({ color: 0xffd3e4 }), crates.length * 2)
    const cakeGeo = mergeGeometries([new THREE.CylinderGeometry(0.24, 0.24, 0.2, 14).translate(0, 0.1, 0), new THREE.CylinderGeometry(0.25, 0.25, 0.05, 14).translate(0, 0.22, 0), new THREE.SphereGeometry(0.05, 8, 6).translate(0, 0.28, 0)])!
    const cake = inst(cakeGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), crates.length)
    for (const [tx, ty] of crates) {
      put(table, tx + 0.5, 0.68, ty + 0.5, 1, 1, 1)
      put(leg, tx + 0.12, 0.31, ty + 0.5, 1, 1, 6)
      put(leg, tx + 0.88, 0.31, ty + 0.5, 1, 1, 6)
      if (hash(tx, ty, 1) < 0.7) put(cake, tx + 0.45, 0.74, ty + 0.5, 1, 1, 1, 0, col.setHex(toy(tx, ty, 5)))
    }
  } else if (bright && look.crate === 'barrel') {
    // 장난감 북: 같은 통 모양에 색만
    const drum = inst(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 12).translate(0, 0.3, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), crates.length * 2)
    for (const [tx, ty] of crates) {
      if (isFire(tx, ty)) continue
      put(drum, tx + 0.32, 0, ty + 0.4, 1, 1, 1, 0, col.setHex(toy(tx, ty, 6)))
      if (hash(tx, ty, 1) < 0.6) put(drum, tx + 0.7, 0, ty + 0.62, 0.9, 0.9, 0.9, 0, col.setHex(toy(tx, ty, 7)))
    }
  } else if (bright) {
    // 커다란 공 (바위 · 돌무더기 대신) — 놀이터 공
    const ball = inst(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshLambertMaterial({ color: 0xffffff }), crates.length * 2)
    for (const [tx, ty] of crates) {
      const s = 0.95 + hash(tx, ty, 1) * 0.25
      put(ball, tx + 0.5, 0.42 * s, ty + 0.5, s, s, s, hash(tx, ty, 2) * 6, col.setHex(toy(tx, ty, 3)))
      if (hash(tx, ty, 4) < 0.5) put(ball, tx + 0.2 + hash(tx, ty, 5) * 0.6, 0.2, ty + 0.2 + hash(tx, ty, 6) * 0.6, 0.48, 0.48, 0.48, 0, col.setHex(toy(tx, ty, 8)))
    }
  } else if (look.crate === 'coffin') {
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
  // 밝게: 뼈 → 구슬 셋 · 해골 → 딱지 · 양초는 색 양초 · 풀은 연두
  const marbleGeo = mergeGeometries([new THREE.SphereGeometry(0.06, 8, 6).translate(0, 0.06, 0), new THREE.SphereGeometry(0.06, 8, 6).translate(0.15, 0.06, 0.05), new THREE.SphereGeometry(0.06, 8, 6).translate(0.04, 0.06, 0.16)])!
  const bones = P.has('bone') ? (bright ? inst(marbleGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), floors.length, false) : inst(boneGeo, new THREE.MeshLambertMaterial({ color: 0xcfc6ae }), floors.length, false)) : null
  const skulls = P.has('skull') ? (bright ? inst(new THREE.BoxGeometry(0.24, 0.04, 0.24).translate(0, 0.02, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), floors.length, false) : inst(new THREE.SphereGeometry(0.11, 8, 6).scale(1, 0.85, 1.1), new THREE.MeshLambertMaterial({ color: 0xd8cfb6 }), floors.length, false)) : null
  const candleM = P.has('candle') ? inst(new THREE.CylinderGeometry(0.04, 0.045, 0.22, 6).translate(0, 0.11, 0), new THREE.MeshLambertMaterial({ color: bright ? 0xffffff : 0xe8e0c8 }), floors.length, false) : null
  const grass = P.has('grass') ? inst(grassGeometry(), new THREE.MeshLambertMaterial({ color: bright ? 0x78d65e : style === 'town' ? 0x4a4a2a : 0x3e4a2a, side: THREE.DoubleSide }), floors.length, false) : null
  const shroomGeo = mergeGeometries([new THREE.CylinderGeometry(0.03, 0.04, 0.16, 5).translate(0, 0.08, 0), new THREE.SphereGeometry(0.11, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(0, 0.16, 0)])!
  const shrooms = P.has('shroom') ? inst(shroomGeo, new THREE.MeshBasicMaterial({ color: bright ? 0xff9ec4 : 0x8ad8a8 }), floors.length, false) : null
  // 밝게: 짚더미 → 빈백 쿠션
  const straw = P.has('straw') ? (bright ? inst(new THREE.SphereGeometry(0.34, 12, 8).scale(1, 0.55, 1).translate(0, 0.16, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), floors.length, false) : inst(new THREE.CylinderGeometry(0.3, 0.38, 0.28, 8).translate(0, 0.14, 0), new THREE.MeshLambertMaterial({ color: 0x8a7a42 }), floors.length, false)) : null
  const tombGeo = mergeGeometries([new THREE.BoxGeometry(0.42, 0.6, 0.1).translate(0, 0.3, 0), new THREE.CylinderGeometry(0.21, 0.21, 0.1, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0.6, 0)])!
  // 밝게: 묘비 → 벽에 기댄 훌라후프 · 핏물 → 물감
  const hoopGeo = new THREE.TorusGeometry(0.34, 0.035, 6, 24).rotateX(-0.25).translate(0, 0.34, 0)
  const tombs = P.has('tomb') ? (bright ? inst(hoopGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), floors.length) : inst(tombGeo, new THREE.MeshLambertMaterial({ color: 0x6a6a64 }), floors.length)) : null
  const bloodM = P.has('blood') ? inst(new THREE.CircleGeometry(0.4, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: bright ? 0xffffff : 0x3a0606, transparent: true, opacity: bright ? 0.7 : 0.8, depthWrite: false }), floors.length, false) : null
  for (const [tx, ty] of floors) {
    const r = hash(tx, ty, 30)
    const wallSide = nearWall(tx, ty)
    const x = tx + 0.2 + hash(tx, ty, 31) * 0.6
    const z = ty + 0.2 + hash(tx, ty, 32) * 0.6
    const rot = hash(tx, ty, 33) * 6.28
    if (bones && r < 0.035) {
      if (bright) put(bones, x, 0, z, 1, 1, 1, rot, col.setHex(toy(tx, ty, 42)))
      else put(bones, x, 0.04, z, 1, 1, 1, rot)
    } else if (skulls && r < 0.05) {
      // 딱지: 파랑 · 빨강 (접은 종이)
      if (bright) put(skulls, x, 0, z, 1, 1, 1, rot, col.setHex(hash(tx, ty, 43) < 0.5 ? 0x4a7bd8 : 0xe8606a))
      else put(skulls, x, 0.09, z, 1, 1, 1, rot)
    } else if (candleM && wallSide && r < 0.09) {
      put(candleM, x, 0, z, 1, 0.7 + hash(tx, ty, 34) * 0.8, 1, 0, bright ? col.setHex(toy(tx, ty, 44)) : undefined)
      candles.push({ x, z })
    } else if (grass && r < 0.2) put(grass, x, 0, z, 0.8 + hash(tx, ty, 35) * 0.6, 0.7 + hash(tx, ty, 36) * 0.8, 1, rot)
    else if (straw && wallSide && r < 0.205) put(straw, x, 0, z, 1, 1, 1, 0, bright ? col.setHex(toy(tx, ty, 45)) : undefined)
    else if (shrooms && r < 0.24) put(shrooms, x, 0, z, 0.8 + hash(tx, ty, 40) * 1.4, 0.8 + hash(tx, ty, 41) * 1.6, 0.8 + hash(tx, ty, 40) * 1.4, rot)
    else if (tombs && wallSide && r < 0.26) {
      if (bright) put(tombs, x, 0, z, 1, 1, 1, rot, col.setHex(toy(tx, ty, 46)))
      else put(tombs, x, 0, z, 1, 0.8 + hash(tx, ty, 37) * 0.5, 1, rot)
    } else if (bloodM && r < 0.3) put(bloodM, x, 0.012, z, 0.6 + hash(tx, ty, 38), 1, 0.6 + hash(tx, ty, 39), 0, bright ? col.setHex(toy(tx, ty, 47)) : undefined)
  }
  for (const m of group.children) if (m instanceof THREE.InstancedMesh) {
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }

  // ---- 불: 벽 횃불 · 양초 · 모닥불 ----
  const flames: { x: number; y: number; z: number; s: number; phase: number }[] = []
  const torchSpots: { x: number; y: number; z: number }[] = []
  if (look.torches > 0 && bright) {
    // 밝게: 벽마다 풍선 (끈 + 동그란 풍선) — 불도 빛도 없다(낮이라 밝다 · 빛 수만큼 셰이더가 무거워진다)
    const string = inst(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 3).translate(0, 0.45, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), 400, false)
    const balloon = inst(mergeGeometries([new THREE.SphereGeometry(0.2, 12, 9).scale(1, 1.2, 1).translate(0, 1.12, 0), new THREE.ConeGeometry(0.04, 0.06, 6).rotateX(Math.PI).translate(0, 0.89, 0)])!, new THREE.MeshLambertMaterial({ color: 0xffffff }), 400, false)
    let last: [number, number][] = []
    let n = 0
    for (const [tx, ty] of vis) {
      if (hash(tx, ty, 40) > look.torches || n >= 400) continue
      const dirs: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]
      const d = dirs.find(([dx, dy]) => isFloor(tx + dx, ty + dy))
      if (!d) continue
      if (last.some(([lx, ly]) => Math.abs(lx - tx) + Math.abs(ly - ty) < 6)) continue
      last.push([tx, ty])
      if (last.length > 30) last = last.slice(-30)
      const x = tx + 0.5 + d[0] * 0.62
      const z = ty + 0.5 + d[1] * 0.62
      const lean = (hash(tx, ty, 41) - 0.5) * 0.3
      put(string, x, 1.0, z, 1, 1, 1, lean)
      put(balloon, x, 1.0, z, 1, 1, 1, lean, col.setHex(toy(tx, ty, 48)))
      n++
    }
    string.instanceMatrix.needsUpdate = true
    balloon.instanceMatrix.needsUpdate = true
    if (balloon.instanceColor) balloon.instanceColor.needsUpdate = true
  } else if (look.torches > 0) {
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

/** 밝은 분위기의 물감 색 (바닥 얼룩) */
const PAINT_RGBA = ['rgba(255,120,170,0.45)', 'rgba(90,210,180,0.45)', 'rgba(255,205,80,0.5)', 'rgba(110,170,255,0.45)']

/** 바닥 그림을 한 번에 */
/**
 * 맵 밖 판(맵의 4배 · 맵은 가운데)의 그림: 맵 가장자리에서 바닥색이 얼룩지며 이어지다 12칸쯤에서 하늘 · 어둠(outside)으로 사라진다.
 * 맵 밖은 늘 시야 밖이므로 시야 안개(vision.ts 와 같은 색 · 진하기)를 미리 씌운다 — 벽 너머 맵 안 바닥과 같은 어둠이 된다.
 * 빛을 받지 않는 그림(MeshBasic)이라 조명 세기만큼 미리 어둡게 한다. 256 칸 그림(작다 — 얼룩은 크고 가장자리는 벽이 덮는다)
 */
function paintOutside(map: GameMap): THREE.CanvasTexture {
  const t = map.theme
  const N = 256
  const c = document.createElement('canvas')
  c.width = N
  c.height = N
  const g = c.getContext('2d')!
  const img = g.createImageData(N, N)
  const fl = new THREE.Color(t.floor)
  const alt = new THREE.Color(t.floorAlt)
  const out = new THREE.Color(t.outside)
  const vf = t.visionFog
  const fog = vf !== undefined ? new THREE.Color(vf) : new THREE.Color(t.dark ? 0x030305 : 0x060805)
  const fa = t.dark ? t.dark.fogAlpha : 0.78
  // 조명 어림: 어두운 던전은 해 · 하늘빛이 약하다 (sun + hemi 를 밝은 낮 ≈ 1 로)
  const light = t.dark ? Math.min(1, (t.dark.sun + t.dark.hemi) * 0.42) : 0.9
  const W = map.w * 4
  const H = map.h * 4
  // 큰 얼룩: 4칸 격자 값 잡음을 부드럽게 (같은 맵이면 같은 모습)
  const noise = (x: number, y: number) => {
    const gx = Math.floor(x / 4)
    const gy = Math.floor(y / 4)
    const fx = x / 4 - gx
    const fy = y / 4 - gy
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const a = hash(gx, gy, 71)
    const b = hash(gx + 1, gy, 71)
    const cc = hash(gx, gy + 1, 71)
    const d = hash(gx + 1, gy + 1, 71)
    return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy
  }
  const col = new THREE.Color()
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      // 타일 좌표 (맵은 0..w · 0..h)
      const tx = ((px + 0.5) / N) * W - 1.5 * map.w
      const ty = ((py + 0.5) / N) * H - 1.5 * map.h
      const dx = Math.max(0, -tx, tx - map.w)
      const dy = Math.max(0, -ty, ty - map.h)
      const d = Math.hypot(dx, dy)
      const n = noise(tx, ty)
      col.copy(fl).lerp(alt, n).multiplyScalar((0.72 + n * 0.3) * light)
      const k = Math.min(1, Math.max(0, (d - 2) / 12))
      col.lerp(out, k * k * (3 - 2 * k))
      col.lerp(fog, fa)
      const i = (py * N + px) * 4
      img.data[i] = Math.round(col.r * 255)
      img.data[i + 1] = Math.round(col.g * 255)
      img.data[i + 2] = Math.round(col.b * 255)
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function paintFloor(map: GameMap, style: WorldStyle): THREE.CanvasTexture {
  const g = paintFloorSteps(map, style, map.h)
  for (;;) {
    const r = g.next()
    if (r.done) return r.value
  }
}

/**
 * 바닥 그림: 타일마다 판석·흙·바위를 칠하고 금·핏자국·이끼를 얹는다.
 * rows 줄마다 한 번 쉰다(yield) — 2016×1488 캔버스에 칸 5천 개를 그려 한 번에 하면 화면이 멈춘다(마을에서 나눠 그린다, 2026-09-23)
 */
export function* paintFloorSteps(map: GameMap, style: WorldStyle, rows: number): Generator<void, THREE.CanvasTexture> {
  const bright = isBright()
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
    if (ty > 0 && ty % rows === 0) yield
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
      // 금 (밝은 분위기: 운동장 분필 선)
      if (hash(tx, ty, 70) < look.decal.crack) {
        g.strokeStyle = bright ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)'
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
      // 핏자국 (밝은 분위기: 물감 방울 — 분홍 · 민트 · 노랑)
      if (hash(tx, ty, 80) < look.decal.blood) {
        g.fillStyle = bright ? PAINT_RGBA[Math.floor(hash(tx, ty, 95) * PAINT_RGBA.length)] : 'rgba(70,6,6,0.6)'
        for (let s = 0; s < 4; s++) {
          g.beginPath()
          g.arc(x + px / 2 + (hash(tx, ty, 81 + s) - 0.5) * px, y + px / 2 + (hash(tx, ty, 85 + s) - 0.5) * px, 3 + hash(tx, ty, 89 + s) * 7, 0, Math.PI * 2)
          g.fill()
        }
      }
      // 분필 기호 ♡ ☆ ◇ (밝은 분위기 — 운동장 낙서)
      if (bright && hash(tx, ty, 97) < 0.012) chalkSymbol(g, x + px / 2, y + px / 2, 7 + hash(tx, ty, 98) * 4, Math.floor(hash(tx, ty, 99) * 3))
      // 이끼 (밝은 분위기: 노란 · 흰 꽃무리)
      if (hash(tx, ty, 90) < look.decal.moss) {
        g.fillStyle = bright ? (hash(tx, ty, 96) < 0.5 ? 'rgba(255,226,120,0.55)' : 'rgba(255,255,255,0.5)') : 'rgba(60,78,40,0.45)'
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

/** 분필로 그린 기호 하나 (0 = ♡ · 1 = ☆ · 2 = ◇) — 밝은 분위기 바닥 낙서 */
function chalkSymbol(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, kind: number): void {
  g.strokeStyle = 'rgba(255,255,255,0.7)'
  g.lineWidth = 1.6
  g.beginPath()
  if (kind === 0) {
    g.moveTo(cx, cy + r)
    g.bezierCurveTo(cx - r * 1.4, cy - r * 0.1, cx - r * 0.7, cy - r * 1.2, cx, cy - r * 0.4)
    g.bezierCurveTo(cx + r * 0.7, cy - r * 1.2, cx + r * 1.4, cy - r * 0.1, cx, cy + r)
  } else if (kind === 1) {
    for (let k = 0; k <= 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5
      const rr = k % 2 === 0 ? r : r * 0.45
      if (k === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
      else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
    }
  } else {
    g.moveTo(cx, cy - r)
    g.lineTo(cx + r * 0.75, cy)
    g.lineTo(cx, cy + r)
    g.lineTo(cx - r * 0.75, cy)
    g.closePath()
  }
  g.stroke()
}

type Cluster = { x0: number; y0: number; x1: number; y1: number }
const lam = (color: number) => new THREE.MeshLambertMaterial({ color })

/** 밝은 마을: 돼지 저금통 (가장 큰 천막 자리 — 우리 숙소의 귀여운 저금통) */
function piggyBank(c: Cluster): THREE.Group {
  const w = c.x1 - c.x0 + 1
  const d = c.y1 - c.y0 + 1
  const s = Math.min(w, d) * 0.5
  const g = new THREE.Group()
  const pink = lam(0xffa6c9)
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), pink)
  body.scale.set((w / 2) * 0.95, s * 0.9, (d / 2) * 0.95)
  body.position.y = s * 0.95
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.28, s * 0.3, s * 0.22, 14).rotateX(Math.PI / 2), lam(0xff8fb8))
  snout.position.set(0, s * 0.95, (d / 2) * 0.95 + s * 0.06)
  const nostrilM = lam(0xd45a8a)
  const nl = new THREE.Mesh(new THREE.SphereGeometry(s * 0.05, 8, 6), nostrilM)
  nl.position.set(-s * 0.09, s * 0.97, (d / 2) * 0.95 + s * 0.17)
  const nr = new THREE.Mesh(nl.geometry.clone(), nostrilM)
  nr.position.set(s * 0.09, s * 0.97, (d / 2) * 0.95 + s * 0.17)
  const eyeM = lam(0x3a2a3a)
  const el = new THREE.Mesh(new THREE.SphereGeometry(s * 0.07, 8, 6), eyeM)
  el.position.set(-s * 0.35, s * 1.35, (d / 2) * 0.82)
  const er = new THREE.Mesh(el.geometry.clone(), eyeM)
  er.position.set(s * 0.35, s * 1.35, (d / 2) * 0.82)
  const ea = new THREE.Mesh(new THREE.ConeGeometry(s * 0.2, s * 0.32, 4), pink)
  ea.position.set(-s * 0.45, s * 1.75, (d / 2) * 0.35)
  ea.rotation.z = 0.35
  const eb = new THREE.Mesh(new THREE.ConeGeometry(s * 0.2, s * 0.32, 4), pink)
  eb.position.set(s * 0.45, s * 1.75, (d / 2) * 0.35)
  eb.rotation.z = -0.35
  const slot = new THREE.Mesh(new THREE.BoxGeometry(s * 0.5, s * 0.05, s * 0.08), lam(0x8a3a5a))
  slot.position.set(0, s * 1.84, 0)
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.2, s * 0.2, s * 0.05, 16).rotateX(Math.PI / 2), lam(0xffd34a))
  coin.position.set(0, s * 2.0, 0)
  g.add(body, snout, nl, nr, el, er, ea, eb, slot, coin)
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.16, s * 0.18, s * 0.4, 10), pink)
    leg.position.set(lx * (w / 2) * 0.5, s * 0.2, lz * (d / 2) * 0.5)
    g.add(leg)
  }
  g.position.set(c.x0 + w / 2, 0, c.y0 + d / 2)
  return g
}

/** 밝은 마을: 큰 시계 (놀이 시간을 알리는 시계탑) */
function bigClock(c: Cluster): THREE.Group {
  const w = c.x1 - c.x0 + 1
  const d = c.y1 - c.y0 + 1
  const g = new THREE.Group()
  const base = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 1.1, d - 0.2), lam(0x9fd8ff))
  base.position.y = 0.55
  const r = Math.min(w, d) * 0.42
  const tower = new THREE.Mesh(new THREE.BoxGeometry(r * 1.6, r * 1.9, r * 0.9), lam(0xffd6e8))
  tower.position.set(0, 1.1 + r * 0.95, 0)
  const face = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.7, 0.08, 28).rotateX(Math.PI / 2), lam(0xffffff))
  face.position.set(0, 1.1 + r * 1.05, r * 0.46)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.7, 0.06, 6, 28), lam(0xff8fb8))
  rim.position.set(0, face.position.y, r * 0.5)
  const handM = lam(0x3a3a5a)
  const hh = new THREE.Mesh(new THREE.BoxGeometry(0.07, r * 0.4, 0.04).translate(0, r * 0.2, 0), handM)
  hh.position.set(0, face.position.y, r * 0.52)
  hh.rotation.z = -0.9
  const mh = new THREE.Mesh(new THREE.BoxGeometry(0.05, r * 0.58, 0.04).translate(0, r * 0.29, 0), handM)
  mh.position.set(0, face.position.y, r * 0.53)
  mh.rotation.z = 0.5
  const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.15, r * 0.9, 4).rotateY(Math.PI / 4), lam(0xff8fb8))
  roof.position.set(0, 1.1 + r * 1.9 + r * 0.45, 0)
  g.add(base, tower, face, rim, hh, mh, roof)
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), handM)
    dot.position.set(Math.sin(a) * r * 0.58, face.position.y + Math.cos(a) * r * 0.58, r * 0.52)
    g.add(dot)
  }
  g.position.set(c.x0 + w / 2, 0, c.y0 + d / 2)
  return g
}

/** 밝은 마을: 이층 침대 (천막 대신 — 참가자 숙소) */
function bunkBed(c: Cluster, i: number): THREE.Group {
  const w = c.x1 - c.x0 + 1
  const d = c.y1 - c.y0 + 1
  const g = new THREE.Group()
  const frameM = lam(i % 2 ? 0x9fd8ff : 0xc6a4ff)
  const along = w >= d
  const L = (along ? w : d) - 0.2
  const S = (along ? d : w) - 0.2
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.0, 0.12).translate(0, 1.0, 0), frameM)
    p.position.set(along ? (a * L) / 2 : (b * S) / 2, 0, along ? (b * S) / 2 : (a * L) / 2)
    g.add(p)
  }
  const sheet = [0xffffff, 0xffe6f0, 0xfff3c4, 0xe0f4ff]
  for (const [y, k] of [[0.45, 0], [1.45, 1]] as const) {
    const slab = new THREE.Mesh(along ? new THREE.BoxGeometry(L, 0.14, S) : new THREE.BoxGeometry(S, 0.14, L), frameM)
    slab.position.y = y
    const bed = new THREE.Mesh(along ? new THREE.BoxGeometry(L - 0.1, 0.18, S - 0.1) : new THREE.BoxGeometry(S - 0.1, 0.18, L - 0.1), lam(sheet[(i + k) % sheet.length]))
    bed.position.y = y + 0.16
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.4 : S * 0.6, 0.12, along ? S * 0.6 : 0.4), lam(0xffffff))
    pillow.position.set(along ? -L / 2 + 0.3 : 0, y + 0.3, along ? 0 : -L / 2 + 0.3)
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(along ? L * 0.55 : S - 0.08, 0.06, along ? S - 0.08 : L * 0.55), lam(TOY[(i + k * 2) % TOY.length]))
    blanket.position.set(along ? L * 0.18 : 0, y + 0.27, along ? 0 : L * 0.18)
    g.add(slab, bed, pillow, blanket)
  }
  g.position.set(c.x0 + w / 2, 0, c.y0 + d / 2)
  return g
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
  // 그림자 범위: 카메라를 높이며(2026-09-23) 화면 가장자리에서 그림자가 끊기지 않게 18 → 22
  sun.shadow.camera.left = -22
  sun.shadow.camera.right = 22
  sun.shadow.camera.top = 22
  sun.shadow.camera.bottom = -22
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
