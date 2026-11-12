// 입력 지연 자동 조절 (2026-11-12 멀티 최적화): 지연이 핑보다 짧으면 판이 느려진다 · 게임 중에 지연을 바꿔도 입력 줄이 끊기지 않는다 ·
// 개발용 망 흉내 주소 인자
import { describe, expect, it } from 'vitest'
import { Input } from '../src/core/input'
import { Lockstep, wantDelay, wireInput } from '../src/net/lockstep'
import { RoomLink, netSimFrom } from '../src/net/room'

const IN = (mx: number, cmd = 0): Input => ({ mx, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0, cmd, arg: 0 })

/** 한쪽 지연이 lag(타이머 신호 수 — 한 신호 = 한 틱 시간)인 가짜 방. tick() 을 부를 때마다 때가 된 패킷을 넘긴다 · loss = 손실 확률 */
function laggyMesh(lag: number, loss = 0) {
  let now = 0
  let seed = 12345
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296)
  const subs = new Map<string, (buf: Uint8Array, from: string) => void>()
  const queue: { at: number; to: string; from: string; buf: Uint8Array }[] = []
  const link = (id: string): RoomLink =>
    ({
      code: 'T',
      role: id === 'a' ? 'host' : 'guest',
      selfId: id,
      peers: new Set(),
      rtt: 0,
      sendCtl: () => {},
      sendInput: (buf: Uint8Array, to?: string) => {
        for (const k of subs.keys()) if (k !== id && (to === undefined || to === k) && (to !== undefined || rnd() >= loss)) queue.push({ at: now + lag, to: k, from: id, buf: buf.slice() })
      },
      onCtl: () => {},
      onInput: (fn: (buf: Uint8Array, from: string) => void) => subs.set(id, fn),
      onPeerJoin: () => {},
      onPeerLeave: () => {},
      leave: () => {},
    }) as unknown as RoomLink
  const tick = () => {
    now++
    for (let i = 0; i < queue.length; ) {
      if (queue[i].at <= now) {
        const q = queue.splice(i, 1)[0]
        subs.get(q.to)?.(q.buf, q.from)
      } else i++
    }
  }
  return { link, tick }
}

/** 세션의 틱 고리와 같은 규칙으로 calls 번 돌린다(신호마다 밀린 틱을 최대 4개 · 밀림은 8틱까지): 저마다 나아간 틱 수 */
function play(peers: { ls: Lockstep; t: number; acc: number }[], mesh: { tick: () => void }, calls: number, each?: (call: number) => void): void {
  for (let c = 0; c < calls; c++) {
    mesh.tick()
    each?.(c)
    for (const p of peers) {
      p.acc = Math.min(8, p.acc + 1)
      for (let steps = 0; p.acc >= 1 && steps < 4; steps++) {
        p.ls.pushLocal(p.t, IN(1))
        if (!p.ls.hasAll(p.t)) break
        p.t++
        p.acc--
      }
    }
  }
}

const pair = (lag: number, da: number, db: number, loss = 0) => {
  const mesh = laggyMesh(lag, loss)
  const idx = new Map([['a', 0], ['b', 1]])
  const a = { ls: new Lockstep(mesh.link('a'), da, 0, idx, 2), t: 0, acc: 0 }
  const b = { ls: new Lockstep(mesh.link('b'), db, 1, idx, 2), t: 0, acc: 0 }
  return { mesh, a, b }
}

describe('입력 지연과 판 속도', () => {
  it('지연이 한쪽 길보다 짧으면 판이 느려진다 (한쪽 7틱 = 왕복 233ms · 지연 3틱 → (3 + 1) / 7 속도)', () => {
    const { mesh, a, b } = pair(7, 3, 3)
    play([a, b], mesh, 600)
    expect(a.t).toBeLessThan(600 * 0.7)
    expect(Math.abs(a.t - b.t)).toBeLessThan(12)
  })

  it('핑에 맞춘 지연이면 제 속도로 돈다', () => {
    const d = wantDelay(1, 7 * 2 * 16.7)
    const { mesh, a, b } = pair(7, d, d)
    play([a, b], mesh, 600)
    expect(a.t).toBeGreaterThan(590)
    expect(b.t).toBeGreaterThan(590)
  })

  it('게임 중에 지연을 올리면 느리던 판이 제 속도를 찾는다 · 입력 줄에 구멍이 없다', () => {
    const { mesh, a, b } = pair(7, 3, 3)
    const d = wantDelay(1, 7 * 2 * 16.7)
    play([a, b], mesh, 300)
    const slow = a.t
    expect(slow).toBeLessThan(300 * 0.7)
    // 0.5초(30 신호)에 한 틱씩 올린다 — 세션 tuneDelay 와 같다
    play([a, b], mesh, 600, (c) => {
      if (c % 30 === 0) for (const p of [a, b]) p.ls.setDelay(d)
    })
    expect(a.ls.delay).toBe(d)
    // 올리는 동안(0.5초에 한 틱)을 빼면 제 속도
    const mid = a.t
    play([a, b], mesh, 300)
    expect(a.t - mid).toBeGreaterThan(295)
    // 지나온 모든 틱에 두 사람 입력이 다 있다 (구멍이면 여기까지 못 온다) — 두 판이 같은 입력을 쓴다
    for (let t = a.t - 500; t < Math.min(a.t, b.t); t++) expect(a.ls.get(t)).toEqual(b.ls.get(t))
  })

  it('지연을 내려도 멈추지 않고, 겹쳐 버려진 입력은 pushLocal 이 알려 준다(명령을 되돌려 넣게)', () => {
    const { mesh, a, b } = pair(1, 8, 8)
    play([a, b], mesh, 100)
    a.ls.setDelay(4)
    expect(a.ls.delay).toBe(7)
    // 다음 입력은 이미 보낸 틱과 겹친다
    expect(a.ls.pushLocal(a.t, IN(1, 5))).toBe(false)
    const t0 = a.t
    play([a, b], mesh, 200)
    expect(a.t - t0).toBeGreaterThan(195)
    expect(b.t - t0).toBeGreaterThan(190)
  })

  it('손실 5% · 한쪽 지연 4틱에서도 겹쳐 싣기로 멈추지 않는다', () => {
    const d = wantDelay(1, 4 * 2 * 16.7)
    const { mesh, a, b } = pair(4, d, d, 0.05)
    play([a, b], mesh, 1200)
    expect(a.t).toBeGreaterThan(1180)
    expect(b.t).toBeGreaterThan(1180)
  })

  it('wantDelay: 혼자면 2 · 사람이 있으면 한쪽 길 + 3틱 (4 ~ 12)', () => {
    expect(wantDelay(0, 300)).toBe(2)
    expect(wantDelay(1, 0)).toBe(4)
    expect(wantDelay(1, 80)).toBe(6)
    expect(wantDelay(3, 150)).toBe(8)
    expect(wantDelay(1, 250)).toBe(11)
    expect(wantDelay(1, 2000)).toBe(12)
  })

  it('내 입력도 전선 모양으로 쓴다 (한 바이트를 넘는 인자 · 조준)', () => {
    expect(wireInput({ ...IN(0), cmd: 30, arg: 300, aim: 1500 })).toMatchObject({ arg: 44, aim: 1500 & 1023, cmd: 30 })
  })
})

describe('개발용 망 흉내 (?lag · jitter · loss)', () => {
  it('개발 서버에서만 · 값이 있을 때만', () => {
    expect(netSimFrom('?lag=75&jitter=20&loss=2', true)).toEqual({ lag: 75, jitter: 20, loss: 2 })
    expect(netSimFrom('?lag=75', false)).toBeNull()
    expect(netSimFrom('?shot=1', true)).toBeNull()
    expect(netSimFrom('?lag=abc&loss=500', true)).toEqual({ lag: 0, jitter: 0, loss: 90 })
  })
})
