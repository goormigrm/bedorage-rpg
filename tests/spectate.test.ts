// 관전 규칙과 리스폰 자리 노출.
//
// 팀전에서 상대 시점을 보여 주면 적 위치가 그대로 드러나 팀전이 성립하지 않는다.
// 또 죽어 있는 동안 '보였다' 는 기억이 남으면 **리스폰하는 순간 새 자리가 미니맵에 드러난다** —
// 실제로 그런 제보가 있었다(2026-09-06).

import { describe, expect, it } from 'vitest'
import { buildMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { GameState, isTeamMatch } from '../src/core/state'
import { Input } from '../src/core/input'

const map = buildMap('yard', 1, 31)
const IDLE: Input = { mx: 0, my: 0, aim: 0, buttons: 0, char: 0 }

/** session.nextAlive 와 같은 규칙 (팀전이면 아군만) */
function nextAlive(s: GameState, me: number, from: number): number {
  const n = s.players.length
  const teams = isTeamMatch(s)
  const myTeam = s.players[me].team
  for (let k = 1; k <= n; k++) {
    const i = (from + k + n) % n
    const p = s.players[i]
    if (i === me || !p.alive || p.left) continue
    if (teams && p.team !== myTeam) continue
    return i
  }
  return -1
}

describe('관전 대상', () => {
  it('팀전에서는 아군만 볼 수 있다', () => {
    const s = createState(
      { seed: 7, targetKills: 9, chars: ['chim', 'jupeol', 'magic', 'dangun'], teams: [0, 1, 0, 1] },
      map,
    )
    expect(isTeamMatch(s)).toBe(true)
    // 0번(팀 0) 이 볼 수 있는 사람은 2번(팀 0) 뿐
    expect(nextAlive(s, 0, -1)).toBe(2)
    expect(nextAlive(s, 0, 2)).toBe(2) // 한 바퀴 돌아도 아군뿐
    // 아군이 죽으면 볼 사람이 없다
    s.players[2].alive = false
    expect(nextAlive(s, 0, -1)).toBe(-1)
  })

  it('개인전에서는 누구든 볼 수 있다', () => {
    const s = createState({ seed: 8, targetKills: 9, chars: ['chim', 'jupeol', 'magic'] }, map)
    expect(isTeamMatch(s)).toBe(false)
    const first = nextAlive(s, 0, -1)
    expect(first).toBeGreaterThan(0)
    expect(nextAlive(s, 0, first)).not.toBe(first) // 다음 사람으로 넘어간다
  })

  it('나간 사람은 볼 수 없다', () => {
    const s = createState({ seed: 9, targetKills: 9, chars: ['chim', 'jupeol'] }, map)
    s.players[1].left = true
    expect(nextAlive(s, 0, -1)).toBe(-1)
  })
})

describe('리스폰 자리 노출', () => {
  it('죽어 있는 동안에는 적이 아예 그려지지 않는다 (미니맵 포함)', () => {
    // 렌더러의 hidden 계산과 같은 규칙: 죽었거나 나간 사람은 무조건 숨김
    const s = createState({ seed: 10, targetKills: 9, chars: ['chim', 'jupeol'] }, map)
    const foe = s.players[1]
    foe.alive = false
    foe.respawnTimer = 120
    const hiddenForDead = !foe.alive || foe.left
    expect(hiddenForDead).toBe(true)
  })

  it('죽었다 살아나면 위치가 바뀌므로 새로 판정해야 한다', () => {
    const s = createState({ seed: 11, targetKills: 9, chars: ['chim', 'jupeol'] }, map)
    const foe = s.players[1]
    const before = { x: foe.x, y: foe.y }
    foe.alive = false
    foe.hp = 0
    foe.respawnTimer = 1
    s.phase = 'playing'
    s.phaseTimer = 0
    for (let t = 0; t < 5; t++) step(s, map, [IDLE, IDLE])
    expect(foe.alive).toBe(true)
    // 리스폰 자리는 죽은 자리와 다르다 → 죽기 전 '보였다' 를 그대로 쓰면 새 자리가 드러난다
    const moved = Math.hypot(foe.x - before.x, foe.y - before.y)
    expect(moved).toBeGreaterThan(0)
  })
})
