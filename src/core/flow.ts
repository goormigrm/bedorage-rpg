// 몬스터 길찾기(흐름장)와 공간 해시. 둘 다 **GameState 밖의 캐시**지만 상태·맵만으로 언제든 똑같이 다시 만들 수 있다
// (DESIGN 2장 6 — 스냅샷을 받은 사람도 같은 값을 얻는다). 그래서 결정론을 해치지 않는다.
//
// 흐름장: 플레이어가 선 타일에서 모든 바닥까지의 걸음 거리(8방향). 몬스터는 자기 타일 이웃 중 거리가 가장 작은 쪽으로 간다.
// 몬스터마다 BFS 를 하면 수백 번이지만, 흐름장은 **플레이어 수만큼**이고 그 사람이 타일을 옮길 때만 새로 잰다.

import { GameMap, TILE, walkField } from './map'

interface FlowCache {
  version: number
  fields: Map<number, Float64Array>
  /** 오래된 것부터 버리기 위한 순서 */
  order: number[]
}

const caches = new WeakMap<GameMap, FlowCache>()
/** 플레이어 4명이 이리저리 다녀도 충분한 수. 넘치면 가장 오래 안 쓴 것부터 버린다 */
const MAX_FIELDS = 24

/** 타일 인덱스를 시작점으로 하는 걸음 거리 (-1 = 못 감). 맵 타일이 바뀌면(map.version) 새로 잰다 */
export function flowField(map: GameMap, tile: number): Float64Array {
  let c = caches.get(map)
  if (!c || c.version !== map.version) {
    c = { version: map.version, fields: new Map(), order: [] }
    caches.set(map, c)
  }
  const hit = c.fields.get(tile)
  if (hit) return hit
  const f = walkField(map, tile)
  c.fields.set(tile, f)
  c.order.push(tile)
  if (c.order.length > MAX_FIELDS) c.fields.delete(c.order.shift()!)
  return f
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1]
const DY = [0, 0, 1, -1, 1, -1, 1, -1]

/**
 * (x,y) 에 있는 것이 흐름장을 따라 한 칸 나아갈 방향의 목표점(px). 이미 목표 타일이거나 길이 없으면 null.
 * 대각선은 양옆이 모두 비어야 간다(모서리 끼임 방지 — walkField 와 같은 규칙).
 */
export function flowStep(map: GameMap, field: Float64Array, x: number, y: number): { x: number; y: number } | null {
  const tx = Math.floor(x / TILE)
  const ty = Math.floor(y / TILE)
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return null
  const here = field[ty * map.w + tx]
  if (here <= 0) return null
  let best = -1
  let bestD = here
  for (let k = 0; k < 8; k++) {
    const nx = tx + DX[k]
    const ny = ty + DY[k]
    if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue
    const d = field[ny * map.w + nx]
    if (d < 0 || d >= bestD) continue
    if (k >= 4 && (field[ty * map.w + nx] < 0 || field[ny * map.w + tx] < 0)) continue
    bestD = d
    best = k
  }
  if (best < 0) return null
  return { x: (tx + DX[best] + 0.5) * TILE, y: (ty + DY[best] + 0.5) * TILE }
}

/**
 * 공간 해시: 칸(64px)마다 몬스터 번호 목록. 매 틱 몬스터가 움직인 뒤 다시 만든다(상태에서 바로 나오므로 저장하지 않는다).
 * 탄·근접·폭발·밀어내기가 주변 몬스터만 보게 해 준다. 120마리 × 탄 200개를 전부 대조하면 틱이 무거워진다.
 */
export class Grid {
  static readonly CELL = 64
  readonly cw: number
  readonly ch: number
  private head: Int32Array
  private next: Int32Array = new Int32Array(0)

  constructor(pw: number, ph: number) {
    this.cw = Math.ceil(pw / Grid.CELL) + 1
    this.ch = Math.ceil(ph / Grid.CELL) + 1
    this.head = new Int32Array(this.cw * this.ch)
  }

  /** xs/ys 배열(몬스터 순서)로 다시 짓는다. alive[i] 가 false 면 넣지 않는다 */
  build(n: number, xs: (i: number) => number, ys: (i: number) => number, alive: (i: number) => boolean): void {
    this.head.fill(-1)
    if (this.next.length < n) this.next = new Int32Array(Math.max(n, this.next.length * 2, 64))
    // 뒤에서부터 넣어 칸 안 순서가 배열 순서와 같게 한다 (읽기 쉬운 결정론)
    for (let i = n - 1; i >= 0; i--) {
      if (!alive(i)) continue
      const c = this.cellOf(xs(i), ys(i))
      this.next[i] = this.head[c]
      this.head[c] = i
    }
  }

  private cellOf(x: number, y: number): number {
    let cx = Math.floor(x / Grid.CELL)
    let cy = Math.floor(y / Grid.CELL)
    if (cx < 0) cx = 0
    else if (cx >= this.cw) cx = this.cw - 1
    if (cy < 0) cy = 0
    else if (cy >= this.ch) cy = this.ch - 1
    return cy * this.cw + cx
  }

  /** 사각형(px)과 겹치는 칸의 몬스터 번호를 차례로 cb 에 넘긴다. cb 가 true 를 돌려주면 멈춘다 */
  query(x0: number, y0: number, x1: number, y1: number, cb: (i: number) => boolean | void): void {
    const cx0 = Math.max(0, Math.floor(Math.min(x0, x1) / Grid.CELL))
    const cy0 = Math.max(0, Math.floor(Math.min(y0, y1) / Grid.CELL))
    const cx1 = Math.min(this.cw - 1, Math.floor(Math.max(x0, x1) / Grid.CELL))
    const cy1 = Math.min(this.ch - 1, Math.floor(Math.max(y0, y1) / Grid.CELL))
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let i = this.head[cy * this.cw + cx]; i >= 0; i = this.next[i]) {
          if (cb(i) === true) return
        }
      }
    }
  }
}
