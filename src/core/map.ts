// 맵. 테두리와 크기는 maps.ts 의 문자 그리드에서 오고, **안쪽 구조물은 매 판 시드로 생성**한다.
// 같은 시드면 모든 브라우저가 똑같은 맵을 만든다(결정론). 맵은 GameState 밖의 정적 데이터지만,
// 모래주머니가 부서지면 sim 이 tiles 를 바꾼다 (내구도는 GameState.sandbags 가 정본).

import { DEFAULT_MAP, MAPS, MapDef, MapId, MapScale, MapTheme, expandRows } from './maps'
import { Rng, makeRng, randInt } from './rng'

export const TILE = 32

export const TILE_FLOOR = 0
export const TILE_WALL = 1
export const TILE_CRATE = 2
/** 모래주머니: 이동·탄을 막지만 시야는 넘어가고, 엄폐 중인 사람의 탄과 헤드샷 탄은 넘어간다 */
export const TILE_SANDBAG = 3

/** 모래주머니 내구도 */
export const SANDBAG_HP = 240
/** 이 거리 안에 모래주머니가 있으면 '엄폐 중'으로 보고 내 탄이 모래주머니를 넘어간다 */
/**
 * 모래주머니에 "붙어 있다" 고 보는 거리 (타일 사각형까지의 거리).
 * 몸 반지름이 14 라 충돌 때문에 14 보다 가까이는 못 간다 → 28 이면 반 칸 안쪽이 붙은 것.
 * 46 이던 시절에는 **두 칸 떨어진 대각선**도 붙은 것으로 쳐서, 눈에는 멀리 있는데
 * 탄이 모래주머니를 넘어가 버렸다(2026-09-06 제보).
 */
export const COVER_DIST = 28

export interface GameMap {
  id: MapId
  name: string
  theme: MapTheme
  /** 인원별 확장 배율 (1, 2, 4) */
  scale: MapScale
  /** 생성 시드 */
  seed: number
  w: number
  h: number
  tiles: Uint8Array
  /** 처음 생성된 모래주머니 타일 인덱스 (부서져도 유지 — 리싱크 복원용) */
  sandbagIdx: number[]
  spawns: { x: number; y: number }[]
  /** 픽셀 단위 */
  pw: number
  ph: number
}

export function buildMap(idOrDef: MapId | MapDef = DEFAULT_MAP, scale: MapScale = 1, seed = 1): GameMap {
  const def = typeof idOrDef === 'string' ? MAPS[idOrDef] : idOrDef
  const rows = expandRows(def.rows, scale)
  const h = rows.length
  const w = rows[0].length
  const tiles = new Uint8Array(w * h)
  // 테두리만 문자 그리드에서 가져온다 (안쪽은 아래에서 생성)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
      tiles[y * w + x] = edge ? TILE_WALL : TILE_FLOOR
    }
  }
  const map: GameMap = {
    id: def.id, name: def.name, theme: def.theme, scale, seed,
    w, h, tiles, sandbagIdx: [], spawns: [], pw: w * TILE, ph: h * TILE,
  }
  generate(map, def, seed)
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === TILE_SANDBAG) map.sandbagIdx.push(i)
  map.spawns = pickSpawns(map)
  return map
}

// ---------- 생성 ----------

function idHash(s: string): number {
  let hv = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    hv ^= s.charCodeAt(i)
    hv = Math.imul(hv, 0x01000193)
  }
  return hv >>> 0
}

function generate(map: GameMap, def: MapDef, seed: number): void {
  const rng = makeRng((seed ^ idHash(def.id) ^ (map.scale * 0x9e3779b1)) >>> 0)
  const area = (map.w - 2) * (map.h - 2)
  const g = def.gen
  const k = area / 1064 // 40x30 기준 1
  // 1) 뼈대 — 맵 성격을 정하는 부분
  if (g.style === 'rooms') {
    // 넓을수록 더 잘게 나눈다
    carveRooms(map, rng, g.density + (map.scale === 4 ? 2 : map.scale === 2 ? 1 : 0))
  } else if (g.style === 'pillars') {
    placePillars(map, rng, g.density)
  } else {
    for (let i = 0; i < Math.round(g.density * k); i++) placeWallShape(map, rng, g.maxLen)
  }
  // 2) 상자 군집
  for (let i = 0; i < Math.round(g.crates * k); i++) placeCluster(map, rng, TILE_CRATE, randInt(rng, 1, 5))
  // 3) 모래주머니 진지: 중앙에 하나. 넓은 맵이면 하나 더 (많으면 지저분하고 엄폐가 흔해진다)
  const forts: [number, number][] = [[map.w / 2, map.h / 2]]
  if (map.scale === 4) forts.push([map.w * 0.25, map.h * 0.25])
  for (const [fx, fy] of forts) placeFort(map, Math.round(fx), Math.round(fy))
  // 4) 흩어진 모래주머니 줄 — 드물게, 짧게
  for (let i = 0; i < Math.round(g.sandbags * k); i++) placeLine(map, rng, TILE_SANDBAG, randInt(rng, 3, 6))
  // 5) 갇힌 곳이 생겼으면 뚫는다
  ensureConnected(map)
  // 6) 뺑 돌아가야 하는 곳에 지름길을 낸다 (미로처럼 되는 것 방지)
  openShortcuts(map)
  // 7) 그래도 멀리 돌아가는 구간이 남으면 곧게 이어 준다
  straightenPaths(map)
}

/** 8방향 걸음 수 거리 (실제 이동이 8방향이라 4방향으로 재면 대각선을 과대평가한다) */
function walkField(map: GameMap, start: number): Float64Array {
  const total = map.w * map.h
  const d = new Float64Array(total).fill(-1)
  // 대각선이 √2 라 단순 BFS 로는 안 되고, 작은 우선순위 없이 두 번 훑는 것으로 충분한 근사를 낸다
  const q: number[] = [start]
  d[start] = 0
  let head = 0
  while (head < q.length) {
    const cur = q[head++]
    const cx = cur % map.w
    const cy = (cur / map.w) | 0
    for (let k = 0; k < 8; k++) {
      const dx = k < 4 ? [1, -1, 0, 0][k] : [1, 1, -1, -1][k - 4]
      const dy = k < 4 ? [0, 0, 1, -1][k] : [1, -1, 1, -1][k - 4]
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue
      const n = ny * map.w + nx
      if (map.tiles[n] !== TILE_FLOOR) continue
      // 대각선은 두 옆칸이 모두 비어야 지나간다 (모서리 끼임 방지)
      if (dx !== 0 && dy !== 0) {
        if (map.tiles[cy * map.w + nx] !== TILE_FLOOR || map.tiles[ny * map.w + cx] !== TILE_FLOOR) continue
      }
      const nd = d[cur] + (dx !== 0 && dy !== 0 ? 1.41421356 : 1)
      if (d[n] < 0 || nd < d[n] - 1e-9) {
        d[n] = nd
        q.push(n)
      }
    }
  }
  return d
}

/**
 * 멀리 돌아가야 하는 두 지점을 직선으로 이어 준다.
 *
 * `openShortcuts` 는 '벽 하나 사이인데 멀리 돌아가는' 국소적인 곳만 고친다.
 * 방 배치 자체가 미로가 되면 그것으로는 부족해서, 맵을 격자로 훑어
 * **직선 거리 대비 걸어야 하는 거리(우회도)** 가 가장 나쁜 쌍을 찾아 그 사이 벽을 직선으로 뚫는다.
 * 너무 많이 뚫으면 엄폐가 사라지므로 몇 군데만 손본다.
 */
function straightenPaths(map: GameMap, rounds = 8): void {
  // 맵을 고르게 대표하는 표본 (격자에서 바닥인 칸). 스폰은 구석에 잡히므로 가장자리도 포함한다
  const pts: number[] = []
  const gap = map.scale === 1 ? 6 : 8
  for (let y = 2; y < map.h - 2; y += gap) {
    for (let x = 2; x < map.w - 2; x += gap) {
      const i = y * map.w + x
      if (map.tiles[i] === TILE_FLOOR) pts.push(i)
    }
  }
  if (pts.length < 2) return
  const SQ2 = 1.41421356
  for (let r = 0; r < rounds; r++) {
    let worst = 0
    let wa = -1
    let wb = -1
    for (const a of pts) {
      const d = walkField(map, a)
      const ax = a % map.w
      const ay = (a / map.w) | 0
      for (const b of pts) {
        if (b <= a) continue
        const steps = d[b]
        if (steps < 0) continue
        const bx = b % map.w
        const by = (b / map.w) | 0
        const straight = Math.hypot(ax - bx, ay - by)
        if (straight < 10) continue
        const ratio = steps / straight
        if (ratio > worst) {
          worst = ratio
          wa = a
          wb = b
        }
      }
    }
    // 1.45 = 직선의 1.45배 넘게 걸어야 하는 구간. 이 정도면 "뺑 돌았다"고 느낀다
    if (wa < 0 || worst < 1.45) return
    carveLine(map, wa % map.w, (wa / map.w) | 0, wb % map.w, (wb / map.w) | 0)
    void SQ2
  }
}

/** 두 점을 잇는 직선 위의 벽을 2칸 폭으로 뚫는다 (상자·모래주머니는 그대로 둔다) */
function carveLine(map: GameMap, x0: number, y0: number, x1: number, y1: number): void {
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let guard = map.w + map.h + 8
  while (guard-- > 0) {
    for (const [ox, oy] of [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as [number, number][]) {
      const tx = x + ox
      const ty = y + oy
      if (tx < 1 || ty < 1 || tx >= map.w - 1 || ty >= map.h - 1) continue
      const i = ty * map.w + tx
      if (map.tiles[i] === TILE_WALL) map.tiles[i] = TILE_FLOOR
    }
    if (x === x1 && y === y1) break
    const e2 = err * 2
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
}

/**
 * 어디로든 '가깝게' 통하도록 지름길을 낸다.
 *
 * `ensureConnected` 는 갇힌 곳만 없앨 뿐, 길이 이어져 있어도 한참 돌아가는 구조는 그대로 둔다.
 * 실제로 스튜디오(방 분할)에서 미로처럼 뺑 돌아가는 일이 잦았다.
 *
 * 방법: 한 지점에서 걸음 수 거리(BFS)를 재고, **뚫었을 때 양쪽 거리 차가 큰 벽**을 찾아 구멍을 낸다.
 * 거리 차가 크다는 것은 바로 옆인데도 한참 돌아야 한다는 뜻이다. 그런 곳부터 순서대로 뚫는다.
 * rng 를 쓰지 않아 같은 맵이면 결과가 같다(결정론 유지).
 */
function openShortcuts(map: GameMap, rounds = 30): void {
  const total = map.w * map.h
  const dist = new Int32Array(total)
  for (let r = 0; r < rounds; r++) {
    // 걸음 수 거리 (첫 바닥 칸 기준)
    dist.fill(-1)
    let start = -1
    for (let i = 0; i < total; i++) {
      if (map.tiles[i] === TILE_FLOOR) {
        start = i
        break
      }
    }
    if (start < 0) return
    const queue = [start]
    dist[start] = 0
    let head = 0
    while (head < queue.length) {
      const cur = queue[head++]
      const cx = cur % map.w
      const cy = (cur / map.w) | 0
      const d = dist[cur] + 1
      if (cx > 0 && dist[cur - 1] < 0 && map.tiles[cur - 1] === TILE_FLOOR) { dist[cur - 1] = d; queue.push(cur - 1) }
      if (cx < map.w - 1 && dist[cur + 1] < 0 && map.tiles[cur + 1] === TILE_FLOOR) { dist[cur + 1] = d; queue.push(cur + 1) }
      if (cy > 0 && dist[cur - map.w] < 0 && map.tiles[cur - map.w] === TILE_FLOOR) { dist[cur - map.w] = d; queue.push(cur - map.w) }
      if (cy < map.h - 1 && dist[cur + map.w] < 0 && map.tiles[cur + map.w] === TILE_FLOOR) { dist[cur + map.w] = d; queue.push(cur + map.w) }
    }
    // 뚫으면 가장 많이 가까워지는 자리 찾기.
    // 벽이 두 겹·세 겹인 곳도 있으므로 한 칸이 아니라 **최대 3칸까지 관통**해 반대편 바닥을 본다.
    let bestFrom = -1
    let bestStep = 0
    let bestLen = 0
    let bestGain = 0
    const DIRS: [number, number][] = [
      [1, 0],
      [0, 1],
    ]
    for (let y = 1; y < map.h - 1; y++) {
      for (let x = 1; x < map.w - 1; x++) {
        const i = y * map.w + x
        if (map.tiles[i] !== TILE_FLOOR || dist[i] < 0) continue
        for (const [dx, dy] of DIRS) {
          const step = dy * map.w + dx
          // 벽을 1~3칸 지나 반대편 바닥이 나오는가
          for (let len = 1; len <= 3; len++) {
            const nx = x + dx * (len + 1)
            const ny = y + dy * (len + 1)
            if (nx < 1 || ny < 1 || nx >= map.w - 1 || ny >= map.h - 1) break
            let solid = true
            for (let k = 1; k <= len; k++) {
              if (map.tiles[i + step * k] !== TILE_WALL) {
                solid = false
                break
              }
            }
            if (!solid) break
            const j = i + step * (len + 1)
            if (map.tiles[j] !== TILE_FLOOR || dist[j] < 0) continue
            // 두꺼운 벽일수록 뚫는 값어치를 조금 깎는다 (얇은 곳부터 뚫리도록)
            const gain = Math.abs(dist[i] - dist[j]) - (len - 1) * 4
            if (gain > bestGain) {
              bestGain = gain
              bestFrom = i
              bestStep = step
              bestLen = len
            }
          }
        }
      }
    }
    // 바로 옆인데 8걸음 넘게 돌아야 한다면 뚫을 값어치가 있다
    if (bestFrom < 0 || bestGain < 8) break
    // 한 칸만 뚫으면 지나갈 수는 있어도 답답하다. 벽을 따라 두 칸 폭으로 넓힌다
    const wide = bestStep === 1 ? map.w : 1
    for (let k = 1; k <= bestLen; k++) {
      const t = bestFrom + bestStep * k
      map.tiles[t] = TILE_FLOOR
      const t2 = t + wide
      const tx2 = t2 % map.w
      const ty2 = (t2 / map.w) | 0
      if (tx2 > 0 && ty2 > 0 && tx2 < map.w - 1 && ty2 < map.h - 1 && map.tiles[t2] === TILE_WALL) {
        map.tiles[t2] = TILE_FLOOR
      }
    }
  }
}

/** 영역을 재귀로 갈라 방과 문을 만든다 (실내 맵) */
function carveRooms(map: GameMap, rng: Rng, depth: number): void {
  // 방을 너무 잘게 쪼개면 미로가 된다. 최소 변을 키워 방을 크게, 대신 문을 넉넉히 낸다
  const MIN = 8
  const put = (x: number, y: number, tile: number) => {
    if (x < 1 || y < 1 || x >= map.w - 1 || y >= map.h - 1) return
    map.tiles[y * map.w + x] = tile
  }
  const split = (x0: number, y0: number, x1: number, y1: number, d: number): void => {
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    if (d <= 0) return
    const canH = h >= MIN * 2 + 1
    const canV = w >= MIN * 2 + 1
    if (!canH && !canV) return
    const horiz = canH && (!canV || (h > w || (h === w && randInt(rng, 0, 2) === 0)))
    if (horiz) {
      const y = y0 + MIN + randInt(rng, 0, h - MIN * 2)
      for (let x = x0; x <= x1; x++) put(x, y, TILE_WALL)
      // 문 (3칸 폭) — 벽이 길수록 더 많이 낸다. 적으면 한 문으로 몰려 뺑 돌게 된다
      for (let i = 0, n = 2 + Math.floor(w / 14) + randInt(rng, 0, 2); i < n; i++) {
        const dx = x0 + 1 + randInt(rng, 0, Math.max(1, w - 4))
        for (let j = 0; j < 3; j++) put(dx + j, y, TILE_FLOOR)
      }
      split(x0, y0, x1, y - 1, d - 1)
      split(x0, y + 1, x1, y1, d - 1)
    } else {
      const x = x0 + MIN + randInt(rng, 0, w - MIN * 2)
      for (let y = y0; y <= y1; y++) put(x, y, TILE_WALL)
      for (let i = 0, n = 2 + Math.floor(h / 14) + randInt(rng, 0, 2); i < n; i++) {
        const dy = y0 + 1 + randInt(rng, 0, Math.max(1, h - 4))
        for (let j = 0; j < 3; j++) put(x, dy + j, TILE_FLOOR)
      }
      split(x0, y0, x - 1, y1, d - 1)
      split(x + 1, y0, x1, y1, d - 1)
    }
  }
  split(1, 1, map.w - 2, map.h - 2, depth)
}

/** 기둥을 격자로 세운다 (주차장) */
function placePillars(map: GameMap, rng: Rng, gap: number): void {
  for (let ty = 3; ty < map.h - 4; ty += gap) {
    for (let tx = 3; tx < map.w - 4; tx += gap) {
      if (randInt(rng, 0, 9) === 0) continue // 가끔 비운다
      const jx = tx + randInt(rng, 0, 2)
      const jy = ty + randInt(rng, 0, 2)
      if (free(map, jx, jy, 2, 2, 1)) fill(map, jx, jy, 2, 2, TILE_WALL)
    }
  }
}

/** 갇힌 바닥이 없도록 벽을 뚫어 잇는다 (생성 방식과 무관한 안전장치) */
function ensureConnected(map: GameMap): void {
  const total = map.w * map.h
  for (let pass = 0; pass < 12; pass++) {
    let start = -1
    for (let i = 0; i < total; i++) {
      if (map.tiles[i] === TILE_FLOOR) {
        start = i
        break
      }
    }
    if (start < 0) return
    const seen = new Uint8Array(total)
    const queue = [start]
    seen[start] = 1
    let head = 0
    while (head < queue.length) {
      const cur = queue[head++]
      const cx = cur % map.w
      const cy = (cur / map.w) | 0
      if (cx > 0 && !seen[cur - 1] && map.tiles[cur - 1] === TILE_FLOOR) { seen[cur - 1] = 1; queue.push(cur - 1) }
      if (cx < map.w - 1 && !seen[cur + 1] && map.tiles[cur + 1] === TILE_FLOOR) { seen[cur + 1] = 1; queue.push(cur + 1) }
      if (cy > 0 && !seen[cur - map.w] && map.tiles[cur - map.w] === TILE_FLOOR) { seen[cur - map.w] = 1; queue.push(cur - map.w) }
      if (cy < map.h - 1 && !seen[cur + map.w] && map.tiles[cur + map.w] === TILE_FLOOR) { seen[cur + map.w] = 1; queue.push(cur + map.w) }
    }
    // 닿지 않은 바닥 찾기
    let stray = -1
    for (let i = 0; i < total; i++) {
      if (map.tiles[i] === TILE_FLOOR && !seen[i]) {
        stray = i
        break
      }
    }
    if (stray < 0) return
    // 닿은 곳 중 가장 가까운 칸으로 직선을 뚫는다
    const sx = stray % map.w
    const sy = (stray / map.w) | 0
    let best = start
    let bestD = Infinity
    for (let i = 0; i < total; i++) {
      if (!seen[i]) continue
      const d = Math.abs((i % map.w) - sx) + Math.abs(((i / map.w) | 0) - sy)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    let cx = sx
    let cy = sy
    const tx = best % map.w
    const ty = (best / map.w) | 0
    while (cx !== tx || cy !== ty) {
      if (cx !== tx) cx += cx < tx ? 1 : -1
      else cy += cy < ty ? 1 : -1
      if (cx > 0 && cy > 0 && cx < map.w - 1 && cy < map.h - 1) map.tiles[cy * map.w + cx] = TILE_FLOOR
    }
  }
}

function free(map: GameMap, x0: number, y0: number, w: number, h: number, clear: number): boolean {
  for (let y = y0 - clear; y < y0 + h + clear; y++) {
    for (let x = x0 - clear; x < x0 + w + clear; x++) {
      if (x < 1 || y < 1 || x >= map.w - 1 || y >= map.h - 1) return false
      if (map.tiles[y * map.w + x] !== TILE_FLOOR) return false
    }
  }
  return true
}

function fill(map: GameMap, x0: number, y0: number, w: number, h: number, tile: number): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) map.tiles[y * map.w + x] = tile
}

/** 막대·ㄱ자·덩어리 중 하나를 빈 곳에 놓는다 (통로가 남도록 여유 2칸) */
function placeWallShape(map: GameMap, rng: Rng, maxLen: number): void {
  for (let tries = 0; tries < 40; tries++) {
    const kind = randInt(rng, 0, 4)
    const len = randInt(rng, 3, maxLen + 1)
    const x = randInt(rng, 2, map.w - 3)
    const y = randInt(rng, 2, map.h - 3)
    if (kind === 0 && free(map, x, y, len, 1, 2)) {
      fill(map, x, y, len, 1, TILE_WALL)
      return
    }
    if (kind === 1 && free(map, x, y, 1, len, 2)) {
      fill(map, x, y, 1, len, TILE_WALL)
      return
    }
    if (kind === 2 && free(map, x, y, len, len, 2)) {
      // ㄱ자
      fill(map, x, y, len, 1, TILE_WALL)
      fill(map, x, y, 1, len, TILE_WALL)
      return
    }
    if (kind === 3 && free(map, x, y, 3, 2, 2)) {
      fill(map, x, y, 3, 2, TILE_WALL)
      return
    }
  }
}

function placeCluster(map: GameMap, rng: Rng, tile: number, n: number): void {
  for (let tries = 0; tries < 30; tries++) {
    const x = randInt(rng, 2, map.w - 3)
    const y = randInt(rng, 2, map.h - 3)
    const w = n > 2 ? 2 : n
    const h = Math.ceil(n / 2)
    if (!free(map, x, y, w, h, 1)) continue
    fill(map, x, y, w, h, tile)
    return
  }
}

function placeLine(map: GameMap, rng: Rng, tile: number, len: number): void {
  for (let tries = 0; tries < 30; tries++) {
    const horiz = randInt(rng, 0, 2) === 0
    const x = randInt(rng, 2, map.w - 3)
    const y = randInt(rng, 2, map.h - 3)
    const w = horiz ? len : 1
    const h = horiz ? 1 : len
    if (!free(map, x, y, w, h, 1)) continue
    fill(map, x, y, w, h, tile)
    return
  }
}

/** 사방에 입구가 있는 작은 모래주머니 진지 */
function placeFort(map: GameMap, cx: number, cy: number): void {
  const put = (x: number, y: number) => {
    if (x < 1 || y < 1 || x >= map.w - 1 || y >= map.h - 1) return
    if (map.tiles[y * map.w + x] === TILE_FLOOR) map.tiles[y * map.w + x] = TILE_SANDBAG
  }
  // 위·아래 세 칸씩, 좌·우 한 칸씩. 모서리는 비워 사방에서 드나들 수 있다 (8칸)
  for (const dx of [-1, 0, 1]) {
    put(cx + dx, cy - 2)
    put(cx + dx, cy + 2)
  }
  put(cx - 2, cy)
  put(cx + 2, cy)
}

/** 사방이 트인 칸 중 서로 멀리 떨어진 곳을 스폰으로 (결정론) */
function pickSpawns(map: GameMap): { x: number; y: number }[] {
  const cand: { x: number; y: number }[] = []
  for (let ty = 2; ty < map.h - 2; ty++) {
    for (let tx = 2; tx < map.w - 2; tx++) {
      let ok = true
      for (let dy = -1; dy <= 1 && ok; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (map.tiles[(ty + dy) * map.w + tx + dx] !== TILE_FLOOR) {
            ok = false
            break
          }
        }
      }
      if (ok) cand.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })
    }
  }
  if (cand.length === 0) return [{ x: map.pw / 2, y: map.ph / 2 }]
  // 가장 왼쪽 위 후보에서 시작해, 이미 고른 곳들에서 가장 먼 후보를 차례로 고른다
  const out = [cand[0]]
  const want = Math.min(10, cand.length)
  while (out.length < want) {
    let best = -1
    let bestD = -1
    for (let i = 0; i < cand.length; i++) {
      let d = Infinity
      for (const o of out) d = Math.min(d, (cand[i].x - o.x) ** 2 + (cand[i].y - o.y) ** 2)
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    if (best < 0 || bestD < (TILE * 5) ** 2) break
    out.push(cand[best])
  }
  return out
}

// ---------- 조회 ----------

/** 이동 충돌: 벽·상자·모래주머니 모두 막힘 */
export function isWall(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true
  return map.tiles[ty * map.w + tx] !== TILE_FLOOR
}

/** 시야: 높은 벽만 막는다 (상자·모래주머니는 낮아서 넘어 본다) */
export function blocksSight(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true
  return map.tiles[ty * map.w + tx] === TILE_WALL
}

export function tileAt(map: GameMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return TILE_WALL
  return map.tiles[ty * map.w + tx]
}

export function isWallAt(map: GameMap, px: number, py: number): boolean {
  return isWall(map, Math.floor(px / TILE), Math.floor(py / TILE))
}

/** 이 지점이 모래주머니에 붙어 있는가 (엄폐 중) */
export function nearSandbag(map: GameMap, px: number, py: number, dist = COVER_DIST): boolean {
  const r = Math.ceil(dist / TILE)
  const ctx0 = Math.floor(px / TILE)
  const cty0 = Math.floor(py / TILE)
  for (let ty = cty0 - r; ty <= cty0 + r; ty++) {
    for (let tx = ctx0 - r; tx <= ctx0 + r; tx++) {
      if (tileAt(map, tx, ty) !== TILE_SANDBAG) continue
      const cx = Math.max(tx * TILE, Math.min((tx + 1) * TILE, px))
      const cy = Math.max(ty * TILE, Math.min((ty + 1) * TILE, py))
      if ((cx - px) ** 2 + (cy - py) ** 2 <= dist * dist) return true
    }
  }
  return false
}

export interface RayHit {
  blocked: boolean
  tx: number
  ty: number
  tile: number
}

/**
 * 격자 레이캐스트 (DDA). mode 'sight' 는 높은 벽만, 'bullet' 은 벽·상자와 (over 가 아니면) 모래주머니.
 * 막혔으면 막은 타일을 함께 돌려준다.
 */
export function rayCast(
  map: GameMap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mode: 'sight' | 'bullet',
  over = false,
): RayHit {
  let tx = Math.floor(x0 / TILE)
  let ty = Math.floor(y0 / TILE)
  const tx1 = Math.floor(x1 / TILE)
  const ty1 = Math.floor(y1 / TILE)
  const dx = x1 - x0
  const dy = y1 - y0
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
  const tDeltaX = stepX !== 0 ? Math.abs(TILE / dx) : Infinity
  const tDeltaY = stepY !== 0 ? Math.abs(TILE / dy) : Infinity
  let tMaxX = stepX > 0 ? ((tx + 1) * TILE - x0) / dx : stepX < 0 ? (tx * TILE - x0) / dx : Infinity
  let tMaxY = stepY > 0 ? ((ty + 1) * TILE - y0) / dy : stepY < 0 ? (ty * TILE - y0) / dy : Infinity
  let guard = map.w + map.h + 2
  while (guard-- > 0) {
    const tile = tileAt(map, tx, ty)
    const blocks =
      mode === 'sight'
        ? tile === TILE_WALL || tx < 0 || ty < 0 || tx >= map.w || ty >= map.h
        : tile === TILE_WALL || tile === TILE_CRATE || (tile === TILE_SANDBAG && !over)
    if (blocks) return { blocked: true, tx, ty, tile }
    if (tx === tx1 && ty === ty1) return { blocked: false, tx, ty, tile }
    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX
      tx += stepX
    } else {
      tMaxY += tDeltaY
      ty += stepY
    }
  }
  return { blocked: true, tx, ty, tile: TILE_WALL }
}

/** 시야 판정 (봇 LOS·전장의 안개) */
export function rayBlocked(map: GameMap, x0: number, y0: number, x1: number, y1: number): boolean {
  return rayCast(map, x0, y0, x1, y1, 'sight').blocked
}
