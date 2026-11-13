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
