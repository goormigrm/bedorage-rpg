// 방송 수입 가리기 (2026-09-23 사용자: "후원 합계는 수입의 전체 수준을 알 수 있으니 절대 표시되지 않게 —
// 받은 채팅 · 후원 숫자 · 합계 내역은 나타내지 않도록"). 모으지 않으면 어디에도 샐 수 없다.
import { describe, expect, it } from 'vitest'
import { stream } from '../src/game/stream'

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
