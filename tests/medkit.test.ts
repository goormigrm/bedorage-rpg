// 힐팩 규칙. 죽인 쪽이 이어서 싸울 수 있도록 죽은 자리에 떨어진다(2026-09-06 사용자 요청).
//
// 지켜야 할 것: 결정론(양쪽 브라우저에서 같은 사람이 줍는다), 체력이 가득이면 남겨 둔다,
// 시간이 지나면 사라진다, 스냅샷·해시에 포함된다(리싱크로 복원돼야 한다).

import { describe, expect, it } from 'vitest'
import { botInput, makeBot } from '../src/core/bot'
import { CHARACTERS } from '../src/core/characters'
import { Input } from '../src/core/input'
import { buildMap } from '../src/core/map'
import { createState, hashState, snapshot, step } from '../src/core/sim'
import { GameState, MEDKIT_HEAL_FRAC, MEDKIT_RADIUS, MEDKIT_TTL, PLAYER_RADIUS } from '../src/core/state'

const map = buildMap('yard', 1, 4242)
const IDLE: Input = { mx: 0, my: 0, aim: 0, buttons: 0, char: 0 }

function playing(s: GameState): GameState {
  s.phase = 'playing'
  s.phaseTimer = 0
  return s
}

/** 2 를 죽여 힐팩을 떨군다 (직접 상태를 만져 빠르게) */
function killAndDrop(s: GameState, victim = 1): { x: number; y: number } {
  const v = s.players[victim]
  v.invuln = 0
  v.hp = 1
  const x = v.x
  const y = v.y
  // 사격 대신 직접 치명타를 준다: 탄을 만들지 않고 hurt 를 태우려면 사망 경로를 타야 하므로
  // 아주 가까이에서 쏜다
  const shooter = s.players[victim === 0 ? 1 : 0]
  shooter.x = x + 20
  shooter.y = y
  shooter.invuln = 0
  s.bullets.push({
    id: s.nextBulletId++, owner: shooter.id, x: x + 18, y, px: x + 18, py: y,
    vx: -8, vy: 0, life: 10, damage: 500, ads: false, ox: x + 18, oy: y,
    weapon: 'rifle', hitSomeone: false, over: true, overR: 0, headTarget: -1,
  })
  step(s, map, [IDLE, IDLE])
  return { x, y }
}

describe('힐팩', () => {
  it('죽으면 그 자리에 떨어진다', () => {
    const s = playing(createState({ seed: 3, targetKills: 9, chars: ['chim', 'jupeol'] }, map))
    expect(s.medkits.length).toBe(0)
    const at = killAndDrop(s)
    expect(s.medkits.length).toBe(1)
    expect(Math.hypot(s.medkits[0].x - at.x, s.medkits[0].y - at.y)).toBeLessThan(1)
    expect(s.events.some((e) => e.type === 'drop')).toBe(true)
  })

  it('다친 사람이 밟으면 회복되고 힐팩은 사라진다', () => {
    const s = playing(createState({ seed: 3, targetKills: 9, chars: ['chim', 'jupeol'] }, map))
    const at = killAndDrop(s)
    const killer = s.players[0]
    const max = CHARACTERS[killer.char].maxHp
    killer.hp = Math.round(max * 0.4)
    killer.x = at.x
    killer.y = at.y
    step(s, map, [IDLE, IDLE])
    expect(killer.hp).toBe(Math.round(max * 0.4) + Math.round(max * MEDKIT_HEAL_FRAC))
    expect(s.medkits.length).toBe(0)
    expect(s.events.some((e) => e.type === 'heal' && e.p === 0)).toBe(true)
  })

  it('체력이 가득이면 줍지 않고 남겨 둔다', () => {
    const s = playing(createState({ seed: 3, targetKills: 9, chars: ['chim', 'jupeol'] }, map))
    const at = killAndDrop(s)
    const killer = s.players[0]
    killer.hp = CHARACTERS[killer.char].maxHp
    killer.x = at.x
    killer.y = at.y
    step(s, map, [IDLE, IDLE])
    expect(s.medkits.length).toBe(1)
  })

  it('회복은 최대 체력을 넘지 않는다', () => {
    const s = playing(createState({ seed: 3, targetKills: 9, chars: ['chim', 'jupeol'] }, map))
    const at = killAndDrop(s)
    const killer = s.players[0]
    const max = CHARACTERS[killer.char].maxHp
    killer.hp = max - 3
    killer.x = at.x
    killer.y = at.y
    step(s, map, [IDLE, IDLE])
    expect(killer.hp).toBe(max)
  })

  it('멀리 있으면 줍지 못한다', () => {
    const s = playing(createState({ seed: 3, targetKills: 9, chars: ['chim', 'jupeol'] }, map))
    const at = killAndDrop(s)
    const killer = s.players[0]
    killer.hp = 50
    killer.x = at.x + MEDKIT_RADIUS + PLAYER_RADIUS + 20
    killer.y = at.y
    step(s, map, [IDLE, IDLE])
    expect(s.medkits.length).toBe(1)
    expect(killer.hp).toBe(50)
  })

  it('시간이 지나면 사라진다', () => {
    const s = playing(createState({ seed: 3, targetKills: 9, chars: ['chim', 'jupeol'] }, map))
    killAndDrop(s)
    s.players[0].hp = CHARACTERS[s.players[0].char].maxHp
    s.players[1].hp = CHARACTERS[s.players[1].char].maxHp
    for (let t = 0; t < MEDKIT_TTL + 5; t++) step(s, map, [IDLE, IDLE])
    expect(s.medkits.length).toBe(0)
  })

  it('스냅샷·해시에 들어간다 (리싱크로 복원된다)', () => {
    const s = playing(createState({ seed: 3, targetKills: 9, chars: ['chim', 'jupeol'] }, map))
    const before = hashState(s)
    killAndDrop(s)
    expect(hashState(s)).not.toBe(before)
    const snap = snapshot(s)
    expect(snap.medkits.length).toBe(s.medkits.length)
    expect(hashState(snap)).toBe(hashState(s))
  })

  it('봇 경기도 결정론을 유지한다 (힐팩을 주우러 다녀도)', () => {
    const run = () => {
      const s = createState({ seed: 99, targetKills: 5, chars: ['chim', 'cheolmyeon'] }, map)
      const bots = [makeBot(1), makeBot(2)]
      const hashes: number[] = []
      for (let t = 0; t < 60 * 90 && s.phase !== 'over'; t++) {
        step(s, map, [botInput(s, map, 0, bots[0], 'hard'), botInput(s, map, 1, bots[1], 'hard')])
        if (t % 120 === 0) hashes.push(hashState(s))
      }
      return hashes
    }
    expect(run()).toEqual(run())
  })
})
