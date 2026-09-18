// 던전 층 채우기: 입구를 정하고, 입구에서 먼 방들에 몬스터 **무리**를 시드로 배치한다.
// 무리는 처음에 잠들어 있다가(MS_SLEEP) 누가 다가오면 무리째 깨어난다 — 디아블로식 "방마다 한 무리".
// 모든 추첨은 시드로 만든 전용 Rng 로 한다(같은 시드 = 모든 브라우저에서 같은 배치).

import { GameMap, TILE, TILE_FLOOR, walkField } from './map'
import { ELITE, ELITE_AFFIXES, MONSTER_LIST, hpScaleFor } from './monsters'
import { PackDef } from './world'
import { Rng, makeRng, rand, randInt } from './rng'
import { GameState, MS_SLEEP, Monster } from './state'

/** 입구에서 이 걸음 수 안에는 무리를 두지 않는다 (들어서자마자 몰리지 않게) */
const SAFE_STEPS = 16
/** 무리 사이 최소 간격 (타일) */
const PACK_GAP = 9
/** 바닥 몇 칸당 무리 하나 (D4 — GUIDE 7장 "무리를 쓸어 담는다": 200 → 160, 72×54 지역이면 약 22무리 · 140마리) */
const TILES_PER_PACK = 160

/** 층 입구: 3×3 이 트인 칸 중 맨 왼쪽 위 (map.spawns[0] 이 그것이다) */
export function entryOf(map: GameMap): { x: number; y: number } {
  return map.spawns[0] ?? { x: map.pw / 2, y: map.ph / 2 }
}

export function makeMonster(state: GameState, kind: number, x: number, y: number, pack: number, hpMul: number, pow = 100, lvl = 1): Monster {
  const def = MONSTER_LIST[kind]
  const hp = Math.round(def.hp * hpMul)
  return {
    id: state.nextMonsterId++,
    kind,
    x,
    y,
    hp,
    maxHp: hp,
    aim: 0,
    st: MS_SLEEP,
    t: 0,
    cd: 0,
    target: -1,
    ax: 0,
    ay: 0,
    kx: 0,
    ky: 0,
    stun: 0,
    hitTick: -10000,
    lastBy: -1,
    pack,
    los: 0,
    moving: 0,
    slow: 0,
    vuln: 0,
    vulnPct: 0,
    mark: 0,
    taunt: 0,
    tag: 0,
    pow,
    lvl,
    scd: 0,
    phase: 0,
    elite: 0,
    mode: 0,
  }
}

/** 무리 구성: 막의 무리 틀 중 하나를 비중대로 뽑아 채운다. 반환은 kind 번호 목록 */
function packMembers(rng: Rng, packs: PackDef[]): number[] {
  const roll = rand(rng)
  let acc = 0
  let pick = packs[packs.length - 1]
  for (const p of packs) {
    acc += p.w
    if (roll < acc) {
      pick = p
      break
    }
  }
  const out: number[] = []
  for (const [kind, lo, hi] of pick.groups) {
    const n = randInt(rng, lo, hi + 1)
    for (let i = 0; i < n; i++) out.push(kind)
  }
  return out
}

/** 정예 접두 능력 수: 지역 레벨 12 부터 둘, 22 부터 셋 */
export function affixCount(level: number): number {
  return 1 + (level >= 12 ? 1 : 0) + (level >= 22 ? 1 : 0)
}

/** 겹치지 않게 접두 능력 n 개를 더한다 */
export function rollAffixes(rng: Rng, elite: number, n: number): number {
  for (let k = 0; k < n; ) {
    const a = ELITE_AFFIXES[randInt(rng, 0, ELITE_AFFIXES.length)]
    if (elite & a.bit) continue
    elite |= a.bit
    k++
  }
  return elite
}

/**
 * 지역에 몬스터 무리를 채운다. state.monsters(묶인 지역)에 넣고 monstersTotal 을 정한다. players = 자리 수 (인원 보정용).
 * entry 에서 걸어서 SAFE_STEPS 안 · safe 자리(출구·웨이포인트) 7칸 안에는 두지 않는다.
 * density = 무리 수 배율 (보스 방은 절반 — 보스에게 힘을 남겨 두게)
 */
export function populate(
  state: GameState, map: GameMap, seed: number, players: number, level: number, density: number, packs: PackDef[],
  entry: { x: number; y: number }, safe: { x: number; y: number }[],
): void {
  const rng = makeRng((seed ^ 0x51ed27) >>> 0)
  const et = Math.floor(entry.y / TILE) * map.w + Math.floor(entry.x / TILE)
  const steps = walkField(map, et)
  const open3 = (tx: number, ty: number) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx
        const y = ty + dy
        if (x < 1 || y < 1 || x >= map.w - 1 || y >= map.h - 1) return false
        if (map.tiles[y * map.w + x] !== TILE_FLOOR) return false
      }
    }
    return true
  }
  const cand: number[] = []
  for (let ty = 2; ty < map.h - 2; ty++) {
    for (let tx = 2; tx < map.w - 2; tx++) {
      const i = ty * map.w + tx
      if (steps[i] < SAFE_STEPS) continue
      const px = tx * TILE + TILE / 2
      const py = ty * TILE + TILE / 2
      if (safe.some((q) => (q.x - px) ** 2 + (q.y - py) ** 2 < (7 * TILE) ** 2)) continue
      if (open3(tx, ty)) cand.push(i)
    }
  }
  // 섞기 (Fisher–Yates, 전용 rng)
  for (let i = cand.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i + 1)
    const t = cand[i]
    cand[i] = cand[j]
    cand[j] = t
  }
  let floor = 0
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE_FLOOR) floor++
  const want = Math.max(3, Math.round((floor / TILES_PER_PACK) * density))
  const centers: number[] = []
  for (const c of cand) {
    if (centers.length >= want) break
    const cx = c % map.w
    const cy = (c / map.w) | 0
    let ok = true
    for (const o of centers) {
      const ox = o % map.w
      const oy = (o / map.w) | 0
      if ((ox - cx) ** 2 + (oy - cy) ** 2 < PACK_GAP * PACK_GAP) {
        ok = false
        break
      }
    }
    if (ok) centers.push(c)
  }
  // 파티 레벨만큼 몬스터도 세진다 (디아블로 3 처럼 내 레벨에 맞춘 세계): 레벨마다 체력 +10% · 피해 +6%
  const hpMul = hpScaleFor(players) * (1 + 0.1 * (level - 1))
  const pow = Math.round(100 * (1 + 0.06 * (level - 1)))
  centers.forEach((c, pack) => {
    const cx = (c % map.w) * TILE + TILE / 2
    const cy = ((c / map.w) | 0) * TILE + TILE / 2
    const kinds = packMembers(rng, packs)
    const placed: Monster[] = []
    for (const kind of kinds) {
      const def = MONSTER_LIST[kind]
      // 가운데서 바깥으로 돌며 빈 자리를 찾는다 (벽·다른 몬스터와 겹치지 않게)
      for (let tries = 0; tries < 40; tries++) {
        const ring = Math.floor(tries / 8)
        const a = randInt(rng, 0, 1024)
        const d = ring * 18 + randInt(rng, 0, 14)
        // 삼각함수 없이 방향을 고른다: 8방향 격자 + 흔들림 (fixedmath 를 쓰지 않아도 결정론이면 된다)
        const dirs = [[1, 0], [0.707, 0.707], [0, 1], [-0.707, 0.707], [-1, 0], [-0.707, -0.707], [0, -1], [0.707, -0.707]]
        const dir = dirs[(a >> 7) & 7]
        const x = cx + dir[0] * d
        const y = cy + dir[1] * d
        const tx = Math.floor(x / TILE)
        const ty = Math.floor(y / TILE)
        if (tx < 1 || ty < 1 || tx >= map.w - 1 || ty >= map.h - 1) continue
        if (map.tiles[ty * map.w + tx] !== TILE_FLOOR) continue
        // 몸이 벽에 걸치지 않게 (타일 가장자리에서 반지름만큼)
        const lx = x - tx * TILE
        const ly = y - ty * TILE
        const r = def.r
        if ((lx < r && map.tiles[ty * map.w + tx - 1] !== TILE_FLOOR) || (lx > TILE - r && map.tiles[ty * map.w + tx + 1] !== TILE_FLOOR)) continue
        if ((ly < r && map.tiles[(ty - 1) * map.w + tx] !== TILE_FLOOR) || (ly > TILE - r && map.tiles[(ty + 1) * map.w + tx] !== TILE_FLOOR)) continue
        let clash = false
        for (const o of placed) {
          const rr = r + MONSTER_LIST[o.kind].r + 2
          if ((o.x - x) ** 2 + (o.y - y) ** 2 < rr * rr) {
            clash = true
            break
          }
        }
        if (clash) continue
        const m = makeMonster(state, kind, x, y, pack, hpMul, pow, level)
        m.aim = randInt(rng, 0, 1024)
        // 다섯 무리에 하나는 첫 놈이 정예 (무리 번호로 정하므로 결정론)
        if (placed.length === 0 && pack % 5 === 2) {
          m.elite = 1
          m.maxHp = m.hp = Math.round(m.hp * ELITE.hp)
          m.pow = Math.round(m.pow * ELITE.pow)
          // 접두 능력: 지역 레벨이 오를수록 많아진다 (겹치지 않게)
          m.elite = rollAffixes(rng, m.elite, affixCount(level))
        }
        placed.push(m)
        break
      }
    }
    state.monsters.push(...placed)
  })
  state.monstersTotal = state.monsters.length
}
