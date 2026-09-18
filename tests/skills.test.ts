// 스킬(캐릭터마다 Q·E·X) · 투기장(PvP — 덕의 대전 규칙 이식) 규칙.
import { describe, expect, it } from 'vitest'
import { radToAngle } from '../src/core/fixedmath'
import { BTN_FIRE, BTN_SKILL1, BTN_SKILL2, BTN_ULT, Input } from '../src/core/input'
import { TILE, TILE_FLOOR, buildMap, GameMap } from '../src/core/map'
import { makeMonster } from '../src/core/dungeon'
import { createState, hashState, step } from '../src/core/sim'
import { CharacterId, PLAYABLE } from '../src/core/characters'
import { CHAR_SKILLS, FX_GUARD, SKILLS, ULT_START_FRAC } from '../src/core/skills'
import { COUNTDOWN_TICKS, GameState, MS_CHASE, isEnemy } from '../src/core/state'
import { makePvpBot, pvpBotInput } from '../src/core/pvpbot'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const press = (buttons: number, aim = 0, aimDist = 0): Input => ({ ...idle(), buttons, aim, aimDist })

function ready(chars: CharacterId[], mode: 'dungeon' | 'arena' = 'dungeon', seed = 7): { s: GameState; map: GameMap } {
  const map = mode === 'arena' ? buildMap('yard', 1, seed) : buildMap('crypt', 1, seed)
  const s = createState({ area: 4, seed, chars, noMonsters: true, mode, targetKills: 3 }, map)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, chars.map(idle))
  return { s, map }
}

function openRow(map: GameMap, n: number): { x: number; y: number } {
  for (let ty = 4; ty < map.h - 4; ty++) {
    for (let tx = 4; tx < map.w - n - 4; tx++) {
      let ok = true
      for (let k = -2; k <= n && ok; k++) for (let dy = -2; dy <= 2; dy++) if (map.tiles[(ty + dy) * map.w + tx + k] !== TILE_FLOOR) ok = false
      if (ok) return { x: tx * TILE + 16, y: ty * TILE + 16 }
    }
  }
  throw new Error('빈 곳이 없다')
}

describe('스킬 — 캐릭터마다 셋', () => {
  it('1차 6명 모두 Q·E·X 가 있고, 궁극기는 절반 차서 시작한다', () => {
    for (const c of PLAYABLE) {
      const ids = CHAR_SKILLS[c]
      expect(ids.length).toBe(3)
      expect(SKILLS[ids[2]].ult).toBe(true)
      expect(SKILLS[ids[0]].ult ?? false).toBe(false)
      const { s } = ready([c])
      expect(s.players[0].cd[2]).toBeGreaterThan(SKILLS[ids[2]].cd * ULT_START_FRAC - COUNTDOWN_TICKS - 5)
    }
  })

  it('누르면 쓰이고 재사용 대기에 들어간다 (궁극기는 대기가 끝난 뒤)', () => {
    for (const c of PLAYABLE) {
      const { s, map } = ready([c])
      const p = s.players[0]
      const seen: string[] = []
      for (const [slot, btn] of [[0, BTN_SKILL1], [1, BTN_SKILL2]] as const) {
        // 스킬은 집중이 든다 (D4) — 넉넉히
        p.focus = 100
        step(s, map, [press(btn)])
        for (const e of s.events) if (e.type === 'skill') seen.push(e.id)
        expect(p.cd[slot]).toBeGreaterThan(0)
        // 돌진·도약 중에는 다른 스킬이 안 나간다 — 끝날 때까지 기다린다
        for (let t = 0; t < 20; t++) step(s, map, [idle()])
      }
      p.cd[2] = 0
      step(s, map, [press(BTN_ULT)])
      for (const e of s.events) if (e.type === 'skill') seen.push(e.id)
      expect(seen).toEqual(CHAR_SKILLS[c])
      // 대기 중에는 다시 안 쓰인다 (앙코르는 다른 스킬 대기를 끝내는 궁극기라 예외)
      step(s, map, [press(BTN_SKILL1)])
      if (CHAR_SKILLS[c][2] !== 'encore') expect(s.events.some((e) => e.type === 'skill')).toBe(false)
      else expect(s.events.some((e) => e.type === 'skill')).toBe(true)
    }
  })

  it('수류탄: 커서 지점에서 터져 주변 괴물을 다치게 하고 기절시킨다', () => {
    const { s, map } = ready(['chim'])
    const p = s.players[0]
    const o = openRow(map, 10)
    p.x = o.x
    p.y = o.y
    const m = makeMonster(s, 0, o.x + 6 * TILE, o.y, 1, 3)
    m.st = MS_CHASE
    m.cd = 9999
    s.monsters.push(m)
    step(s, map, [press(BTN_SKILL2, radToAngle(0), Math.round((6 * TILE) / 4))])
    expect(s.throws.length).toBe(1)
    let boom = false
    for (let t = 0; t < 60; t++) {
      // 날아가는 동안 괴물이 걸어 나가지 않게 제자리에 둔다
      m.x = o.x + 6 * TILE
      m.y = o.y
      step(s, map, [idle()])
      if (s.events.some((e) => e.type === 'aoe' && e.id === 'grenade')) boom = true
      if (boom) break
    }
    expect(boom).toBe(true)
    expect(m.hp).toBeLessThan(m.maxHp)
    expect(m.stun).toBeGreaterThan(0)
  })

  it('관통 저격: 한 줄로 선 괴물을 모두 꿰뚫는다', () => {
    const { s, map } = ready(['oknyang'])
    const p = s.players[0]
    const o = openRow(map, 12)
    p.x = o.x
    p.y = o.y
    const line = [4, 6, 8].map((k, i) => {
      const m = makeMonster(s, 0, o.x + k * TILE, o.y, 10 + i, 5)
      m.st = MS_CHASE
      m.cd = 9999
      s.monsters.push(m)
      return m
    })
    step(s, map, [press(BTN_SKILL2, radToAngle(0))])
    for (let t = 0; t < 30; t++) step(s, map, [idle()])
    for (const m of line) expect(m.hp).toBeLessThan(m.maxHp)
  })

  it('철벽: 받는 피해 절반 · 가까운 괴물이 나를 노린다', () => {
    const { s, map } = ready(['cheolmyeon', 'chim'])
    const [a, b] = s.players
    const m = makeMonster(s, 0, b.x + 40, b.y, 1, 1)
    m.st = MS_CHASE
    m.target = b.id
    s.monsters.push(m)
    step(s, map, [press(BTN_SKILL1), idle()])
    expect(a.fx[FX_GUARD]).toBeGreaterThan(0)
    expect(m.target).toBe(a.id)
    expect(m.taunt).toBeGreaterThan(0)
  })

  it('대수술: 쓰러진 동료를 바로 일으키고 체력 가득', () => {
    const { s, map } = ready(['magic', 'chim'])
    const [a, b] = s.players
    b.x = a.x + 60
    b.y = a.y
    b.hp = 0
    b.downed = true
    b.downTimer = 600
    a.cd[2] = 0
    step(s, map, [press(BTN_ULT), idle()])
    expect(b.downed).toBe(false)
    expect(b.hp).toBe(b.maxHp)
    expect(a.revives).toBe(1)
  })
})

describe('투기장 (PvP)', () => {
  it('개인전: 모두 서로 적이고, 탄이 적 플레이어를 맞힌다 · 헤드샷은 커서 규칙', () => {
    const { s, map } = ready(['chim', 'cheolmyeon'], 'arena')
    const [a, b] = s.players
    expect(isEnemy(a, b)).toBe(true)
    const o = openRow(map, 10)
    a.x = o.x
    a.y = o.y
    b.x = o.x + 6 * TILE
    b.y = o.y
    b.invuln = 0
    let head = 0
    let hits = 0
    for (let t = 0; t < 20; t++) {
      b.x = o.x + 6 * TILE
      b.y = o.y
      step(s, map, [press(BTN_FIRE, radToAngle(0), Math.round((6 * TILE) / 4)), idle()])
      for (const e of s.events) if (e.type === 'hit') {
        hits++
        if (e.part === 0) head++
      }
    }
    expect(hits).toBeGreaterThan(0)
    expect(head).toBe(hits)
  })

  it('팀전: 같은 팀은 맞지 않는다', () => {
    const map = buildMap('yard', 1, 3)
    const s = createState({ area: 4, seed: 3, chars: ['chim', 'magic', 'cheolmyeon', 'dangun'], mode: 'arena', teams: [0, 0, 1, 1], targetKills: 5 }, map)
    for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, map, s.players.map(idle))
    const [a, b] = s.players
    expect(isEnemy(a, b)).toBe(false)
    const o = openRow(map, 10)
    a.x = o.x
    a.y = o.y
    b.x = o.x + 5 * TILE
    b.y = o.y
    b.invuln = 0
    const hp = b.hp
    for (let t = 0; t < 20; t++) step(s, map, [press(BTN_FIRE, radToAngle(0)), idle(), idle(), idle()])
    expect(b.hp).toBe(hp)
  })

  it('목표 킬을 채우면 끝나고, 죽은 자리에 힐팩이 떨어진다', () => {
    const { s, map } = ready(['chim', 'cheolmyeon'], 'arena')
    const [a, b] = s.players
    let drops = 0
    for (let round = 0; round < 3; round++) {
      // 앞 판의 힐팩을 밟고 살아나지 않게 치운다 (떨어진 수는 이벤트로 센다)
      s.globes.length = 0
      b.invuln = 0
      b.hp = 1
      const o = openRow(map, 10)
      a.x = o.x
      a.y = o.y
      b.x = o.x + 4 * TILE
      b.y = o.y
      for (let t = 0; t < 30 && b.alive; t++) {
        step(s, map, [press(BTN_FIRE, radToAngle(0)), idle()])
        for (const e of s.events) if (e.type === 'drop') drops++
      }
      for (let t = 0; t < 200 && !b.alive; t++) step(s, map, [idle(), idle()])
    }
    expect(a.kills).toBe(3)
    expect(s.phase).toBe('over')
    expect(s.winner).toBe(a.team)
    expect(drops).toBe(3)
  })

  it('스킬도 적 플레이어를 친다 (소독 화염)', () => {
    const { s, map } = ready(['magic', 'chim'], 'arena')
    const [a, b] = s.players
    const o = openRow(map, 6)
    a.x = o.x
    a.y = o.y
    b.x = o.x + 2 * TILE
    b.y = o.y
    b.invuln = 0
    const hp = b.hp
    step(s, map, [press(BTN_SKILL2, radToAngle(0)), idle()])
    expect(b.hp).toBeLessThan(hp)
  })

  it('봇 넷 개인전 2분: 결정론 (같은 시드 같은 해시)', () => {
    const run = () => {
      const map = buildMap('garage', 4, 12)
      const chars: CharacterId[] = ['chim', 'cheolmyeon', 'dangun', 'oknyang']
      const s = createState({ area: 4, seed: 12, chars, mode: 'arena', targetKills: 99 }, map)
      const bots = chars.map((_, i) => makePvpBot(i + 3))
      const hashes: number[] = []
      let kills = 0
      for (let t = 0; t < 60 * 120; t++) {
        step(s, map, chars.map((_, i) => pvpBotInput(s, map, i, bots[i], 'normal')))
        for (const e of s.events) if (e.type === 'death') kills++
        if (s.tick % 600 === 0) hashes.push(hashState(s))
      }
      return { hashes, kills }
    }
    const a = run()
    const b = run()
    expect(a.hashes).toEqual(b.hashes)
    expect(a.kills).toBeGreaterThan(3)
  })
})
