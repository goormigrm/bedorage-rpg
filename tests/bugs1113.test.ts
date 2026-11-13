// 검증 · 버그 2차 (2026-11-13) 에서 찾은 결함이 되살아나지 않게.
import { describe, expect, it } from 'vitest'
import { cleanTomb } from '../src/game/stream'

describe('난입한 사람에게 방장이 다시 알려 주는 시청자 비석 (mtomb)', () => {
  const clean = (s: string) => s.replace(/나쁜말/g, '***').trim().slice(0, 60)
  it('모양이 맞는 것만 받는다 · 글은 받는 사람의 가릴 말을 거친다', () => {
    expect(cleanTomb({ t: 'mtomb', a: 1, x: 100, y: 200, kind: 'rip', nick: '시청자', say: '나쁜말 했다' }, clean)).toEqual({ x: 100, y: 200, kind: 'rip', nick: '시청자', say: '*** 했다' })
    expect(cleanTomb({ x: 1, y: 2, kind: 'win', nick: '시청자', who: '방장' }, clean)).toEqual({ x: 1, y: 2, kind: 'win', nick: '시청자', who: '방장' })
  })
  it('손댄 메시지: 좌표가 수가 아니거나 · 없는 종류 · 이름이 비면 버린다', () => {
    expect(cleanTomb(null, clean)).toBeNull()
    expect(cleanTomb({ x: 'a', y: 2, kind: 'rip', nick: 'n' }, clean)).toBeNull()
    expect(cleanTomb({ x: NaN, y: 2, kind: 'rip', nick: 'n' }, clean)).toBeNull()
    expect(cleanTomb({ x: 1, y: 2, kind: 'boom', nick: 'n' }, clean)).toBeNull()
    expect(cleanTomb({ x: 1, y: 2, kind: 'rip', nick: '   ' }, clean)).toBeNull()
    expect(cleanTomb({ x: 1, y: 2, kind: 'rip', nick: 'n', say: 7, who: {} }, clean)).toEqual({ x: 1, y: 2, kind: 'rip', nick: 'n' })
    expect(cleanTomb({ x: 1, y: 2, kind: 'rip', nick: '가'.repeat(50) }, clean)?.nick.length).toBe(20)
  })
})

// ---------------------------------------------------------------- 판(sim) · 명령
import { CMD_BUY, CMD_DONATE, CMD_EQUIP, CMD_SELL, CMD_SKILL_UP, CMD_SORT, Input, SlotGate } from '../src/core/input'
import { DONATE_EVENTS, DON_DARK, DON_GAP, DON_TICKS } from '../src/core/donate'
import { buyPrice } from '../src/core/items'
import { createState, hashState, step, warpPlayer } from '../src/core/sim'
import { townNpcs } from '../src/core/world'
import { idle, world } from './_fuzz'

describe('손댄 손님의 후원 명령 연타 (DON_GAP)', () => {
  const dark = DONATE_EVENTS.find((e) => e.key === 'dark')!.id
  const make = () => {
    const mapOf = world(31)
    const s = createState({ seed: 31, chars: ['chim', 'magic'] }, mapOf)
    warpPlayer(s, mapOf, 0, 1)
    warpPlayer(s, mapOf, 1, 1)
    return { s, mapOf }
  }
  const don = (seq: number): Input => ({ ...idle(), cmd: CMD_DONATE, arg: dark | (seq << 4) })

  it('틱마다 보내도 DON_GAP 틱에 하나만 먹는다 — 효과가 한 번에 한도까지 쌓이지 않는다', () => {
    const { s, mapOf } = make()
    for (let t = 0; t < DON_GAP; t++) step(s, mapOf, [idle(), don(t & 15)])
    // 시야 축소 한 번 몫(20초)에서 흐른 틱만큼 줄어 있다 — 두 번째부터는 버려졌다
    expect(s.players[1].don![DON_DARK]).toBeGreaterThan(DON_TICKS[DON_DARK] - DON_GAP - 2)
    expect(s.players[1].don![DON_DARK]).toBeLessThanOrEqual(DON_TICKS[DON_DARK])
    // 간격이 지나면 다시 먹는다
    step(s, mapOf, [idle(), don(1)])
    expect(s.players[1].don![DON_DARK]).toBeGreaterThan(DON_TICKS[DON_DARK] * 2 - DON_GAP - 4)
  })

  it('사람마다 따로 센다 — 한 사람의 연타가 방송하는 다른 사람의 후원을 막지 않는다 · 두 번 돌려 같은 해시', () => {
    const run = () => {
      const { s, mapOf } = make()
      step(s, mapOf, [idle(), don(0)])
      step(s, mapOf, [don(0), don(1)])
      // 0번 것도 먹었다 (둘이 한 번씩 = 40초 몫)
      expect(s.players[0].don![DON_DARK]).toBeGreaterThan(DON_TICKS[DON_DARK] * 2 - 4)
      for (let t = 0; t < 30; t++) step(s, mapOf, [idle(), don(t & 15)])
      return hashState(s)
    }
    expect(run()).toBe(run())
  })

  it('정상 방송의 간격(DON_GAP 틱 넘게 띄움)은 하나도 버리지 않는다', () => {
    const { s, mapOf } = make()
    for (let k = 0; k < 3; k++) {
      step(s, mapOf, [don(k), idle()])
      for (let t = 1; t < DON_GAP; t++) step(s, mapOf, [idle(), idle()])
    }
    // 세 번 몫(60초 = 처음 한도)에서 흐른 틱만큼
    expect(s.players[0].don![DON_DARK]).toBeGreaterThan(DON_TICKS[DON_DARK] * 3 - DON_GAP * 3 - 4)
  })
})

describe('상인 진열 사기는 물건 uid 로 (칸 번호 경쟁)', () => {
  const make = () => {
    const mapOf = world(31)
    const s = createState({ seed: 31, chars: ['chim', 'magic'] }, mapOf)
    const n = townNpcs(0).find((q) => q.id === 'merchant')!
    for (const p of s.players) {
      p.x = n.x + 30
      p.y = n.y
      p.gold = 999999
    }
    return { s, mapOf }
  }
  const buy = (uid: number): Input => ({ ...idle(), cmd: CMD_BUY, arg: uid & 255 })

  it('두 사람이 같은 화면(같은 진열)을 보고 잇달아 사도 저마다 누른 물건을 산다', () => {
    const { s, mapOf } = make()
    expect(s.shop.length).toBeGreaterThanOrEqual(3)
    // 진열의 아래 8비트는 겹치지 않는다
    expect(new Set(s.shop.map((it) => it.uid & 255)).size).toBe(s.shop.length)
    const [a, b] = [s.shop[0].uid, s.shop[1].uid]
    // 0번이 첫 칸을, 1번이 (아직 옛 화면을 보고) 둘째 칸의 물건을 — 한 틱 차이로
    step(s, mapOf, [buy(a), idle()])
    step(s, mapOf, [idle(), buy(b)])
    expect(s.players[0].bag.map((it) => it.uid)).toEqual([a])
    // 예전(칸 번호)에는 당겨진 둘째 칸 = 셋째 물건을 샀다
    expect(s.players[1].bag.map((it) => it.uid)).toEqual([b])
  })

  it('둘이 같은 물건을 누르면 먼저 닿은 사람만 사고, 늦은 사람은 아무것도 사지 않는다 (돈도 그대로)', () => {
    const { s, mapOf } = make()
    const a = s.shop[0].uid
    const price = buyPrice(s.shop[0])
    const n0 = s.shop.length
    step(s, mapOf, [buy(a), buy(a)])
    expect(s.shop.length).toBe(n0 - 1)
    expect(s.players[0].bag.length + s.players[1].bag.length).toBe(1)
    expect(s.players[0].gold + s.players[1].gold).toBe(999999 * 2 - price)
    // 없는 uid
    step(s, mapOf, [buy(a), buy(a)])
    expect(s.shop.length).toBe(n0 - 1)
  })
})

describe('칸 번호 명령 문지기 (SlotGate — 창을 잇달아 누를 때)', () => {
  it('칸을 옮기는 앞 명령이 판에 닿기 전에는 칸 번호 명령을 버리고, 다른 명령은 그대로 받는다', () => {
    const g = new SlotGate()
    expect(g.ok(CMD_SELL, 100)).toBe(true)
    // 틱 100 에 팔기를 실었다 (대기열 1 · 입력 지연 3) → 판의 틱이 104 가 되면 닿아 있다
    g.sent(CMD_SELL, 100, 1, 3)
    expect(g.ok(CMD_SELL, 101)).toBe(false)
    expect(g.ok(CMD_EQUIP, 103)).toBe(false)
    expect(g.ok(CMD_SKILL_UP, 101)).toBe(true)
    expect(g.ok(CMD_SELL, 104)).toBe(true)
    // 가방을 열 때 나가는 정렬도 칸을 옮긴다 — 닿기 전의 누름은 정렬 전 화면을 보고 누른 것이다
    g.sent(CMD_SORT, 200, 1, 0)
    expect(g.ok(CMD_EQUIP, 200)).toBe(false)
    expect(g.ok(CMD_EQUIP, 201)).toBe(true)
    // 칸을 안 옮기는 명령은 문을 닫지 않는다
    g.sent(CMD_SKILL_UP, 300, 1, 12)
    expect(g.ok(CMD_SELL, 300)).toBe(true)
  })
})
