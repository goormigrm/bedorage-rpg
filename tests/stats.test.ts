// 결과 화면 통계. 값은 전부 sim 안에서 세므로 모두의 화면에서 같아야 하고,
// 리싱크(스냅샷 복원)로도 살아남아야 한다.
//
// 명중률은 **탄 단위**로 센다. 산탄총 한 발은 탄 7개라, 방아쇠 횟수로 세면
// 산탄총만 명중률 700% 처럼 보인다.

import { describe, expect, it } from 'vitest'
import { botInput, makeBot } from '../src/core/bot'
import { Input } from '../src/core/input'
import { buildMap } from '../src/core/map'
import { createState, hashState, snapshot, step } from '../src/core/sim'
import { Bullet, GameState } from '../src/core/state'
import { WEAPONS } from '../src/core/weapons'

const map = buildMap('yard', 1, 909)
const IDLE: Input = { mx: 0, my: 0, aim: 0, buttons: 0, char: 0 }

function playing(s: GameState): GameState {
  s.phase = 'playing'
  s.phaseTimer = 0
  return s
}

/** owner 가 victim 한가운데(=머리)로 탄을 하나 쏜 것으로 친다 */
function shootAt(s: GameState, owner: number, victim: number, damage: number): void {
  const v = s.players[victim]
  v.invuln = 0
  const b: Bullet = {
    id: s.nextBulletId++, owner, x: v.x + 18, y: v.y, px: v.x + 18, py: v.y,
    vx: -9, vy: 0, life: 20, damage, ads: false, ox: v.x + 18, oy: v.y,
    weapon: 'rifle', hitSomeone: false, over: true, overR: 0, headTarget: victim,
  }
  s.bullets.push(b)
}

describe('결과 통계', () => {
  it('맞히면 명중·헤드샷·준 피해·받은 피해가 쌓인다', () => {
    const s = playing(createState({ seed: 1, targetKills: 9, chars: ['chim', 'jupeol'] }, map))
    shootAt(s, 0, 1, 20)
    step(s, map, [IDLE, IDLE])
    const a = s.players[0]
    const b = s.players[1]
    expect(a.hits).toBe(1)
    expect(a.heads).toBe(1) // 한가운데를 지나갔으므로 머리
    expect(a.dmgDealt).toBeGreaterThan(0)
    expect(b.dmgTaken).toBe(a.dmgDealt)
    expect(b.hits).toBe(0)
  })

  it('발사 수는 탄 단위로 센다 (산탄총 한 발 = 탄 7개)', () => {
    const s = playing(createState({ seed: 2, targetKills: 9, chars: ['magic', 'chim'] }, map))
    const p = s.players[0]
    expect(WEAPONS[p.weapon].pellets).toBeGreaterThan(1)
    const before = p.shots
    // 한 발 쏜다
    step(s, map, [{ ...IDLE, buttons: 1 }, IDLE])
    expect(p.shots - before).toBe(WEAPONS[p.weapon].pellets)
  })

  it('연속 킬은 죽으면 끊기고, 최고 기록은 남는다', () => {
    const s = playing(createState({ seed: 3, targetKills: 99, chars: ['chim', 'jupeol'] }, map))
    const a = s.players[0]
    const b = s.players[1]
    for (let k = 0; k < 2; k++) {
      b.hp = 1
      shootAt(s, 0, 1, 500)
      step(s, map, [IDLE, IDLE])
      // 바로 살려서 다시 잡는다
      b.alive = true
      b.hp = 100
      b.invuln = 0
      b.respawnTimer = 0
    }
    expect(a.kills).toBe(2)
    expect(a.killStreak).toBe(2)
    expect(a.bestStreak).toBe(2)
    // 이제 내가 죽으면 연속이 끊긴다
    a.hp = 1
    shootAt(s, 1, 0, 500)
    step(s, map, [IDLE, IDLE])
    expect(a.killStreak).toBe(0)
    expect(a.bestStreak).toBe(2) // 최고 기록은 남는다
  })

  it('막힌 탄은 명중으로 세지 않는다 (피해가 0 이므로)', () => {
    const s = playing(createState({ seed: 4, targetKills: 9, chars: ['chim', 'seungwoo'] }, map))
    const pan = s.players[1]
    pan.stamina = 100
    // 후라이팬이 쏘는 쪽을 보게 한다 (앞에서 오는 탄만 막는다)
    pan.aim = 0
    const shooter = s.players[0]
    shooter.x = pan.x + 200
    shooter.y = pan.y
    let blocked = 0
    let hits = 0
    for (let i = 0; i < 40; i++) {
      pan.stamina = 100
      shootAt(s, 0, 1, 20)
      step(s, map, [IDLE, IDLE])
      for (const e of s.events) {
        if (e.type === 'block') blocked++
        if (e.type === 'hit') hits++
      }
    }
    expect(blocked).toBeGreaterThan(0)
    // 명중 수 = 실제로 아프게 한 것만
    expect(s.players[0].hits).toBe(hits)
    expect(s.players[0].hits).toBeLessThan(blocked + hits)
  })

  it('스냅샷·해시에 들어간다', () => {
    const s = playing(createState({ seed: 5, targetKills: 9, chars: ['chim', 'jupeol'] }, map))
    const before = hashState(s)
    shootAt(s, 0, 1, 20)
    step(s, map, [IDLE, IDLE])
    expect(hashState(s)).not.toBe(before)
    const snap = snapshot(s)
    expect(snap.players[0].hits).toBe(s.players[0].hits)
    expect(snap.players[0].dmgDealt).toBe(s.players[0].dmgDealt)
  })

  it('봇 경기에서도 값이 앞뒤가 맞는다 (명중 ≤ 발사)', () => {
    const s = createState({ seed: 6, targetKills: 3, chars: ['chim', 'cheolmyeon'] }, map)
    const bots = [makeBot(1), makeBot(2)]
    for (let t = 0; t < 60 * 120 && s.phase !== 'over'; t++) {
      step(s, map, [botInput(s, map, 0, bots[0], 'hard'), botInput(s, map, 1, bots[1], 'hard')])
    }
    for (const p of s.players) {
      expect(p.hits).toBeLessThanOrEqual(p.shots)
      expect(p.heads).toBeLessThanOrEqual(p.hits)
      expect(p.bestStreak).toBeGreaterThanOrEqual(p.killStreak)
      expect(p.dmgDealt).toBeGreaterThanOrEqual(0)
    }
    // 내가 준 피해는 상대가 받은 피해와 같다 (2인 경기)
    expect(Math.round(s.players[0].dmgDealt)).toBe(Math.round(s.players[1].dmgTaken))
  })
})
