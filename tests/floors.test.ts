// 원정: 계단(F → 5초 뒤 모두 내려감) · 다음 층 · 마지막 층의 보스 · 정예.
import { describe, expect, it } from 'vitest'
import { BTN_USE, Input } from '../src/core/input'
import { buildMap } from '../src/core/map'
import { floorSeed } from '../src/core/dungeon'
import { EA_UNIQUE, MONSTER_LIST, UNIQUE } from '../src/core/monsters'
import { ACTS, STAGES, areaLevel, maxStageFor } from '../src/core/campaign'
import { emptySheet, xpNeed } from '../src/core/items'
import { createState, enterFloor, hashState, snapshot, step } from '../src/core/sim'
import { COUNTDOWN_TICKS, GameState } from '../src/core/state'
import { GameMap } from '../src/core/map'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

/** 세션이 하는 일과 같다: 계단 카운트다운이 끝나면 새 층 맵을 만들어 들어간다 */
function run(s: GameState, map: { m: GameMap }, seed: number, inputs: Input[]): void {
  step(s, map.m, inputs)
  if (s.pendingFloor > 0) {
    map.m = buildMap('crypt', 1, floorSeed(seed, s.pendingFloor))
    enterFloor(s, map.m, s.pendingFloor, seed)
  }
}

describe('원정 층', () => {
  it('계단에서 F → 5초 뒤 모두 다음 층 입구로, 쓰러진 사람도 일어난다', () => {
    const seed = 31
    const map = { m: buildMap('crypt', 1, seed) }
    const s = createState({ seed, chars: ['chim', 'magic'], floors: 3 }, map.m)
    for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) run(s, map, seed, [idle(), idle()])
    expect(s.stairX).toBeGreaterThan(0)
    const [a, b] = s.players
    b.hp = 0
    b.downed = true
    b.downTimer = 9999
    a.x = s.stairX
    a.y = s.stairY
    for (const m of s.monsters) m.st = 0 // 조용히
    run(s, map, seed, [{ ...idle(), buttons: BTN_USE }, idle()])
    expect(s.descend).toBeGreaterThan(0)
    for (let t = 0; t < 60 * 6 && s.floor === 1; t++) run(s, map, seed, [idle(), idle()])
    expect(s.floor).toBe(2)
    expect(b.downed).toBe(false)
    expect(Math.hypot(a.x - s.entryX, a.y - s.entryY)).toBeLessThan(100)
    expect(s.monsters.length).toBeGreaterThan(20)
  })

  it('막의 세 번째 원정(1-3 도살장): 마지막 층에는 계단 대신 도살자가 있고, 쓰러뜨리면 원정 완료', () => {
    const seed = 32
    const map = { m: buildMap('crypt', 1, seed) }
    const s = createState({ seed, chars: ['chim'], floors: 2, stage: 2 }, map.m)
    s.pendingFloor = 2
    map.m = buildMap('crypt', 1, floorSeed(seed, 2))
    enterFloor(s, map.m, 2, seed)
    expect(s.stairX).toBe(-1)
    const boss = s.monsters.find((m) => MONSTER_LIST[m.kind].boss)!
    expect(boss).toBeTruthy()
    for (let t = 0; t < 130; t++) run(s, map, seed, [idle()])
    expect(s.phase).toBe('playing')
    // 한 방 체력으로 두고 옆에서 쏜다
    boss.hp = 1
    const p = s.players[0]
    p.x = boss.x - 60
    p.y = boss.y
    let over = false
    for (let t = 0; t < 60 && !over; t++) {
      run(s, map, seed, [{ ...idle(), buttons: 1, aim: 0, aimDist: 15 }])
      over = s.phase === 'over'
      boss.x = p.x + 60
      boss.y = p.y
    }
    expect(over).toBe(true)
    expect(s.winner).toBe(0)
    // 보스는 전리품 둘
    expect(s.drops.filter((d) => d.owner === 0).length + p.bag.length).toBeGreaterThanOrEqual(2)
  })

  it('1·2번째 원정의 끝에는 우두머리(접두 능력 셋 · 호위 셋)가 있고, 쓰러뜨리면 원정 완료', () => {
    const seed = 35
    const map = { m: buildMap('crypt', 1, seed) }
    const s = createState({ seed, chars: ['chim'], floors: 2, stage: 1 }, map.m)
    map.m = buildMap('crypt', 1, floorSeed(seed, 2))
    enterFloor(s, map.m, 2, seed)
    expect(s.stairX).toBe(-1)
    const u = s.monsters.find((m) => m.elite & EA_UNIQUE)!
    expect(u).toBeTruthy()
    expect(u.kind).toBe(STAGES[1].unique!.kind)
    expect(s.monsters.filter((m) => m.pack === u.pack).length).toBe(4)
    let n = 0
    for (let b = (u.elite & ~EA_UNIQUE) >> 1; b; b >>= 1) n += b & 1
    expect(n).toBe(UNIQUE.affixes)
    for (let t = 0; t < 130; t++) run(s, map, seed, [idle()])
    u.hp = 0.5
    const p = s.players[0]
    p.x = u.x - 60
    p.y = u.y
    for (const m of s.monsters) if (m !== u) m.hp = m.maxHp = 1e9
    let over = false
    for (let t = 0; t < 60 && !over; t++) {
      run(s, map, seed, [{ ...idle(), buttons: 1, aim: 0, aimDist: 15 }])
      over = s.phase === 'over'
      u.x = p.x + 60
      u.y = p.y
    }
    expect(over).toBe(true)
    expect(s.winner).toBe(0)
  })

  it('무리 다섯에 하나는 정예 (체력 4배)', () => {
    const map = buildMap('crypt', 1, 33)
    const s = createState({ seed: 33, chars: ['chim'] }, map)
    const elites = s.monsters.filter((m) => m.elite)
    expect(elites.length).toBeGreaterThan(2)
    for (const e of elites) if (!(e.elite & EA_UNIQUE)) expect(e.maxHp).toBe(Math.round(MONSTER_LIST[e.kind].hp * 4))
  })

  it('층을 넘어가도 결정론 (두 번 돌려 같은 해시 · 스냅샷에서 이어도 같다)', () => {
    const go = () => {
      const seed = 34
      const map = { m: buildMap('crypt', 1, seed) }
      const s = createState({ seed, chars: ['chim', 'magic'], floors: 3 }, map.m)
      for (let t = 0; t < 400; t++) {
        if (t === 200) {
          s.players[0].x = s.stairX
          s.players[0].y = s.stairY
        }
        run(s, map, seed, [{ ...idle(), buttons: t === 201 ? BTN_USE : 0 }, idle()])
      }
      for (let t = 0; t < 300; t++) run(s, map, seed, [idle(), idle()])
      return { s, map }
    }
    const a = go()
    const b = go()
    expect(a.s.floor).toBe(2)
    expect(hashState(a.s)).toBe(hashState(b.s))
    // 받은 판(스냅샷)으로 층 맵을 다시 만들어 이어도 같다 — 난입·리싱크 길
    const snap = snapshot(a.s)
    const map2 = { m: buildMap('crypt', 1, floorSeed(34, snap.floor)) }
    for (let t = 0; t < 200; t++) {
      run(a.s, a.map, 34, [idle(), idle()])
      run(snap, map2, 34, [idle(), idle()])
    }
    expect(hashState(snap)).toBe(hashState(a.s))
  })

  it('캠페인 표: 막마다 원정 셋(끝은 우두머리·우두머리·보스), 지역 레벨이 오른다 · 앞 원정을 깨야 열린다', () => {
    let last = 0
    STAGES.forEach((sd, i) => {
      expect(sd.act).toBe(Math.floor(i / 3))
      expect(sd.n).toBe(i % 3)
      expect(sd.level).toBeGreaterThan(last)
      last = sd.level
      if (sd.n === 2) expect(sd.boss).toBeDefined()
      else expect(sd.unique).toBeDefined()
      expect(ACTS[sd.act].packs.reduce((a, p) => a + p.w, 0)).toBeCloseTo(1, 5)
    })
    expect(maxStageFor(0)).toBe(0)
    expect(maxStageFor(1)).toBe(Math.min(1, STAGES.length - 1))
    expect(maxStageFor(99)).toBe(STAGES.length - 1)
    // 지역 레벨: 층마다 +1, 파티가 훨씬 높으면 (파티 − 3) 까지 따라 올라온다
    expect(areaLevel(1, 1, 1)).toBe(STAGES[1].level)
    expect(areaLevel(1, 3, 1)).toBe(STAGES[1].level + 2)
    expect(areaLevel(0, 1, 20)).toBe(17)
    // 몬스터 레벨이 판에 들어간다
    const map = buildMap('crypt', 1, 36)
    const s = createState({ seed: 36, chars: ['chim'], stage: 1, sheets: [{ ...emptySheet(), level: 2 }] }, map)
    for (const m of s.monsters) expect(m.lvl).toBe(STAGES[1].level)
    expect(xpNeed(1)).toBe(360)
  })
})
