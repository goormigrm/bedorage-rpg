// P2P 방을 봇으로 채우기: 호스트(0번)가 봇 자리 입력을 자리 패킷(0xFF + 자리)으로 보내고, 게스트는 그것만 받는다.
import { describe, expect, it } from 'vitest'
import { botInput, makeBot } from '../src/core/bot'
import { EMPTY_INPUT, Input } from '../src/core/input'
import { buildMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { Lockstep } from '../src/net/lockstep'
import { RoomLink } from '../src/net/room'

/** 서로 연결된 가짜 회선. 한쪽이 보낸 입력 패킷이 나머지 모두에게 간다 (join.test 와 같은 것) */
function makeBus() {
  const subs: { id: string; fn: (buf: Uint8Array, from: string) => void }[] = []
  const link = (id: string): RoomLink =>
    ({
      code: 'TEST12',
      role: id === 'a' ? 'host' : 'guest',
      selfId: id,
      peers: [],
      rtt: 0,
      sendCtl: () => {},
      sendInput: (buf: Uint8Array, to?: string) => {
        for (const s of subs) if (s.id !== id && (to === undefined || s.id === to)) s.fn(buf, id)
      },
      onCtl: () => {},
      onInput: (fn: (buf: Uint8Array, from: string) => void) => subs.push({ id, fn }),
      onPeerJoin: () => {},
      onPeerLeave: () => {},
      leave: () => {},
    }) as unknown as RoomLink
  return { link }
}

const IN = (mx: number): Input => ({ mx, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

describe('P2P 봇 자리', () => {
  it('호스트가 보낸 봇 입력으로 게스트도 그 틱을 진행한다', () => {
    const bus = makeBus()
    const idx = new Map([
      ['a', 0],
      ['b', 1],
    ])
    const host = new Lockstep(bus.link('a'), 3, 0, idx, 3)
    const guest = new Lockstep(bus.link('b'), 3, 1, idx, 3)
    host.setBot(2)
    guest.setBot(2)
    for (let t = 0; t < 10; t++) {
      host.pushLocal(t, IN(1))
      host.pushBot(2, t, IN(5))
      guest.pushLocal(t, IN(2))
    }
    // 둘 다 3~12 틱의 세 자리 입력을 갖는다
    for (let t = 3; t < 10; t++) {
      expect(host.hasAll(t)).toBe(true)
      expect(guest.hasAll(t)).toBe(true)
      expect(guest.get(t)[2].mx).toBe(5)
      expect(host.get(t)[2].mx).toBe(5)
      expect(guest.get(t)[0].mx).toBe(1)
      expect(host.get(t)[1].mx).toBe(2)
    }
  })

  it('봇 입력이 아직 안 왔으면 게스트는 멈춘다 (사람 입력과 같은 취급)', () => {
    const bus = makeBus()
    const idx = new Map([
      ['a', 0],
      ['b', 1],
    ])
    const host = new Lockstep(bus.link('a'), 3, 0, idx, 3)
    const guest = new Lockstep(bus.link('b'), 3, 1, idx, 3)
    host.setBot(2)
    guest.setBot(2)
    host.pushLocal(0, IN(1))
    guest.pushLocal(0, IN(2))
    expect(guest.hasAll(3)).toBe(false)
    host.pushBot(2, 0, IN(5))
    expect(guest.hasAll(3)).toBe(true)
  })

  it('게스트가 보낸 봇 자리 패킷은 무시한다 (호스트만 봇을 굴린다)', () => {
    const bus = makeBus()
    const idx = new Map([
      ['a', 0],
      ['b', 1],
    ])
    const host = new Lockstep(bus.link('a'), 3, 0, idx, 3)
    const guest = new Lockstep(bus.link('b'), 3, 1, idx, 3)
    host.setBot(2)
    guest.setBot(2)
    // 게스트가 봇 입력을 흉내 내 보내도(pushBot 은 호스트가 아니면 아무것도 안 한다) 호스트에는 아무것도 안 들어간다
    guest.pushBot(2, 0, IN(9))
    guest.pushLocal(0, IN(2))
    host.pushLocal(0, IN(1))
    expect(host.hasAll(3)).toBe(false)
    expect(host.get(3)[2]).toEqual(EMPTY_INPUT)
  })

  it('늦게 붙은 피어에게 봇 자리 입력도 몰아 보낸다', () => {
    const bus = makeBus()
    const idx = new Map([
      ['a', 0],
      ['b', 1],
    ])
    const host = new Lockstep(bus.link('a'), 3, 0, idx, 3)
    host.setBot(2)
    for (let t = 0; t < 30; t++) {
      host.pushLocal(t, IN(1))
      host.pushBot(2, t, IN(5))
    }
    // 그제야 게스트가 붙는다: 지난 패킷은 못 받았다
    const guest = new Lockstep(bus.link('b'), 3, 1, idx, 3)
    guest.setBot(2)
    for (let t = 0; t < 30; t++) guest.pushLocal(t, IN(2))
    expect(guest.hasAll(10)).toBe(false)
    host.resendTo('b')
    expect(guest.hasAll(10)).toBe(true)
    expect(guest.get(10)[2].mx).toBe(5)
    expect(guest.get(10)[0].mx).toBe(1)
  })
})

// 봇도 죽으면 캐릭터를 바꾸기도 한다 (2026-09-06 사용자: 봇전에서 봇도 게임 중에 캐릭터를 바꾸게). 계측·시험용 기본 봇은 안 바꾼다
describe('봇 캐릭터 교체', () => {
  const run = (swap: boolean) => {
    const map = buildMap('studio', 4, 77)
    const s = createState({ seed: 77, targetKills: 99, chars: ['chim', 'cheolmyeon', 'uwon', 'giyeol'] }, map)
    s.phase = 'playing'
    s.phaseTimer = 0
    const bots = s.players.map((_, i) => makeBot(1000 + i, { swap }))
    let swaps = 0
    let deaths = 0
    for (let t = 0; t < 60 * 150; t++) {
      step(s, map, bots.map((b, i) => botInput(s, map, i, b, 'normal')))
      for (const e of s.events) {
        if (e.type === 'swap') swaps++
        if (e.type === 'death') deaths++
      }
    }
    return { s, swaps, deaths }
  }

  it('swap 을 켠 봇은 죽은 뒤 캐릭터를 바꾸고, 고르는 상태에 갇히지 않는다', () => {
    const { s, swaps, deaths } = run(true)
    expect(deaths).toBeGreaterThan(3)
    expect(swaps).toBeGreaterThan(0)
    for (const p of s.players) expect(p.choosing).toBe(false)
  })

  it('기본 봇(계측·시험)은 캐릭터를 바꾸지 않는다', () => {
    const { s, swaps } = run(false)
    expect(swaps).toBe(0)
    expect(s.players.map((p) => p.char)).toEqual(['chim', 'cheolmyeon', 'uwon', 'giyeol'])
  })
})
