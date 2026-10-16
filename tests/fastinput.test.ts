// 입력 전용 빠른 채널 (2026-10-17 성능 · 네트워크 검토 — net/room.ts FAST_IN_ID): 입력은 순서 · 재전송 없는 채널로.
// 상대에게서 그 채널로 받기 전에는 원래 줄(Trystero)로도 같이 보내고, 몰아 보내기(한 피어 · 큰 묶음)는 늘 원래 줄로
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Ch = { readyState: string; sent: unknown[]; send(b: unknown): void; close(): void; onmessage?: (e: { data: ArrayBuffer }) => void; onclose?: () => void; binaryType?: string; opts?: RTCDataChannelInit }
const h = vi.hoisted(() => ({
  slow: [] as { buf: Uint8Array; to: unknown }[],
  join: null as null | ((id: string) => void),
  leave: null as null | ((id: string) => void),
  inCb: null as null | ((buf: unknown, from: string) => void),
  ch: null as null | Ch,
}))
vi.mock('trystero', () => ({
  selfId: 'me',
  joinRoom: () => ({
    makeAction: (name: string) => [
      (buf: Uint8Array, to?: unknown) => {
        if (name === 'in') h.slow.push({ buf, to })
        return Promise.resolve()
      },
      (cb: (buf: unknown, from: string) => void) => {
        if (name === 'in') h.inCb = cb
      },
    ],
    onPeerJoin: (cb: (id: string) => void) => (h.join = cb),
    onPeerLeave: (cb: (id: string) => void) => (h.leave = cb),
    onPeerStream: () => {},
    getPeers: () => ({
      a: {
        connectionState: 'connected',
        createDataChannel: (_label: string, opts: RTCDataChannelInit) => {
          h.ch = { readyState: 'open', sent: [], opts, send(b) { this.sent.push(b) }, close() { this.readyState = 'closed'; this.onclose?.() } }
          return h.ch
        },
      },
    }),
    leave: () => Promise.resolve(),
  }),
}))
import { openRoom } from '../src/net/room'

describe('입력 전용 빠른 채널', () => {
  beforeEach(() => {
    h.slow.length = 0
    h.ch = null
  })
  it('순서 · 재전송 없는 채널을 미리 정한 번호로 연다 · 받기 전에는 두 줄로, 받은 뒤에는 빠른 채널로만', () => {
    const link = openRoom('TEST01', 'host')
    const got: [Uint8Array, string][] = []
    link.onInput((b, f) => got.push([b, f]))
    h.join!('a')
    expect(h.ch!.opts).toMatchObject({ negotiated: true, ordered: false, maxRetransmits: 0 })
    const buf = new Uint8Array([1, 2, 3])
    link.sendInput(buf)
    expect(h.ch!.sent.length).toBe(1)
    expect(h.slow.map((s) => s.to)).toEqual([['a']])
    // 상대가 빠른 채널로 보내면 받은 것으로 친다 → 그 뒤로는 원래 줄을 쓰지 않는다
    h.ch!.onmessage!({ data: new Uint8Array([9, 9]).buffer })
    expect(got.length).toBe(1)
    expect([...got[0][0]]).toEqual([9, 9])
    expect(got[0][1]).toBe('a')
    link.sendInput(buf)
    expect(h.ch!.sent.length).toBe(2)
    expect(h.slow.length).toBe(1)
    link.leave()
  })
  it('한 피어에게 몰아 보내기는 원래 줄로 · 빠른 채널이 닫히면 원래 줄로 돌아간다', () => {
    const link = openRoom('TEST02', 'host')
    h.join!('a')
    h.ch!.onmessage!({ data: new Uint8Array([1]).buffer })
    link.sendInput(new Uint8Array([7]), 'a')
    expect(h.slow.map((s) => s.to)).toEqual(['a'])
    expect(h.ch!.sent.length).toBe(0)
    h.ch!.close()
    link.sendInput(new Uint8Array([8]))
    expect(h.slow.map((s) => s.to)).toEqual(['a', ['a']])
    link.leave()
  })
})
