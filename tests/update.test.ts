import { describe, expect, it } from 'vitest'
import { APP_VERSION, newerVersion, rejectGuestText, sameVersion, versionMismatchText } from '../src/ui/update'

// 판 번호 · 새 판 알림 · 판이 다른 사람과 같은 방에 안 섞이기 (2026-10-09 — 열어 둔 탭이 옛 판으로 계속 돌았다)
describe('판 번호', () => {
  it('지금 판 번호는 package.json 의 것', async () => {
    const pkg = (await import('../package.json')).default as { version: string }
    expect(APP_VERSION).toBe(pkg.version)
  })
  it('자리마다 숫자로 비교한다 (0.100.0 > 0.99.9)', () => {
    expect(newerVersion('0.100.0', '0.99.9')).toBe(true)
    expect(newerVersion('0.99.9', '0.100.0')).toBe(false)
    expect(newerVersion('0.100.1', '0.100.1')).toBe(false)
    expect(newerVersion('1.0.0', '0.100.1')).toBe(true)
  })
  it('번호를 안 보내는 옛 판은 다른 판', () => {
    expect(sameVersion(APP_VERSION)).toBe(true)
    expect(sameVersion(undefined)).toBe(false)
    expect(sameVersion('0.0.1')).toBe(false)
  })
  it('누가 새로 고쳐야 하는지 알려 준다', () => {
    // 손님이 옛 판 → 손님이 새로 고침
    expect(rejectGuestText('0.0.1')).toContain('새로 고침(F5) 뒤 다시 들어오세요')
    expect(rejectGuestText(undefined)).toContain('나 옛 판')
    // 손님이 더 새 판 → 방장이 새로 고침
    expect(rejectGuestText('999.0.0')).toContain('방장이 새로 고침(F5)해야 합니다')
    // 손님 눈으로 본 방장
    expect(versionMismatchText(undefined, true)).toContain('방장이 새로 고침(F5)해야 합니다')
    expect(versionMismatchText('999.0.0', true)).toContain('새로 고침(F5) 뒤 다시 들어오세요')
  })
})
