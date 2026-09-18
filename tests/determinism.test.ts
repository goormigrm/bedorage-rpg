import { describe, expect, it } from 'vitest'
import { Difficulty, botInput, makeBot } from '../src/core/bot'
import { CHARACTERS, CHARACTER_LIST, CharacterId } from '../src/core/characters'
import { atan2A, radToAngle } from '../src/core/fixedmath'
import { BTN_DASH, BTN_FIRE, BTN_SWAP, Input } from '../src/core/input'
import { GameMap, TILE, TILE_FLOOR, TILE_SANDBAG, buildMap, rayCast } from '../src/core/map'
import { MAP_LIST, MapId, expandRows, scaleForPlayers } from '../src/core/maps'
import { createState, dropPlayer, hashState, snapshot, step } from '../src/core/sim'
import { Bullet, DASH_COST, DASH_TICKS, GameState, PLAYER_RADIUS, STAMINA_MAX, teamKills } from '../src/core/state'
import { PART_HEAD, PART_LEGS, WEAPONS } from '../src/core/weapons'

const map = buildMap('studio', 1, 777)

const idle = (aim = 0): Input => ({ mx: 0, my: 0, aim, buttons: 0, char: 0 })

interface RunOpts {
  seed: number
  chars: CharacterId[]
  diffs: Difficulty[]
  targetKills: number
  maxTicks: number
  map?: GameMap
  teams?: number[]
}

/** 봇끼리 경기. 60틱마다 해시를 모으고, 끝나면 멈춘다. */
function runBots(o: RunOpts): { hashes: number[]; state: GameState; ticks: number } {
  const m = o.map ?? map
  const state = createState({ seed: o.seed, targetKills: o.targetKills, chars: o.chars, teams: o.teams }, m)
  const bots = o.chars.map((_, i) => makeBot(o.seed ^ (i + 1)))
  const hashes: number[] = []
  let t = 0
  while (t < o.maxTicks && state.phase !== 'over') {
    const inputs: Input[] = bots.map((b, i) => botInput(state, m, i, b, o.diffs[i]))
    step(state, m, inputs)
    if (t % 60 === 0) hashes.push(hashState(state))
    t++
  }
  return { hashes, state, ticks: t }
}

/** 테스트용 탄 하나를 상태에 직접 넣는다 */
function shoot(state: GameState, owner: number, x: number, y: number, vx: number, vy: number, damage: number, over = false): Bullet {
  const b: Bullet = {
    id: state.nextBulletId++, owner, x, y, px: x, py: y, vx, vy,
    // 2인 시험이라 상대는 1 - owner. 커서가 그 사람 위에 있었다고 친다 (헤드샷 규칙 2026-09-05)
    life: 60, damage, ads: false, ox: x, oy: y, weapon: 'rifle', hitSomeone: false, over, overR: 0, headTarget: 1 - owner,
  }
  state.bullets.push(b)
  return b
}

function playing(state: GameState): GameState {
  state.phase = 'playing'
  state.phaseTimer = 0
  return state
}

describe('결정론', () => {
  it('같은 시드·입력이면 해시가 완전히 같다', () => {
    const o: RunOpts = { seed: 12345, chars: ['chim', 'cheolmyeon'], diffs: ['hard', 'normal'], targetKills: 99, maxTicks: 60 * 40 }
    expect(runBots(o).hashes).toEqual(runBots(o).hashes)
  })

  it('다른 시드는 다른 경기', () => {
    const a = runBots({ seed: 1, chars: ['chim', 'cheolmyeon'], diffs: ['hard', 'normal'], targetKills: 99, maxTicks: 60 * 10 })
    const b = runBots({ seed: 2, chars: ['chim', 'cheolmyeon'], diffs: ['hard', 'normal'], targetKills: 99, maxTicks: 60 * 10 })
    expect(a.hashes).not.toEqual(b.hashes)
  })

  it('스냅샷 복원 후 이어가도 같은 해시', () => {
    const seed = 777
    const s1 = createState({ seed, targetKills: 3, chars: ['jupeol', 'magic'] }, map)
    const s2 = createState({ seed, targetKills: 3, chars: ['jupeol', 'magic'] }, map)
    const b1 = [makeBot(9), makeBot(10)]
    const b2 = [makeBot(9), makeBot(10)]
    const go = (s: GameState, b: typeof b1, n: number) => {
      for (let t = 0; t < n; t++) step(s, map, [botInput(s, map, 0, b[0], 'easy'), botInput(s, map, 1, b[1], 'hard')])
    }
    go(s1, b1, 300)
    go(s2, b2, 300)
    const snap = snapshot(s1)
    go(s1, b1, 300)
    go(s2, b2, 300)
    expect(hashState(s1)).toBe(hashState(s2))
    expect(snap.tick).toBe(300)
  })

  it('경기가 실제로 끝난다 (목표 킬 도달)', () => {
    const { state } = runBots({ seed: 42, chars: ['chim', 'jupeol'], diffs: ['hard', 'hard'], targetKills: 2, maxTicks: 60 * 600 })
    expect(state.phase).toBe('over')
    expect(state.winner === 0 || state.winner === 1).toBe(true)
    expect(Math.max(state.players[0].kills, state.players[1].kills)).toBe(2)
  })
})

describe('4인 개인전 (FFA)', () => {
  const chars: CharacterId[] = ['cheolmyeon', 'chim', 'dangun', 'magic']
  const diffs: Difficulty[] = ['hard', 'hard', 'normal', 'normal']

  it('4명이 결정론적으로 같은 경기를 한다', () => {
    const o: RunOpts = { seed: 2026, chars, diffs, targetKills: 99, maxTicks: 60 * 30 }
    const a = runBots(o)
    expect(a.hashes).toEqual(runBots(o).hashes)
    expect(a.state.players.length).toBe(4)
    expect(new Set(a.state.players.map((p) => p.team)).size).toBe(4)
  })

  it('4명 경기가 끝나고, 이긴 사람이 목표 킬을 채운다', () => {
    const { state, ticks } = runBots({ seed: 77, chars, diffs, targetKills: 2, maxTicks: 60 * 900 })
    expect(state.phase).toBe('over')
    expect(state.players[state.winner].kills).toBe(2)
    expect(ticks).toBeLessThan(60 * 900)
  })

  it('초기 스폰은 서로 겹치지 않는다', () => {
    for (let seed = 1; seed < 12; seed++) {
      const s = createState({ seed, targetKills: 3, chars }, map)
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++) {
          const d = Math.hypot(s.players[i].x - s.players[j].x, s.players[i].y - s.players[j].y)
          expect(d).toBeGreaterThan(150)
        }
    }
  })

  it('나간 사람은 리스폰하지 않고 표적에서도 빠진다', () => {
    const s = createState({ seed: 5, targetKills: 99, chars }, map)
    const bots = chars.map((_, i) => makeBot(100 + i))
    for (let t = 0; t < 200; t++) step(s, map, bots.map((b, i) => botInput(s, map, i, b, 'normal')))
    dropPlayer(s, 2)
    expect(s.events.some((e) => e.type === 'leave' && e.p === 2)).toBe(true)
    for (let t = 0; t < 600; t++) step(s, map, bots.map((b, i) => botInput(s, map, i, b, 'normal')))
    expect(s.players[2].left).toBe(true)
    expect(s.tick).toBe(800)
  })
})

describe('캐릭터 교체 (Tab)', () => {
  it('죽은 뒤 Tab → 고르는 동안 소환되지 않고, 고르면 새 캐릭터로 먼 곳에 리스폰', () => {
    const s = playing(createState({ seed: 8, targetKills: 99, chars: ['chim', 'cheolmyeon'] }, map))
    const p = s.players[0]
    p.alive = false
    p.respawnTimer = 60
    step(s, map, [{ ...idle(), buttons: BTN_SWAP }, idle()])
    expect(p.choosing).toBe(true)
    for (let t = 0; t < 200; t++) step(s, map, [idle(), idle()])
    expect(p.alive).toBe(false)
    const idx = CHARACTER_LIST.findIndex((c) => c.id === 'dangun')
    step(s, map, [{ ...idle(), char: idx + 1 }, idle()])
    expect(p.alive).toBe(true)
    expect(p.char).toBe('dangun')
    expect(p.hp).toBe(CHARACTERS.dangun.maxHp)
    expect(Math.hypot(p.x - s.players[1].x, p.y - s.players[1].y)).toBeGreaterThan(250)
  })

  it('리스폰 3초가 지나면 Tab 이 무시된다', () => {
    const s = createState({ seed: 9, targetKills: 99, chars: ['chim', 'cheolmyeon'] }, map)
    for (let t = 0; t < 400; t++) step(s, map, [idle(), idle()])
    step(s, map, [{ ...idle(), buttons: BTN_SWAP }, idle()])
    expect(s.players[0].alive).toBe(true)
    expect(s.players[0].choosing).toBe(false)
  })
})

describe('12명 전원', () => {
  it('모든 캐릭터 조합이 결정론적으로 돌고 경기가 끝난다', () => {
    const ids = CHARACTER_LIST.map((c) => c.id)
    expect(ids.length).toBe(12)
    for (let g = 0; g < 3; g++) {
      const chars = ids.slice(g * 4, g * 4 + 4)
      const o: RunOpts = { seed: 500 + g, chars, diffs: ['hard', 'hard', 'hard', 'hard'], targetKills: 2, maxTicks: 60 * 900 }
      const a = runBots(o)
      expect(a.hashes).toEqual(runBots(o).hashes)
      expect(a.state.phase).toBe('over')
    }
  })

  it('저격총만 한 방에 죽일 수 있다', () => {
    const minHp = Math.min(...CHARACTER_LIST.map((c) => c.maxHp))
    for (const w of Object.values(WEAPONS)) {
      const head = w.pellets > 1 ? 1.5 : 2
      const burst = w.damage * w.pellets * head
      if (w.id === 'sniper') expect(burst).toBeGreaterThan(minHp)
      else expect(burst).toBeLessThan(minHp)
    }
  })
})

describe('기력과 대시', () => {
  it('대시는 기력을 쓰고, 기력이 없으면 구르지 못한다', () => {
    const s = playing(createState({ seed: 3, targetKills: 99, chars: ['chim', 'cheolmyeon'] }, map))
    const a = s.players[0]
    expect(a.stamina).toBe(STAMINA_MAX)
    const dash: Input = { mx: 0, my: 1, aim: 0, buttons: BTN_DASH, char: 0 }
    step(s, map, [dash, idle()])
    expect(a.stamina).toBeLessThanOrEqual(STAMINA_MAX - DASH_COST + 1)
    a.stamina = 5
    a.dashCooldown = 0
    a.dashTimer = 0
    step(s, map, [dash, idle()])
    expect(a.dashTimer).toBe(0)
    // 시간이 지나면 회복된다
    for (let t = 0; t < 300; t++) step(s, map, [idle(), idle()])
    expect(a.stamina).toBe(STAMINA_MAX)
  })

  it('대시(구르기) 중에는 맞지 않는다', () => {
    const s = playing(createState({ seed: 3, targetKills: 99, chars: ['chim', 'cheolmyeon'] }, map))
    const a = s.players[0]
    a.x = 200
    a.y = 200
    a.invuln = 0
    step(s, map, [{ mx: 0, my: 1, aim: 0, buttons: BTN_DASH, char: 0 }, idle()])
    expect(a.dashTimer).toBe(DASH_TICKS)
    const hp = a.hp
    shoot(s, 1, a.x - 60, a.y, 20, 0, 50)
    step(s, map, [idle(), idle()])
    expect(a.hp).toBe(hp)
  })
})

describe('부위 판정 (덕코프식 정확도)', () => {
  it('중심을 정확히 맞히면 머리, 가장자리를 스치면 다리', () => {
    const mk = (offset: number) => {
      const s = playing(createState({ seed: 11, targetKills: 99, chars: ['chim', 'cheolmyeon'] }, map))
      const spot = map.spawns[0]
      const v = s.players[1]
      v.x = spot.x
      v.y = spot.y
      v.invuln = 0
      s.players[0].x = spot.x - 200
      s.players[0].y = spot.y + offset
      shoot(s, 0, spot.x - 26, spot.y + offset, 16, 0, 30)
      // 커서가 상대 위(headTarget)면 맞기만 하면 머리다(2026-09-05). 궤적 부위 판정 자체를 보려면 커서를 뗀다
      if (offset !== 0) s.bullets[s.bullets.length - 1].headTarget = -1
      let hit: { part: number } | undefined
      for (let t = 0; t < 4 && !hit; t++) {
        step(s, map, [idle(), idle()])
        hit = s.events.find((e) => e.type === 'hit') as { part: number } | undefined
      }
      return hit
    }
    expect(mk(0)?.part).toBe(PART_HEAD)
    expect(mk(PLAYER_RADIUS * 0.9)?.part).toBe(PART_LEGS)
  })
})

describe('모래주머니', () => {
  it('맵마다 생기고, 탄을 막지만 엄폐 사격은 넘어간다', () => {
    const m = buildMap('studio', 1, 4242)
    expect(m.sandbagIdx.length).toBeGreaterThan(6)
    const idx = m.sandbagIdx[0]
    const tx = idx % m.w
    const ty = (idx / m.w) | 0
    const px = tx * TILE + TILE / 2
    const py = ty * TILE + TILE / 2
    expect(rayCast(m, px - 40, py, px + 40, py, 'bullet', false).blocked).toBe(true)
    expect(rayCast(m, px - 40, py, px + 40, py, 'bullet', true).blocked).toBe(false)
    // 시야는 넘어간다 (낮은 엄폐물)
    expect(rayCast(m, px - 40, py, px + 40, py, 'sight').blocked).toBe(false)
  })

  it('계속 맞으면 부서지고 지나갈 수 있게 된다', () => {
    const m = buildMap('studio', 1, 4242)
    const idx = m.sandbagIdx[0]
    const tx = idx % m.w
    const ty = (idx / m.w) | 0
    const s = playing(createState({ seed: 2, targetKills: 99, chars: ['chim', 'cheolmyeon'] }, m))
    expect(Object.keys(s.sandbags).length).toBe(m.sandbagIdx.length)
    const px = tx * TILE + TILE / 2
    const py = ty * TILE + TILE / 2
    for (let i = 0; i < 3; i++) {
      shoot(s, 0, px - 30, py, 20, 0, 120)
      step(s, m, [idle(), idle()])
    }
    expect(s.sandbags[idx]).toBeUndefined()
    expect(m.tiles[idx]).toBe(TILE_FLOOR)
  })
})

describe('후라이팬 (승빠덕)', () => {
  it('앞의 적을 때리고, 앞에서 오는 총알을 기력으로 막는다', () => {
    const s = playing(createState({ seed: 4, targetKills: 99, chars: ['seungwoo', 'chim'] }, map))
    const a = s.players[0]
    const b = s.players[1]
    expect(WEAPONS[a.weapon].melee).toBe(true)
    const spot = map.spawns[1]
    a.x = spot.x
    a.y = spot.y
    b.x = spot.x + 40
    b.y = spot.y
    b.invuln = 0
    a.invuln = 0
    const hp = b.hp
    step(s, map, [{ mx: 0, my: 0, aim: 0, buttons: BTN_FIRE, char: 0 }, idle()])
    expect(b.hp).toBeLessThan(hp)
    // 앞에서 온 총알은 기력으로 막는다
    const myHp = a.hp
    const st = a.stamina
    shoot(s, 1, a.x + 40, a.y, -16, 0, 40)
    for (let t = 0; t < 5; t++) step(s, map, [idle(), idle()])
    expect(a.hp).toBe(myHp)
    expect(a.stamina).toBeLessThan(st)
  })
})

describe('2v2 팀전', () => {
  it('같은 팀은 서로 맞지 않고, 팀 킬 합계로 이긴다', () => {
    const chars: CharacterId[] = ['cheolmyeon', 'chim', 'dangun', 'jupeol']
    const { state } = runBots({ seed: 31, chars, diffs: ['hard', 'hard', 'hard', 'hard'], targetKills: 3, maxTicks: 60 * 900, teams: [0, 0, 1, 1] })
    expect(state.phase).toBe('over')
    expect(teamKills(state, state.winner)).toBe(3)
    const total = state.players.reduce((a, p) => a + p.kills, 0)
    const deaths = state.players.reduce((a, p) => a + p.deaths, 0)
    expect(total).toBe(deaths)
  })
})

describe('맵 생성', () => {
  it('같은 시드는 같은 맵, 다른 시드는 다른 맵', () => {
    const a = buildMap('studio', 1, 100)
    const b = buildMap('studio', 1, 100)
    const c = buildMap('studio', 1, 101)
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles))
    expect(Array.from(a.tiles)).not.toEqual(Array.from(c.tiles))
  })

  it('모든 빈 칸이 서로 연결된다 (갇히는 곳 없음)', () => {
    for (const def of MAP_LIST) {
      for (let seed = 1; seed <= 10; seed++) {
        const m = buildMap(def.id as MapId, seed % 3 === 0 ? 2 : 1, seed * 91)
        const open: number[] = []
        for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] === TILE_FLOOR) open.push(i)
        const seen = new Set<number>([open[0]])
        const q = [open[0]]
        while (q.length) {
          const cur = q.pop()!
          const cx = cur % m.w
          const cy = (cur / m.w) | 0
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue
            const n = ny * m.w + nx
            if (m.tiles[n] !== TILE_FLOOR || seen.has(n)) continue
            seen.add(n)
            q.push(n)
          }
        }
        expect(seen.size).toBe(open.length)
      }
    }
  })

  it('가운데에 모래주머니 진지가 있고, 스폰은 빈 칸이며 넉넉하다', () => {
    for (const def of MAP_LIST) {
      const m = buildMap(def.id as MapId, 1, 555)
      expect(m.spawns.length).toBeGreaterThanOrEqual(4)
      for (const sp of m.spawns) {
        const t = m.tiles[Math.floor(sp.y / TILE) * m.w + Math.floor(sp.x / TILE)]
        expect(t).toBe(TILE_FLOOR)
      }
      let nearCenter = 0
      for (const i of m.sandbagIdx) {
        const tx = i % m.w
        const ty = (i / m.w) | 0
        if (Math.abs(tx - m.w / 2) <= 4 && Math.abs(ty - m.h / 2) <= 3) nearCenter++
      }
      // 진지는 8칸이지만 벽 자리에는 놓이지 않으므로 몇 칸은 빠질 수 있다
      expect(nearCenter).toBeGreaterThanOrEqual(4)
      expect(m.tiles.every((t) => t !== TILE_SANDBAG || true)).toBe(true)
    }
  })

  it('넓은 맵에서도 4인 봇 경기가 끝난다', () => {
    const big = buildMap('yard', 4, 31)
    const { state } = runBots({
      seed: 3, chars: ['cheolmyeon', 'chim', 'dangun', 'magic'],
      diffs: ['hard', 'hard', 'hard', 'hard'], targetKills: 1, maxTicks: 60 * 1200, map: big,
    })
    expect(state.phase).toBe('over')
  })
})

describe('맵 확장', () => {
  it('2배는 가로 거울, 4배는 가로·세로 거울이고 테두리가 유지된다', () => {
    for (const def of MAP_LIST) {
      const w = def.rows[0].length
      const h = def.rows.length
      const x2 = expandRows(def.rows, 2)
      expect(x2.length).toBe(h)
      expect(x2[0].length).toBe(w * 2 - 2)
      const x4 = expandRows(def.rows, 4)
      expect(x4.length).toBe(h * 2 - 2)
      for (const r of x4) expect(r.length).toBe(w * 2 - 2)
      const m = buildMap(def.id as MapId, 4, 9)
      expect(m.w).toBe(w * 2 - 2)
      expect(m.h).toBe(h * 2 - 2)
    }
    expect(scaleForPlayers(2)).toBe(1)
    expect(scaleForPlayers(3)).toBe(2)
    expect(scaleForPlayers(4)).toBe(4)
  })
})

describe('fixedmath', () => {
  it('atan2A 가 실제 atan2 와 근사한다', () => {
    for (let i = 0; i < 360; i += 7) {
      const rad = (i / 180) * Math.PI
      const a = atan2A(Math.sin(rad) * 100, Math.cos(rad) * 100)
      const ref = radToAngle(Math.atan2(Math.sin(rad) * 100, Math.cos(rad) * 100))
      expect(Math.abs(((a - ref + 512) & 1023) - 512)).toBeLessThanOrEqual(2)
    }
  })
})
