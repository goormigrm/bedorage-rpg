// 이어진 세계 (GUIDE 5·12장): 마을에서 시작 · 출구로 건너가기 · 지역마다 따로 도는 sim · 웨이포인트 · 타운 포털 ·
// 쓰러뜨린 보스 기억 · 얼린 지역 버리기 · 용병 따라오기 · 난입은 마을에서.
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, BTN_PORTAL, BTN_USE, CMD_WAYPOINT, Input } from '../src/core/input'
import { GameMap } from '../src/core/map'
import { AREAS, ACTS, WAYPOINTS, areaLayout, buildAreaMap, wpBit } from '../src/core/world'
import { MONSTER_LIST } from '../src/core/monsters'
import { PORTAL_CAST, areaView, createState, hashState, joinPlayer, step } from '../src/core/sim'
import { GameState } from '../src/core/state'
import { CharacterId } from '../src/core/characters'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const TOWN = ACTS[0].town

function world(seed: number) {
  const maps = new Map<number, GameMap>()
  return (id: number): GameMap => {
    let m = maps.get(id)
    if (!m) {
      m = buildAreaMap(seed, id)
      maps.set(id, m)
    }
    return m
  }
}

function game(chars: CharacterId[], seed = 51, extra: Partial<Parameters<typeof createState>[0]> = {}) {
  const mapOf = world(seed)
  const s = createState({ seed, chars, ...extra }, mapOf)
  const run = (n: number, input: (i: number, t: number) => Input = () => idle()) => {
    for (let t = 0; t < n; t++) step(s, mapOf, chars.map((_, i) => input(i, t)))
  }
  return { s, mapOf, run }
}

/** 사람을 지역의 출구 위에 세운다 (걸어가는 대신) */
function standOnExit(s: GameState, mapOf: (id: number) => GameMap, p: number, to: number) {
  const pl = s.players[p]
  const e = areaLayout(pl.area, mapOf(pl.area)).exits.find((x) => x.to === to)!
  pl.x = e.x
  pl.y = e.y
  pl.exitLock = 0
}

describe('이어진 세계', () => {
  it('새 게임은 마을에서 바로 시작한다 — 카운트다운 없음 · 몬스터 없음 · 쏠 수 없고 체력이 찬다', () => {
    const { s, run } = game(['chim'])
    expect(s.phase).toBe('playing')
    expect(s.players[0].area).toBe(TOWN)
    expect(s.monsters.length).toBe(0)
    // 마을 웨이포인트는 처음부터 열려 있다
    expect(s.players[0].wps & wpBit(TOWN)).not.toBe(0)
    s.players[0].hp = 10
    run(30, () => ({ ...idle(), buttons: BTN_FIRE }))
    expect(s.bullets.length).toBe(0)
    expect(s.players[0].shots).toBe(0)
    expect(s.players[0].hp).toBe(s.players[0].maxHp)
  })

  it('출구로 걸어 들어가면 그 사람만 이어진 지역으로 — 맞은편 입구 곁에 서고, 지역이 채워진다', () => {
    const { s, mapOf, run } = game(['chim', 'magic'])
    standOnExit(s, mapOf, 0, 1)
    run(1)
    const [a, b] = s.players
    expect(a.area).toBe(1)
    expect(b.area).toBe(TOWN)
    const l = areaLayout(1, mapOf(1))
    const back = l.exits.find((e) => e.to === TOWN)!
    expect(Math.hypot(a.x - back.arrive.x, a.y - back.arrive.y)).toBeLessThan(80)
    const v = areaView(s, 1)
    expect(v.monsters.length).toBeGreaterThan(40)
    // 화면용 사본: 다른 지역 사람은 away, 원본은 그대로
    expect(v.players[1].away).toBe(true)
    expect(s.players[1].left).toBe(false)
    // 되돌아가기
    run(40)
    standOnExit(s, mapOf, 0, TOWN)
    run(1)
    expect(a.area).toBe(TOWN)
  })

  it('두 사람이 다른 지역에 있어도 결정론 — 두 번 돌려 같고, JSON 으로 주고받은 판(리싱크·난입)에서 이어도 같다', () => {
    const play = () => {
      const g = game(['chim', 'cheolmyeon'], 52)
      // 한 명은 들판으로 나가 싸우고, 한 명은 마을에
      standOnExit(g.s, g.mapOf, 0, 1)
      g.run(1)
      // 들판에서 죽어 마을로 돌아가면 "두 지역" 이 아니게 된다 — 이 시험은 결정론이 목적이라 죽지 않게
      g.s.players[0].invuln = 1e9
      for (const m of areaView(g.s, 1).monsters) m.st = 1
      g.run(600, (i, t) => (i === 0 ? { ...idle(), buttons: t % 3 === 0 ? BTN_FIRE : 0, aim: (t * 7) & 1023, mx: t % 200 < 100 ? 1 : -1 } : { ...idle(), mx: t % 60 < 30 ? 1 : 0 }))
      return g
    }
    const a = play()
    const b = play()
    expect(a.s.players[0].area).not.toBe(a.s.players[1].area)
    expect(hashState(a.s)).toBe(hashState(b.s))
    // 네트워크로 받은 판처럼 JSON 을 거쳐 이어 돌린다 (맵은 받은 쪽이 시드로 새로 만든다)
    const recv = JSON.parse(JSON.stringify(a.s)) as GameState
    recv.rng = { ...a.s.rng }
    const mapOf2 = world(52)
    const input = (i: number, t: number): Input => (i === 0 ? { ...idle(), buttons: BTN_FIRE, aim: (t * 13) & 1023 } : idle())
    for (let t = 0; t < 300; t++) {
      step(a.s, a.mapOf, [input(0, t), input(1, t)])
      step(recv, mapOf2, [input(0, t), input(1, t)])
    }
    expect(hashState(recv)).toBe(hashState(a.s))
  })

  it('웨이포인트: 밟으면 열리고, 곁에서 열린 곳으로만 건너간다', () => {
    const { s, mapOf, run } = game(['chim'])
    const p = s.players[0]
    const tl = areaLayout(TOWN, mapOf(TOWN))
    // 아직 들판 웨이포인트를 모른다 → 못 간다
    p.x = tl.wp!.x
    p.y = tl.wp!.y
    run(1, () => ({ ...idle(), cmd: CMD_WAYPOINT, arg: 1 }))
    expect(p.area).toBe(TOWN)
    // 들판으로 걸어 나가 웨이포인트를 밟는다
    standOnExit(s, mapOf, 0, 1)
    run(1)
    const l1 = areaLayout(1, mapOf(1))
    p.x = l1.wp!.x
    p.y = l1.wp!.y
    run(1)
    expect(p.wps & wpBit(1)).not.toBe(0)
    // 마을로 웨이포인트 이동 → 다시 들판으로
    run(1, () => ({ ...idle(), cmd: CMD_WAYPOINT, arg: TOWN }))
    expect(p.area).toBe(TOWN)
    p.x = tl.wp!.x
    p.y = tl.wp!.y
    run(1, () => ({ ...idle(), cmd: CMD_WAYPOINT, arg: 1 }))
    expect(p.area).toBe(1)
    expect(WAYPOINTS).toContain(1)
  })

  it('타운 포털: T 로 1.5초 시전(움직이면 끊김) → F 로 마을 · 마을 쪽 포털로 돌아오면 닫힌다', () => {
    const { s, mapOf, run } = game(['chim', 'magic'])
    standOnExit(s, mapOf, 0, 1)
    run(1)
    const p = s.players[0]
    run(60)
    // 움직이면 끊긴다
    run(1, () => ({ ...idle(), buttons: BTN_PORTAL }))
    expect(p.portalCast).toBeGreaterThan(0)
    run(10, () => ({ ...idle(), mx: 1 }))
    expect(p.portalCast).toBe(0)
    // 가만히 시전
    run(1, () => ({ ...idle(), buttons: BTN_PORTAL }))
    run(PORTAL_CAST + 2)
    expect(s.portals.length).toBe(1)
    const q = s.portals[0]
    expect(q.area).toBe(1)
    // F 로 마을로
    p.x = q.x
    p.y = q.y
    run(1, (i) => (i === 0 ? { ...idle(), buttons: BTN_USE } : idle()))
    expect(p.area).toBe(TOWN)
    // 동료가 마을 쪽 포털로 들판에 간다 (포털은 남는다)
    const tl = areaLayout(TOWN, mapOf(TOWN))
    const mate = s.players[1]
    mate.x = tl.portal!.x
    mate.y = tl.portal!.y
    run(2)
    run(1, (i) => (i === 1 ? { ...idle(), buttons: BTN_USE } : idle()))
    expect(mate.area).toBe(1)
    expect(s.portals.length).toBe(1)
    // 주인이 돌아가면 닫힌다
    p.x = tl.portal!.x
    p.y = tl.portal!.y
    run(2)
    run(1, (i) => (i === 0 ? { ...idle(), buttons: BTN_USE } : idle()))
    expect(p.area).toBe(1)
    expect(s.portals.length).toBe(0)
  })

  it('보스 방: 도살자를 쓰러뜨리면 기억한다 — 지역을 버렸다 다시 와도 다시 나오지 않는다', () => {
    const { s, mapOf, run } = game(['chim'], 53, { area: 9 })
    const boss = s.monsters.find((m) => MONSTER_LIST[m.kind].boss)!
    expect(boss).toBeTruthy()
    boss.hp = 1
    const p = s.players[0]
    let down = false
    for (let t = 0; t < 120 && !down; t++) {
      p.x = boss.x - 60
      p.y = boss.y
      p.invuln = 99
      run(1, () => ({ ...idle(), buttons: BTN_FIRE, aim: 0, aimDist: 15 }))
      down = s.events.some((e) => e.type === 'bossDown')
    }
    expect(down).toBe(true)
    expect(s.killed).toContain(9)
    // 다른 지역 넷을 돌아 도살장을 버리게 한 뒤 다시 온다
    for (const to of [8, 7, 6, 5]) {
      p.area = to === 8 ? 9 : p.area
      standOnExit(s, mapOf, 0, to)
      run(1)
      expect(p.area).toBe(to)
    }
    expect(s.areas.some((a) => a.id === 9)).toBe(false)
    for (const to of [6, 7, 8, 9]) {
      standOnExit(s, mapOf, 0, to)
      run(1)
    }
    expect(p.area).toBe(9)
    expect(s.monsters.some((m) => MONSTER_LIST[m.kind].boss)).toBe(false)
    expect(s.monsters.length).toBeGreaterThan(0)
  })

  it('용병·동료 봇은 따라가는 사람이 다른 지역으로 가면 곁으로 따라온다', () => {
    const { s, mapOf, run } = game(['chim', 'magic'], 54, { follow: [-1, 0] })
    standOnExit(s, mapOf, 0, 1)
    run(2)
    expect(s.players[1].area).toBe(1)
    expect(Math.hypot(s.players[1].x - s.players[0].x, s.players[1].y - s.players[0].y)).toBeLessThan(100)
  })

  it('게임 중 난입은 마을에서 시작한다', () => {
    const { s, mapOf, run } = game(['chim', 'magic'], 55, { absent: [false, true] })
    standOnExit(s, mapOf, 0, 1)
    run(5)
    joinPlayer(s, mapOf, 1, 'magic')
    expect(s.players[1].area).toBe(TOWN)
    expect(s.players[1].left).toBe(false)
    run(5)
    expect(s.players[0].area).toBe(1)
  })

  it('1막 지역 표: 모든 링크가 양쪽으로 이어지고, 모든 지역의 맵과 자리가 만들어진다', () => {
    const mapOf = world(56)
    for (const a of AREAS) {
      for (const to of a.links) expect(AREAS[to].links).toContain(a.id)
      const l = areaLayout(a.id, mapOf(a.id))
      expect(l.exits.length).toBe(a.links.length)
      if (a.wp) expect(l.wp).not.toBeNull()
    }
  })
})
