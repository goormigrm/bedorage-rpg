import { describe, expect, it } from 'vitest'
import { Member, arenaStartBlock, seatTeam } from '../src/net/room'

const m = (team: number): Member => ({ id: `p${team}`, char: 'pungwol', ready: true, team, name: '' })

describe('투기장 시작 조건', () => {
  it('혼자 + 봇 → 시작 (2026-10-17 "모두 준비. 시작합니다…" 에서 멈춤)', () => {
    expect(arenaStartBlock([m(0)], 4, 'ffa', 4)).toBeNull()
    expect(arenaStartBlock([m(0)], 4, 'ffa', 1)).toBeNull()
    expect(arenaStartBlock([m(1)], 2, 'teams', 4)).toBeNull()
  })
  it('혼자 · 봇 없음 → 막고 까닭을 알린다', () => {
    expect(arenaStartBlock([m(0)], 4, 'ffa', 0)).toContain('상대')
  })
  it('팀전: 한 팀에만 사람이 있고 빈 자리가 없으면 막는다', () => {
    expect(arenaStartBlock([m(0), m(0)], 2, 'teams', 4)).toContain('팀')
    expect(arenaStartBlock([m(0), m(1)], 2, 'teams', 0)).toBeNull()
  })
  it('빈 자리는 사람이 적은 팀으로', () => {
    expect(seatTeam([m(1)])).toBe(0)
    expect(seatTeam([m(0)])).toBe(1)
    expect(seatTeam([m(1), m(0)])).toBe(0)
  })
})
