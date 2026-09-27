// 방송 수입 가리기 (2026-09-23 사용자: "후원 합계는 수입의 전체 수준을 알 수 있으니 절대 표시되지 않게 —
// 받은 채팅 · 후원 숫자 · 합계 내역은 나타내지 않도록"). 모으지 않으면 어디에도 샐 수 없다.
import { describe, expect, it } from 'vitest'
import { HELD_MAX, stream } from '../src/game/stream'

describe('방송 수입 가리기', () => {
  it('받은 채팅 · 후원의 개수 · 합계 · 목록을 모으지 않는다', () => {
    const off = stream.listen(() => {}, () => {})
    stream.chat({ nick: '시청자', text: '안녕' })
    stream.donation({ nick: '후원자', amount: 50000, text: '보스 가자' })
    stream.donation({ nick: '후원자2', amount: 100000, text: '' })
    off()
    const hub = stream as unknown as Record<string, unknown>
    expect(hub.counts).toBeUndefined()
    expect(hub.recent).toBeUndefined()
    // 허브 어디에도 합계(150000)가 남지 않는다
    expect(JSON.stringify(hub, (_k, v) => (typeof v === 'function' || v instanceof Set ? undefined : v))).not.toContain('150000')
  })
})

// 2026-09-27: 로비에서 받은 후원은 30건까지만 들고 있어 오래된 것이 버려졌다 · 게임을 나가면 기다리던 후원이 사라졌다
describe('게임 밖에서 받은 후원 · 나갈 때 남은 후원은 버리지 않는다', () => {
  it('로비에서 받은 후원은 200건까지 들고 있다가 게임이 받으면 차례대로 넘긴다', () => {
    for (let i = 0; i < 120; i++) stream.donation({ nick: `후원${i}`, amount: 1000, text: '' })
    const got: string[] = []
    const off = stream.listen(() => {}, (d) => got.push(d.nick))
    off()
    expect(HELD_MAX).toBe(200)
    expect(got.length).toBe(120)
    expect(got[0]).toBe('후원0')
    expect(got[119]).toBe('후원119')
  })
  it('나갈 때 맡긴 후원 이벤트는 다음에 꺼내면 그대로 (금액 없이 이벤트 번호만)', () => {
    stream.keep([{ ev: 3, nick: 'ㄱ', text: '암흑' }, { ev: 9, nick: 'ㄴ', text: '' }])
    const k = stream.takeKept()
    expect(k.map((d) => d.ev)).toEqual([3, 9])
    expect(stream.takeKept()).toEqual([])
    expect(JSON.stringify(k)).not.toContain('amount')
  })
})
