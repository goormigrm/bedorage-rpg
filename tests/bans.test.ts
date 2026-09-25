// 방장이 내보낸 사람 명단 (2026-09-25 방송 개선 2)
import { describe, expect, it } from 'vitest'
import { banPeer, isBanned } from '../src/net/bans'

describe('방장 강퇴 명단', () => {
  it('내보낸 사람은 id 로도 · 닉네임으로도(페이지를 새로 열어 id 가 바뀌어도) 막는다 · 빈 닉네임은 막지 않는다', () => {
    banPeer('ROOM1', 'peer-a', ' 방해꾼 ')
    expect(isBanned('ROOM1', 'peer-a', '')).toBe(true)
    expect(isBanned('ROOM1', 'peer-new', '방해꾼')).toBe(true)
    expect(isBanned('ROOM1', 'peer-b', '친구')).toBe(false)
    banPeer('ROOM1', 'peer-c', '')
    expect(isBanned('ROOM1', 'peer-d', '')).toBe(false)
    expect(isBanned('ROOM1', 'peer-c', '')).toBe(true)
  })

  it('방을 새로 열면(코드가 바뀌면) 명단을 비운다', () => {
    banPeer('ROOM1', 'peer-a', '방해꾼')
    expect(isBanned('ROOM2', 'peer-a', '방해꾼')).toBe(false)
    banPeer('ROOM2', 'peer-z', '다른사람')
    expect(isBanned('ROOM2', 'peer-a', '방해꾼')).toBe(false)
    expect(isBanned('ROOM2', 'peer-z', '')).toBe(true)
  })
})
