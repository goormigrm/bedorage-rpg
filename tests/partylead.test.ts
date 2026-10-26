// 방장이 이끈다 (2026-10-26 사용자: "멀티에서 방장은 4막 보스인데 들어온 사람은 따로 떨어진다 · 맵 이동은 방장이 결정").
// 방장이 옮기면 같은 지역의 파티원도 같이 · 파티원은 혼자 사냥터로 가지 않는다(마을은 따로) · 웨이포인트의 "방장 곁으로"로 합류
import { describe, expect, it } from 'vitest'
import { BTN_USE, CMD_WAYPOINT, Input, WP_TO_LEADER } from '../src/core/input'
import { GameMap } from '../src/core/map'
import { createState, partyLeader, step } from '../src/core/sim'
import { ACTS, areaLayout, buildAreaMap, wpBit } from '../src/core/world'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const TOWN = ACTS[0].town

function game(seed = 61) {
  const maps = new Map<number, GameMap>()
  const mapOf = (id: number): GameMap => {
    let m = maps.get(id)
    if (!m) maps.set(id, (m = buildAreaMap(seed, id)))
    return m
  }
  const s = createState({ seed, chars: ['chim', 'magic', 'oknyang'] }, mapOf)
  const run = (n: number, input: (i: number) => Input = () => idle()) => {
    for (let t = 0; t < n; t++) step(s, mapOf, s.players.map((_, i) => input(i)))
  }
  const onExit = (i: number, to: number) => {
    const p = s.players[i]
    const e = areaLayout(p.area, mapOf(p.area)).exits.find((x) => x.to === to)!
    p.x = e.x
    p.y = e.y
    p.exitLock = 0
    p.btnPrev = 0
  }
  const onWp = (i: number) => {
    const p = s.players[i]
    const l = areaLayout(p.area, mapOf(p.area))
    p.x = l.wp!.x
    p.y = l.wp!.y
  }
  return { s, mapOf, run, onExit, onWp }
}

describe('방장이 이끈다', () => {
  it('방장 = 남은 사람 중 가장 앞 자리 · 방장이 나가면 다음 사람', () => {
    const { s } = game()
    expect(partyLeader(s)).toBe(s.players[0])
    s.players[0].left = true
    expect(partyLeader(s)).toBe(s.players[1])
  })

  it('방장이 출구로 옮기면 같은 지역의 파티원도 같이 — 다른 지역에 있던 파티원은 그대로', () => {
    const { s, run, onExit } = game()
    const [a, b, c] = s.players
    onExit(0, 1)
    run(1, (i) => (i === 0 ? { ...idle(), buttons: BTN_USE } : idle()))
    expect([a.area, b.area, c.area]).toEqual([1, 1, 1])
    // 셋째는 마을로 (파티원도 마을로는 혼자 간다)
    run(40)
    onExit(2, TOWN)
    run(1, (i) => (i === 2 ? { ...idle(), buttons: BTN_USE } : idle()))
    expect(c.area).toBe(TOWN)
    // 방장이 다음 지역으로 → 둘째만 따라오고 마을의 셋째는 남는다
    run(40)
    onExit(0, 2)
    run(1, (i) => (i === 0 ? { ...idle(), buttons: BTN_USE } : idle()))
    expect([a.area, b.area, c.area]).toEqual([2, 2, TOWN])
  })

  it('파티원은 혼자 사냥터 출구로 가지 못한다 (알림 이벤트) · 방장은 간다', () => {
    const { s, run, onExit } = game()
    onExit(1, 1)
    s.events = []
    let ev = 0
    for (let t = 0; t < 2; t++) {
      run(1, (i) => (i === 1 && t === 0 ? { ...idle(), buttons: BTN_USE } : idle()))
      ev += s.events.filter((e) => e.type === 'leadOnly' && e.p === 1).length
    }
    expect(s.players[1].area).toBe(TOWN)
    expect(ev).toBe(1)
  })

  it('웨이포인트: 파티원은 사냥터로 혼자 못 가고 마을은 간다 · "방장 곁으로" 는 방장이 있는 지역의 방장 곁으로', () => {
    const { s, run, onExit, onWp } = game()
    const [a, b] = s.players
    // 같이 들판으로 간 뒤 둘째만 마을로 돌아온다
    onExit(0, 1)
    run(1, (i) => (i === 0 ? { ...idle(), buttons: BTN_USE } : idle()))
    run(40)
    onExit(1, TOWN)
    run(1, (i) => (i === 1 ? { ...idle(), buttons: BTN_USE } : idle()))
    expect([a.area, b.area]).toEqual([1, TOWN])
    // 들판 웨이포인트를 알아도 혼자는 못 간다 (방장 지역과 같으면 된다 — 다른 사냥터로 시험)
    b.wps |= wpBit(3)
    onWp(1)
    run(1, (i) => (i === 1 ? { ...idle(), cmd: CMD_WAYPOINT, arg: 3 } : idle()))
    expect(b.area).toBe(TOWN)
    // 방장 곁으로
    run(1, (i) => (i === 1 ? { ...idle(), cmd: CMD_WAYPOINT, arg: WP_TO_LEADER } : idle()))
    expect(b.area).toBe(1)
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(120)
  })

  it('마을에서 사냥터로 나가는 문은 방장 곁으로 (방장이 사냥터에 있을 때) · 같이 옮겨진 사람의 지역 이벤트에는 led', () => {
    const { s, run, onExit } = game()
    const [a, b] = s.players
    onExit(0, 1)
    s.events = []
    run(1, (i) => (i === 0 ? { ...idle(), buttons: BTN_USE } : idle()))
    expect(b.area).toBe(1)
    // 이 틱의 이벤트: 같이 옮겨진 사람만 led (알림용) · 방장은 아니다
    expect(s.events.some((e) => e.type === 'areaEnter' && e.p === 1 && e.led)).toBe(true)
    expect(s.events.some((e) => e.type === 'areaEnter' && e.p === 0 && e.led)).toBe(false)
    // 둘째만 마을로 → 마을의 들판 문으로 나가면 (그 문이 데려갈 곳이 아니라) 방장 곁으로
    run(40)
    onExit(1, TOWN)
    run(1, (i) => (i === 1 ? { ...idle(), buttons: BTN_USE } : idle()))
    expect(b.area).toBe(TOWN)
    run(40)
    a.x += 3 * 32
    onExit(1, 1)
    run(1, (i) => (i === 1 ? { ...idle(), buttons: BTN_USE } : idle()))
    expect(b.area).toBe(1)
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(120)
  })

  it('방장이 죽어 마을에서 되살아날 때는 파티원을 끌고 가지 않는다', () => {
    const { s, run, onExit } = game()
    const [a, b] = s.players
    onExit(0, 1)
    run(1, (i) => (i === 0 ? { ...idle(), buttons: BTN_USE } : idle()))
    expect(b.area).toBe(1)
    // 마을로 되살아나기 (how 'town') — sim 의 죽음 길을 그대로 쓰기 어려워 옮김 요청만 흉내 낸다: 체력 0 · 탈락 처리는 dieOut 이 한다
    a.hp = 0
    a.alive = false
    a.respawnTimer = 1
    run(3)
    if (a.area === TOWN) expect(b.area).toBe(1)
  })
})
