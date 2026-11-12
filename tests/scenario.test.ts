// 시나리오 시험 (2026-11-12 버그 검사): 봇 파티가 실제 지역에서 싸우는 긴 판 · 난이도 × 막 진입 · 모든 스킬 · 모든 전설 효과 ·
// 모든 정예 접두 · 모든 후원 이벤트(마을 · 들판 · 보스 방 · 시련) · 나감/난입 순서 조합 · 세이브 왕복 · 투기장 —
// 어디서나 예외가 없고 불변식(tests/_fuzz invariants)이 지켜지며, 같은 입력이면 같은 해시(판을 JSON 으로 받아 이어 돌려도)
import { describe, expect, it } from 'vitest'
import { botInput, makeBot } from '../src/core/bot'
import { CharacterId } from '../src/core/characters'
import { DONATE_EVENTS } from '../src/core/donate'
import { makeMonster } from '../src/core/dungeon'
import { BTN_FIRE, CMD_DONATE, CMD_DONATE_HI, CMD_TRIAL, Input, SKILL_BTNS } from '../src/core/input'
import { LEGENDS, SLOT_WEAPON, sanitizeSheet } from '../src/core/items'
import { buildMap } from '../src/core/map'
import { ELITE_AFFIXES, MONSTER_LIST } from '../src/core/monsters'
import { makeRng, randInt } from '../src/core/rng'
import { areaView, createState, dropPlayer, hashState, joinPlayer, snapshot, step } from '../src/core/sim'
import { MAX_RANK } from '../src/core/skills'
import { GameState, MS_CHASE, OBJ_CHEST, OBJ_SHRINE } from '../src/core/state'
import { ACTS, AREAS, isRift, townNpcs } from '../src/core/world'
import { playerSheet } from '../src/game/save'
import { ALL_CHARS, fuzzInput, idle, invariants, richSheet, world } from './_fuzz'

const mapOf = world(31)
const PARTY: CharacterId[] = ['cheolmyeon', 'chim', 'magic', 'oknyang']
const ok = (s: GameState, tag: string) => {
  const bad = invariants(s)
  if (bad.length) throw new Error(`${tag} 틱 ${s.tick}: ${bad.slice(0, 6).join(' · ')}`)
}
/** 그 막의 길 순서 (마을 → … → 보스 방) */
function actPath(act: number): number[] {
  const out: number[] = []
  let prev = ACTS[act].town
  let at: number | undefined = AREAS[prev].links[0]
  while (at !== undefined && out.length < 20) {
    out.push(at)
    if (AREAS[at].kind === 'boss') break
    const next: number | undefined = AREAS[at].links.find((l) => l !== prev)
    prev = at
    at = next
  }
  return out
}

/** 봇 넷이 area 에서 ticks 동안 싸운다. 돌린 입력을 돌려준다 (다시 돌려 보기용) */
function botParty(area: number, ticks: number, tier = 0, seed = 77): { s: GameState; log: Input[][]; hashes: number[] } {
  const lv = Math.min(30, AREAS[area].level + tier * 10)
  const s = createState({ seed, chars: PARTY, area, tier, sheets: PARTY.map((c, i) => richSheet(c, lv, AREAS[area].act, seed + i)) }, mapOf)
  const bots = PARTY.map((_, i) => makeBot(seed * 31 + i))
  const log: Input[][] = []
  const hashes: number[] = []
  for (let t = 0; t < ticks; t++) {
    const inputs = s.players.map((p, i) => (p.left ? idle() : botInput(areaView(s, p.area), mapOf(p.area), i, bots[i], 'normal')))
    log.push(inputs.map((x) => ({ ...x })))
    step(s, mapOf, inputs)
    if (t % 15 === 0) ok(s, `지역 ${area}`)
    if (t % 100 === 99) hashes.push(hashState(s))
  }
  return { s, log, hashes }
}

/** 같은 입력으로 다시 돌린다 — swapAt 틱에 판을 JSON 으로 주고받은 사본으로 갈아탄다 */
function replay(area: number, log: Input[][], tier: number, seed: number, swapAt: number): number[] {
  const lv = Math.min(30, AREAS[area].level + tier * 10)
  let s = createState({ seed, chars: PARTY, area, tier, sheets: PARTY.map((c, i) => richSheet(c, lv, AREAS[area].act, seed + i)) }, mapOf)
  const hashes: number[] = []
  log.forEach((inputs, t) => {
    if (t === swapAt) s = JSON.parse(JSON.stringify(snapshot(s))) as GameState
    step(s, mapOf, inputs)
    if (t % 100 === 99) hashes.push(hashState(s))
  })
  return hashes
}

describe('봇 파티 긴 판', () => {
  it('1막 길 전체(들판 · 던전 · 보스 방)를 지역마다 싸운다 — 불변식 · JSON 으로 받은 판도 같은 해시', () => {
    for (const area of actPath(0)) {
      const a = botParty(area, 500)
      expect(replay(area, a.log, 0, 77, 251)).toEqual(a.hashes)
      // 싸우긴 했다 (보스 방 · 빈 지역이 아니면)
      if (AREAS[area].kind !== 'boss') expect(a.s.players.reduce((n, p) => n + p.shots, 0)).toBeGreaterThan(0)
    }
  })

  it('보스 방 넷: 보스와 2000틱 — 불변식 · 예외 없음', () => {
    for (let act = 0; act < 4; act++) {
      const boss = actPath(act).at(-1)!
      expect(AREAS[boss].kind).toBe('boss')
      const a = botParty(boss, 2000, 0, 78 + act)
      expect(a.s.tick).toBe(2000)
      // 정말 싸웠다
      expect(a.s.players.reduce((n, p) => n + p.dmgDealt, 0)).toBeGreaterThan(0)
    }
  })

  it('난이도 셋 × 막 넷: 첫 들판과 보스 방에 들어가 200틱', () => {
    for (let tier = 0; tier < 3; tier++) {
      for (let act = 0; act < 4; act++) {
        const path = actPath(act)
        for (const area of [path[0], path.at(-1)!]) {
          const a = botParty(area, 200, tier, 90 + tier)
          expect(a.s.tier).toBe(tier)
          expect(a.s.players.every((p) => p.area === area || p.left)).toBe(true)
        }
      }
    }
  })
})

/** 전투 지역 4(1막 들판)에 괴물 없이 세우고, 0번 앞에 괴물 n 마리를 붙인다 */
function arenaWith(chars: CharacterId[], level: number, kinds: number[], seed = 61, elite = 0) {
  const s = createState({ seed, chars, area: 4, noMonsters: true, sheets: chars.map((c, i) => richSheet(c, level, 4, seed + i)) }, mapOf)
  const p = s.players[0]
  kinds.forEach((k, i) => {
    const m = makeMonster(s, k, p.x + 90 + (i % 3) * 30, p.y + (i - 1) * 40, 9000 + i, 1, 100, level)
    m.st = MS_CHASE
    m.target = 0
    m.elite = elite
    s.monsters.push(m)
    s.monstersTotal++
  })
  return s
}

describe('모든 것 한 번씩', () => {
  it('모든 캐릭터 × 스킬 칸 다섯 × 변형 셋 — 쓰고 120틱', () => {
    const kinds = [0, 1, 2, 3]
    for (const c of ALL_CHARS) {
      for (let v = 0; v < 3; v++) {
        const s = arenaWith([c, 'magic'], 30, kinds)
        const p = s.players[0]
        // 트리를 모두 찍고 변형을 고른다 (v = 0 변형 없음 · 1 · 2)
        p.build.r = p.build.r.map(() => MAX_RANK)
        p.build.m3 = p.build.m3.map(() => v)
        p.build.m5 = p.build.m5.map(() => v)
        p.build.s = [0, 1, 3, 4]
        p.focus = 100
        let cast = 0
        for (let slot = 0; slot < SKILL_BTNS.length; slot++) {
          p.cd = p.cd.map(() => 0)
          p.focus = 100
          for (let t = 0; t < 120; t++) {
            step(s, mapOf, [{ ...idle(), aim: 0, aimDist: 30, buttons: (t < 2 ? SKILL_BTNS[slot] : 0) | (t % 9 === 0 ? BTN_FIRE : 0) }, idle()])
            if (s.events.some((e) => e.type === 'skill' && e.p === 0)) cast++
          }
          ok(s, `${c} 칸 ${slot} 변형 ${v}`)
        }
        // 다섯 칸이 모두 나갔다
        expect(cast, `${c} 변형 ${v}`).toBeGreaterThanOrEqual(SKILL_BTNS.length)
      }
    }
  })

  it('모든 전설 효과: 무기에 달고 300틱 싸운다', () => {
    for (let leg = 0; leg < LEGENDS.length; leg++) {
      const s = arenaWith(['chim', 'oknyang'], 20, [0, 1, 2, 3, 0, 1])
      const p = s.players[0]
      const w = p.equip[SLOT_WEAPON]!
      w.leg = leg
      w.rarity = 3
      // 불굴은 쓰러질 만큼 맞아야 드러난다
      p.hp = Math.min(p.hp, 30)
      const bot = makeBot(leg + 1)
      for (let t = 0; t < 300; t++) step(s, mapOf, [botInput(areaView(s, 4), mapOf(4), 0, bot, 'normal'), idle()])
      ok(s, `전설 ${leg} ${LEGENDS[leg].name}`)
    }
  })

  it('모든 정예 접두 × 괴물 종류: 접두를 단 괴물과 250틱', () => {
    const kinds = MONSTER_LIST.map((d, i) => (d.boss ? -1 : i)).filter((i) => i >= 0)
    for (const af of ELITE_AFFIXES) {
      for (let k = 0; k < kinds.length; k += 4) {
        const s = arenaWith(['cheolmyeon', 'chim'], 20, kinds.slice(k, k + 4), 62, 1 | af.bit)
        const bots = [makeBot(3), makeBot(4)]
        for (let t = 0; t < 250; t++) step(s, mapOf, s.players.map((_, i) => botInput(areaView(s, 4), mapOf(4), i, bots[i], 'normal')))
        ok(s, `접두 ${af.name} 종류 ${kinds.slice(k, k + 4)}`)
      }
    }
  })

  it('모든 후원 이벤트를 마을 · 들판 · 보스 방 · 시련에서 — 손님 자리가 보내도 판이 깨지지 않는다', () => {
    const TOWN = ACTS[0].town
    const places: [string, () => GameState][] = [
      ['마을', () => createState({ seed: 5, chars: ['chim', 'magic'], sheets: [richSheet('chim', 30), richSheet('magic', 30, 4, 8)] }, mapOf)],
      ['들판', () => createState({ seed: 5, chars: ['chim', 'magic'], area: 4, sheets: [richSheet('chim', 30), richSheet('magic', 30, 4, 8)] }, mapOf)],
      ['보스 방', () => createState({ seed: 5, chars: ['chim', 'magic'], area: actPath(0).at(-1)!, sheets: [richSheet('chim', 30), richSheet('magic', 30, 4, 8)] }, mapOf)],
      [
        '시련',
        () => {
          const s = createState({ seed: 5, chars: ['chim', 'magic'], sheets: [richSheet('chim', 30), richSheet('magic', 30, 4, 8)] }, mapOf)
          const gate = townNpcs(TOWN).find((n) => n.id === 'trial')!
          for (const p of s.players) {
            p.x = gate.x
            p.y = gate.y + 20
          }
          step(s, mapOf, [{ ...idle(), cmd: CMD_TRIAL, arg: 1 }, idle()])
          for (let t = 0; t < 3; t++) step(s, mapOf, [idle(), idle()])
          expect(isRift(s.players[0].area)).toBe(true)
          return s
        },
      ],
    ]
    for (const [name, make] of places) {
      for (const e of DONATE_EVENTS) {
        const s = make()
        const don: Input = { ...idle(), cmd: e.id >= 16 ? CMD_DONATE_HI : CMD_DONATE, arg: (e.id & 15) | (3 << 4) }
        // 방송인(0번)이 한 번, 손님(1번)이 연달아 다섯 번
        step(s, mapOf, [don, idle()])
        for (let k = 0; k < 5; k++) step(s, mapOf, [idle(), don])
        for (let t = 0; t < 150; t++) step(s, mapOf, [{ ...idle(), buttons: t % 7 === 0 ? BTN_FIRE : 0 }, idle()])
        ok(s, `${name} 후원 ${e.key}`)
      }
    }
  })
})

describe('나감 · 난입 순서 조합', () => {
  it('세 자리를 아무 순서로 비우고 채워도 불변식이 지켜지고, 같은 순서면 같은 해시', () => {
    const run = (seed: number) => {
      const r = makeRng(seed)
      const s = createState({ seed: 9, chars: PARTY, area: 4, sheets: PARTY.map((c, i) => richSheet(c, 12, 1, i)) }, mapOf)
      const bots = PARTY.map((_, i) => makeBot(i + 1))
      for (let k = 0; k < 24; k++) {
        const seat = randInt(r, 1, 4)
        if (s.players[seat].left) joinPlayer(s, mapOf, seat, ALL_CHARS[randInt(r, 0, ALL_CHARS.length)], 0, randInt(r, 0, 2) ? richSheet('chim', 5 + k, 1, 40 + k) : undefined)
        else dropPlayer(s, seat)
        for (let t = 0; t < 40; t++) step(s, mapOf, s.players.map((p, i) => (p.left ? idle() : t % 3 === 0 ? fuzzInput(r, 0.3) : botInput(areaView(s, p.area), mapOf(p.area), i, bots[i], 'normal'))))
        ok(s, `순서 ${seed} · ${k}번째`)
      }
      return hashState(s)
    }
    for (const seed of [1, 2, 3]) expect(run(seed)).toBe(run(seed))
  })
})

describe('세이브 왕복', () => {
  it('판의 사람 → 기록 → JSON → sanitizeSheet → 다시 판: 레벨 · 골드 · 장비 · 가방 · 보관함 · 빌드 · 능력치 · 퀘스트 · 웨이포인트가 그대로', () => {
    for (const c of ['chim', 'cheolmyeon', 'magic'] as CharacterId[]) {
      const a = botParty(4, 600, 0, 81).s
      const p = a.players[PARTY.indexOf(c)]
      p.bag.forEach((it, i) => {
        if (i % 2) it.lk = 1
      })
      p.stash.push(...p.bag.splice(0, Math.min(2, p.bag.length)))
      const sheet = sanitizeSheet(JSON.parse(JSON.stringify(playerSheet(p))))
      const q = createState({ seed: 3, chars: [c], sheets: [sheet] }, mapOf).players[0]
      expect(q.level).toBe(p.level)
      expect(q.xp).toBe(Math.floor(p.xp))
      expect(q.gold).toBe(p.gold)
      expect(q.equip.map((e) => e?.uid ?? 0)).toEqual(p.equip.map((e) => e?.uid ?? 0))
      expect(q.bag).toEqual(p.bag)
      expect(q.stash).toEqual(p.stash)
      expect(q.build).toEqual(p.build)
      expect(q.attr).toEqual(p.attr)
      expect(q.quests).toEqual(p.quests)
      expect(q.wps).toBe(p.wps)
      expect(q.bagMax).toBe(p.bagMax)
      expect(q.maxHp).toBe(p.maxHp)
      // 한 번 더 돌려도 같다 (정리가 값을 바꾸지 않는다)
      expect(sanitizeSheet(JSON.parse(JSON.stringify(playerSheet(q))))).toEqual(sheet)
    }
  })
})

describe('물건: 제단 · 함정 상자 · 연속 처치가 받은 판(난입 · 리싱크)에도 실린다', () => {
  it('JSON 으로 주고받아도 ks · ksT · trap · 축복 칸이 남고 이어 돌린 해시가 같다', () => {
    const s = createState({ seed: 61, chars: ['chim', 'magic'], area: 4, sheets: [richSheet('chim', 12, 1), richSheet('magic', 12, 1, 3)] }, mapOf)
    const [a, b] = s.players
    b.x = a.x + 40
    b.y = a.y
    s.objects.push({ id: 9001, kind: OBJ_SHRINE, x: a.x + 20, y: a.y, used: false, v: 2 }, { id: 9002, kind: OBJ_CHEST, x: a.x - 30, y: a.y, used: false, v: 0, trap: true })
    a.ks = 12
    a.ksT = 100
    const j = JSON.parse(JSON.stringify(snapshot(s))) as GameState
    expect(j.players[0].ks).toBe(12)
    expect(j.players[0].ksT).toBe(100)
    expect(j.objects.find((o) => o.id === 9002)?.trap).toBe(true)
    const bots = [makeBot(1), makeBot(2)]
    for (let t = 0; t < 400; t++) {
      const inputs = s.players.map((p, i) => ({ ...botInput(areaView(s, p.area), mapOf(p.area), i, bots[i], 'normal'), buttons: t === 0 ? 1 << 6 : botInput(areaView(s, p.area), mapOf(p.area), i, makeBot(9), 'normal').buttons }))
      step(s, mapOf, inputs)
      step(j, mapOf, inputs)
    }
    expect(s.players[1].shrineT).toBeGreaterThan(0)
    ok(s, '물건')
    expect(hashState(j)).toBe(hashState(s))
  })
})

describe('투기장', () => {
  it('무작위 입력 1500틱 (개인전 · 팀전): 예외 · NaN 없음 · 두 번 돌려 같은 해시', () => {
    const map = buildMap('studio', 1, 555)
    const run = (teams: number[] | undefined, seed: number) => {
      const r = makeRng(seed)
      const s = createState({ seed, mode: 'arena', teams, targetKills: 5, chars: PARTY, sheets: PARTY.map((c, i) => richSheet(c, 30, 4, i)) }, map)
      for (let t = 0; t < 1500; t++) {
        if (t === 700) dropPlayer(s, 3)
        step(s, map, s.players.map(() => fuzzInput(r, 0.2)))
        if (t % 15 === 0) ok(s, '투기장')
      }
      return hashState(s)
    }
    expect(run(undefined, 4)).toBe(run(undefined, 4))
    expect(run([0, 0, 1, 1], 5)).toBe(run([0, 0, 1, 1], 5))
  })
})
