// 후원 이벤트 (2026-09-23 — 치지직 후원 · core/donate.ts): 입력 명령으로 모두의 판에 같게 · 마을에서는 없음 ·
// 소환한 보스는 막 보스 처치로 치지 않는다 · 손 떨림 · 거꾸로 · 봉인 · 광폭화 · 암흑
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, BTN_SKILL1, BTN_USE, CMD_DONATE, Input } from '../src/core/input'
import { GameMap } from '../src/core/map'
import { ACTS, areaLayout, buildAreaMap } from '../src/core/world'
import { EA_UNIQUE, MONSTER_LIST } from '../src/core/monsters'
import { SUMMON_CAP, areaView, createState, hashState, step } from '../src/core/sim'
import { GameState, MS_CHASE } from '../src/core/state'
import { CharacterId } from '../src/core/characters'
import { DONATE_EVENTS, DON_DARK, DON_INVERT, DON_SEAL, DON_SHAKE, RAGE_POW, RAGE_TICKS } from '../src/core/donate'
import { eventForAmount } from '../src/game/stream'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const TOWN = ACTS[0].town
const ev = (key: string, seq = 0) => DONATE_EVENTS.find((e) => e.key === key)!.id | (seq << 4)

function game(seed = 77, chars: CharacterId[] = ['chim', 'cheolmyeon']) {
  const maps = new Map<number, GameMap>()
  const mapOf = (id: number): GameMap => {
    let m = maps.get(id)
    if (!m) {
      m = buildAreaMap(seed, id)
      maps.set(id, m)
    }
    return m
  }
  const s = createState({ seed, chars }, mapOf)
  const run = (inputs: (i: number) => Input) => step(s, mapOf, chars.map((_, i) => inputs(i)))
  const donate = (arg: number) => run((i) => (i === 0 ? { ...idle(), cmd: CMD_DONATE, arg } : idle()))
  return { s, mapOf, run, donate }
}

/** 0번을 들판(지역 1)으로 보낸다 — 출구 위에서 F */
function toField(g: ReturnType<typeof game>): void {
  const p = g.s.players[0]
  const e = areaLayout(p.area, g.mapOf(p.area)).exits.find((x) => x.to === 1)!
  p.x = e.x
  p.y = e.y
  p.exitLock = 0
  p.btnPrev = 0
  g.run((i) => (i === 0 ? { ...idle(), buttons: BTN_USE } : idle()))
  expect(p.area).toBe(1)
}

const summoned = (s: GameState) => areaView(s, 1).monsters.filter((m) => m.sum !== undefined && m.hp > 0)

describe('후원 이벤트 — 소환', () => {
  it('이벤트는 열 가지이고 금액이 오를수록 세다(번호 · 금액 순서가 같다)', () => {
    expect(DONATE_EVENTS.length).toBe(10)
    for (let i = 1; i < DONATE_EVENTS.length; i++) expect(DONATE_EVENTS[i].amount).toBeGreaterThan(DONATE_EVENTS[i - 1].amount)
  })

  it('금액표: 1만 5천 칸이 없고 2만 · 3만 · 5만 · 10만 (2026-09-23 요청) · 넘는 것 중 가장 비싼 이벤트', () => {
    expect(DONATE_EVENTS.map((e) => e.amount)).toEqual([1000, 2000, 3000, 5000, 7000, 10000, 20000, 30000, 50000, 100000])
    const cfg = { bubbles: true, table: true, auto: false, amounts: DONATE_EVENTS.map((e) => e.amount) }
    expect(eventForAmount(999, cfg)).toBeUndefined()
    expect(eventForAmount(1000, cfg)?.key).toBe('horde')
    expect(eventForAmount(15000, cfg)?.key).toBe('unique')
    expect(eventForAmount(20000, cfg)?.key).toBe('seal')
    expect(eventForAmount(49999, cfg)?.key).toBe('rage')
    expect(eventForAmount(100000, cfg)?.key).toBe('hell')
    expect(eventForAmount(500000, cfg)?.key).toBe('hell')
    // 끈 칸(0 원)은 건너뛴다
    expect(eventForAmount(100000, { ...cfg, amounts: cfg.amounts.map((a, i) => (i === 9 ? 0 : a)) })?.key).toBe('boss')
  })

  it('마을에서는 아무 일도 없다', () => {
    const g = game()
    expect(g.s.players[0].area).toBe(TOWN)
    const before = g.s.monsters.length
    g.donate(ev('boss'))
    g.donate(ev('dark'))
    expect(g.s.monsters.length).toBe(before)
    expect(g.s.players[0].don).toBeUndefined()
  })

  it('좀비 떼 · 정예 · 중간보스 · 막 보스가 부른 사람 둘레에 깨어 나온다', () => {
    const g = game()
    toField(g)
    const p = g.s.players[0]
    g.donate(ev('horde', 1))
    let got = summoned(g.s)
    expect(got.length).toBe(8)
    expect(got.every((m) => m.st === MS_CHASE && m.sumBy === 0 && m.sum === 2)).toBe(true)
    for (const m of got) expect(Math.hypot(m.x - p.x, m.y - p.y)).toBeLessThan(12 * 32)

    g.donate(ev('elite', 2))
    expect(summoned(g.s).filter((m) => m.sum === 3 && m.elite !== 0).length).toBe(1)

    g.donate(ev('unique', 3))
    got = summoned(g.s)
    expect(got.some((m) => (m.elite & EA_UNIQUE) !== 0 && m.sum === 4)).toBe(true)

    g.donate(ev('boss', 4))
    const boss = summoned(g.s).find((m) => m.sum === 5)!
    expect(MONSTER_LIST[boss.kind].id).toBe('butcher') // 1막 보스
    const e = g.s.events.find((x) => x.type === 'donate')
    expect(e && e.type === 'donate' && e.m === boss.id).toBe(true)
  })

  it('지옥문: 막 보스 + 중간보스 둘 + 암흑', () => {
    const g = game()
    toField(g)
    g.donate(ev('hell', 5))
    const got = summoned(g.s)
    expect(got.filter((m) => MONSTER_LIST[m.kind].boss).length).toBe(1)
    expect(got.filter((m) => (m.elite & EA_UNIQUE) !== 0).length).toBe(2)
    expect(g.s.players[0].don![DON_DARK]).toBeGreaterThan(0)
  })

  it('소환한 보스를 쓰러뜨려도 막 보스 처치 · 퀘스트로 치지 않는다', () => {
    const g = game()
    toField(g)
    g.donate(ev('boss'))
    const boss = summoned(g.s).find((m) => MONSTER_LIST[m.kind].boss)!
    const p = g.s.players[0]
    let down = false
    for (let t = 0; t < 400 && !down; t++) {
      // 코앞에 붙여 두고 쏜다 (보스는 한 방에 쓰러지게 체력 1)
      boss.hp = Math.min(boss.hp, 1)
      boss.x = p.x + 50
      boss.y = p.y
      p.hp = p.maxHp
      g.run((i) => (i === 0 ? { ...idle(), aim: 0, buttons: BTN_FIRE } : idle()))
      down = g.s.events.some((e) => e.type === 'mdeath' && e.m === boss.id)
    }
    expect(down).toBe(true)
    expect(g.s.killed).not.toContain(1)
  })

  it('한 지역의 후원 괴물은 한도까지만 (그 뒤는 소환 없이 지나간다)', () => {
    const g = game()
    toField(g)
    for (let k = 0; k < 10; k++) g.donate(ev('horde', k))
    expect(summoned(g.s).length).toBeLessThanOrEqual(SUMMON_CAP + 7)
  })

  it('같은 입력이면 두 판이 같다 (락스텝)', () => {
    const a = game(91)
    const b = game(91)
    toField(a)
    toField(b)
    for (const g of [a, b]) {
      g.donate(ev('unique', 3))
      g.donate(ev('shake', 4))
      for (let t = 0; t < 30; t++) g.run((i) => (i === 0 ? { ...idle(), aim: 100, buttons: BTN_FIRE } : idle()))
    }
    expect(hashState(a.s)).toBe(hashState(b.s))
  })
})

describe('후원 이벤트 — 효과', () => {
  it('손 떨림: 조준이 흔들린다 · 시간이 지나면 멈춘다', () => {
    const g = game()
    toField(g)
    g.donate(ev('shake'))
    const p = g.s.players[0]
    const aims = new Set<number>()
    for (let t = 0; t < 20; t++) {
      g.run((i) => (i === 0 ? { ...idle(), aim: 300 } : idle()))
      aims.add(p.aim)
    }
    expect(aims.size).toBeGreaterThan(5)
    p.don![DON_SHAKE] = 1
    g.run((i) => (i === 0 ? { ...idle(), aim: 300 } : idle()))
    g.run((i) => (i === 0 ? { ...idle(), aim: 300 } : idle()))
    expect(p.aim).toBe(300)
  })

  it('거꾸로 걷기: 누른 쪽의 반대로 간다', () => {
    const g = game()
    toField(g)
    const p = g.s.players[0]
    const x0 = p.x
    g.donate(ev('invert'))
    expect(p.don![DON_INVERT]).toBeGreaterThan(0)
    for (let t = 0; t < 10; t++) g.run((i) => (i === 0 ? { ...idle(), mx: 1, my: 0 } : idle()))
    expect(p.x).toBeLessThan(x0)
  })

  it('스킬 봉인: Q 를 눌러도 스킬이 나가지 않는다', () => {
    const g = game()
    toField(g)
    const p = g.s.players[0]
    p.focus = 999
    g.donate(ev('seal'))
    expect(p.don![DON_SEAL]).toBeGreaterThan(0)
    for (let t = 0; t < 5; t++) g.run((i) => (i === 0 ? { ...idle(), buttons: BTN_SKILL1 } : idle()))
    expect(p.cd[0] ?? 0).toBe(0)
  })

  it('광폭화: 괴물 공격력이 오르고, 끝나면 되돌아온다', () => {
    const g = game()
    toField(g)
    const m = areaView(g.s, 1).monsters.find((x) => x.hp > 0)!
    const pow0 = m.pow
    g.donate(ev('rage'))
    expect(m.pow).toBe(Math.round(pow0 * RAGE_POW))
    expect(m.rage).toBeGreaterThan(0)
    m.rage = 2
    g.run(() => idle())
    g.run(() => idle())
    expect(m.rage).toBe(0)
    expect(m.pow).toBe(pow0)
    expect(RAGE_TICKS).toBeGreaterThan(0)
  })
})
