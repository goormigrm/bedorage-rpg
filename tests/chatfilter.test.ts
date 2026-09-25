// 방송 화면에 뜨는 시청자 글 거르기 (2026-09-25 방송 개선 3)
import { describe, expect, it } from 'vitest'
import { SpamGuard, maskText, squeezeRepeats } from '../src/game/chatfilter'
import { DEFAULT_BANNED, cleanBanned } from '../src/game/stream'

const cfg = { banned: ['바보', '멍청이'], maskLinks: true }

describe('가릴 말 · 링크', () => {
  it('가릴 말은 ○ 로 — 글자 사이에 띄어쓰기 · 숫자 · 기호를 끼워도', () => {
    expect(maskText('너 바보냐', cfg)).toBe('너 ○○냐')
    expect(maskText('바 보', cfg)).toBe('○○')
    expect(maskText('바1보 바.보 바_보', cfg)).toBe('○○ ○○ ○○')
    expect(maskText('멍청이 바보', cfg)).toBe('○○○ ○○')
    // 상관없는 말은 그대로
    expect(maskText('보스 잡자 바로 가', cfg)).toBe('보스 잡자 바로 가')
  })

  it('처음 목록의 센 욕이 걸린다 · 자모로 써도', () => {
    const d = { banned: DEFAULT_BANNED, maskLinks: true }
    expect(maskText('ㅅ ㅂ 뭐야', d)).not.toContain('ㅅ ㅂ')
    expect(maskText('씨 발', d)).not.toContain('발')
    expect(maskText('안녕하세요 보스 언제 나와요', d)).toBe('안녕하세요 보스 언제 나와요')
  })

  it('주소는 [링크] 로 (끄면 그대로)', () => {
    expect(maskText('여기 https://evil.example/x?a=1 가봐', cfg)).toBe('여기 [링크] 가봐')
    expect(maskText('www.abc.net 들어와', cfg)).toBe('[링크] 들어와')
    expect(maskText('discord.gg/abcd 참여', cfg)).toBe('[링크] 참여')
    expect(maskText('내방송bj123.co.kr 와', cfg)).toBe('내방송[링크] 와')
    expect(maskText('3.5초 남음 · v0.67 버전', cfg)).toBe('3.5초 남음 · v0.67 버전')
    expect(maskText('abc.com', { ...cfg, maskLinks: false })).toBe('abc.com')
  })

  it('같은 글자는 여덟 자까지', () => {
    expect(squeezeRepeats('ㅋ'.repeat(40))).toBe('ㅋ'.repeat(8))
    expect(squeezeRepeats('와!!!!!!!!!!!!!!')).toBe('와!!!!!!!!')
    expect(squeezeRepeats('ㅋㅋㅋ')).toBe('ㅋㅋㅋ')
  })

  it('가릴 말 목록 다듬기: 공백 · 같은 것 · 문자열 아닌 것 빼기', () => {
    expect(cleanBanned([' 바보 ', '바보', '', 3, '멍청이'])).toEqual(['바보', '멍청이'])
  })
})

describe('도배 거르기', () => {
  it('같은 사람의 같은 말은 30초 안에 한 번 · 띄어쓰기 · 늘인 것도 같은 말', () => {
    const g = new SpamGuard()
    expect(g.allow('a', '보스 언제 나옴', 0)).toBe(true)
    expect(g.allow('a', '보스언제나옴', 5000)).toBe(false)
    expect(g.allow('b', '보스 언제 나옴', 5000)).toBe(true)
    expect(g.allow('a', 'ㅋㅋㅋ', 6000)).toBe(true)
    expect(g.allow('a', 'ㅋㅋㅋㅋㅋㅋㅋ', 7000)).toBe(false)
    expect(g.allow('a', '보스 언제 나옴', 31000)).toBe(true)
  })

  it('10초에 넷 넘게 몰아 쓰면 뺀다 · 지나면 다시', () => {
    const g = new SpamGuard()
    for (let i = 0; i < 4; i++) expect(g.allow('a', `말 ${i}`, i * 100)).toBe(true)
    expect(g.allow('a', '다섯째', 500)).toBe(false)
    expect(g.allow('a', '여섯째', 10_500)).toBe(true)
  })
})
