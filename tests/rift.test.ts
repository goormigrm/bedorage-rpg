// 시련 (반복 끝 콘텐츠) · 숙련 (레벨 30 뒤 성장) — 2026-10-08 퀄리티 2차 7단계 D3
import { describe, expect, it } from 'vitest'
import { BTN_SKILL2, BTN_USE, CMD_ATTR, CMD_DONATE, CMD_TRIAL, Input } from '../src/core/input'
import { GameMap } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { COUNTDOWN_TICKS, GameState, MS_CHASE } from '../src/core/state'
import { LEVEL_CAP, MASTERY_XP, ST_DMG, computeStats, emptySheet, sanitizeSheet } from '../src/core/items'
import { makeMonster } from '../src/core/dungeon'
import { DONATE_EVENTS } from '../src/core/donate'
import { ACTS, QUESTS, RIFT_TICKS, actBossQuest, areaDef, buildAreaMap, isRift, riftId, riftScale, townNpcs } from '../src/core/world'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

/** 4막 마을에서 시작 (보통 난이도의 심연의 군주를 쓰러뜨린 캐릭터) · 시련의 문 곁 */
function town(opened = true, seed = 61): { s: GameState; mapOf: (id: number) => GameMap } {
  const maps = new Map<number, GameMap>()
  const mapOf = (id: number) => maps.get(id) ?? maps.set(id, buildAreaMap(seed, id)).get(id)!
  const s = createState({ seed, chars: ['magic'], area: ACTS[3].town }, mapOf)
  for (let i = 0; i < COUNTDOWN_TICKS + 1; i++) step(s, mapOf, [idle()])
  const p = s.players[0]
  if (opened) p.quests[actBossQuest(3)] = 3
  const gate = townNpcs(ACTS[3].town).find((n) => n.id === 'trial')!
  p.x = gate.x + 30
  p.y = gate.y
  return { s, mapOf }
}

describe('시련', () => {
  it('지역 번호 = 판에서 몇 번째 × 4 + 막 · 그 막의 맵 · 출구 없음', () => {
    const id = riftId(2, 3)
    expect(isRift(id)).toBe(true)
    const d = areaDef(id)
    expect(d.act).toBe(3)
    expect(d.kind).toBe('dungeon')
    expect(d.links.length).toBe(0)
    expect(d.name).toMatch(/시련/)
    // 단계가 오를수록 세진다
    expect(riftScale(10).hp).toBeGreaterThan(riftScale(1).hp)
    expect(riftScale(10).loot).toBeGreaterThan(riftScale(1).loot)
  })

  it('심연의 군주를 쓰러뜨리기 전에는 열 수 없다', () => {
    const { s, mapOf } = town(false)
    step(s, mapOf, [{ ...idle(), cmd: CMD_TRIAL, arg: 1 }])
    step(s, mapOf, [idle()])
    expect(s.rift).toBeUndefined()
    expect(s.players[0].area).toBe(ACTS[3].town)
  })

  it('열면 들어가고, 괴물은 단계만큼 세다 · 끝낸 단계 + 1 까지만', () => {
    const { s, mapOf } = town()
    // 아직 1단계도 안 끝냈다 — 2단계는 못 연다
    step(s, mapOf, [{ ...idle(), cmd: CMD_TRIAL, arg: 2 }])
    expect(s.rift).toBeUndefined()
    step(s, mapOf, [{ ...idle(), cmd: CMD_TRIAL, arg: 1 }])
    step(s, mapOf, [idle()])
    const p = s.players[0]
    expect(s.rift?.stage).toBe(1)
    expect(p.area).toBe(s.rift!.area)
    expect(isRift(p.area)).toBe(true)
    expect(s.rift!.need).toBeGreaterThan(20)
  })

  it('막대를 채우면 수호자 → 쓰러뜨리면 단계 기록 · 마을로 가는 문 → 시련의 문 앞으로', () => {
    const { s, mapOf } = town()
    step(s, mapOf, [{ ...idle(), cmd: CMD_TRIAL, arg: 1 }])
    step(s, mapOf, [idle()])
    const p = s.players[0]
    const r = s.rift!
    r.kills = r.need
    let guard = s.monsters.find((m) => m.rg === 1)
    for (let t = 0; t < 5 && !guard; t++) {
      step(s, mapOf, [idle()])
      guard = s.monsters.find((m) => m.rg === 1)
    }
    expect(guard).toBeDefined()
    expect(r.boss).toBe(1)
    // 수호자를 곁에 두고 체력 1 — 범위 스킬 한 번
    guard!.x = p.x + 40
    guard!.y = p.y
    guard!.hp = 1
    p.focus = 100
    step(s, mapOf, [{ ...idle(), buttons: BTN_SKILL2 }])
    for (let t = 0; t < 3 && r.boss < 2; t++) step(s, mapOf, [idle()])
    expect(r.boss).toBe(2)
    expect(r.ok).toBe(true)
    expect(p.riftBest).toBe(1)
    const exit = s.portals.find((q) => q.owner < 0)
    expect(exit).toBeDefined()
    // 막 보스 처치 · 퀘스트로 치지 않는다
    expect(s.killed.includes(r.area)).toBe(false)
    p.x = exit!.x
    p.y = exit!.y + 20
    p.exitLock = 0
    step(s, mapOf, [{ ...idle(), buttons: BTN_USE }])
    step(s, mapOf, [idle()])
    expect(p.area).toBe(ACTS[3].town)
    const gate = townNpcs(ACTS[3].town).find((n) => n.id === 'trial')!
    expect(Math.hypot(p.x - gate.x, p.y - gate.y)).toBeLessThan(5 * 32)
    // 이제 2단계를 열 수 있다
    p.x = gate.x + 30
    p.y = gate.y
    step(s, mapOf, [{ ...idle(), cmd: CMD_TRIAL, arg: 2 }])
    step(s, mapOf, [idle()])
    expect(s.rift?.stage).toBe(2)
    expect(s.rift?.area).not.toBe(r.area)
  })

  it('제한 시간을 넘기면 끝나도 단계가 오르지 않는다', () => {
    const { s, mapOf } = town()
    step(s, mapOf, [{ ...idle(), cmd: CMD_TRIAL, arg: 1 }])
    step(s, mapOf, [idle()])
    const p = s.players[0]
    const r = s.rift!
    r.t = RIFT_TICKS + 1
    r.kills = r.need
    step(s, mapOf, [idle()])
    const guard = s.monsters.find((m) => m.rg === 1)!
    guard.x = p.x + 40
    guard.y = p.y
    guard.hp = 1
    p.focus = 100
    step(s, mapOf, [{ ...idle(), buttons: BTN_SKILL2 }])
    for (let t = 0; t < 3 && r.boss < 2; t++) step(s, mapOf, [idle()])
    expect(r.boss).toBe(2)
    expect(r.ok).toBe(false)
    expect(p.riftBest).toBe(0)
  })
})

describe('숙련 (레벨 30 뒤)', () => {
  it('만렙 뒤 경험치가 숙련 점수가 되고, 점수를 쓰면 능력치가 오른다', () => {
    const { s, mapOf } = town()
    const p = s.players[0]
    p.level = LEVEL_CAP
    p.mxp = MASTERY_XP - 1
    step(s, mapOf, [{ ...idle(), cmd: CMD_TRIAL, arg: 1 }])
    step(s, mapOf, [idle()])
    // 괴물 하나를 곁에 두고 잡는다
    const m = makeMonster(s, 0, p.x + 40, p.y, 950, 1, 100, 30)
    m.st = MS_CHASE
    m.hp = 1
    s.monsters.push(m)
    p.focus = 100
    step(s, mapOf, [{ ...idle(), buttons: BTN_SKILL2 }])
    for (let t = 0; t < 3 && p.mlv === 0; t++) step(s, mapOf, [idle()])
    expect(p.mlv).toBe(1)
    expect(p.level).toBe(LEVEL_CAP)
    step(s, mapOf, [{ ...idle(), cmd: CMD_ATTR, arg: 20 }])
    expect(p.mst[0]).toBe(1)
    // 숙련 공격 1점 = 피해 +1% (장비 옵션 상한과 따로)
    expect(p.st[ST_DMG]).toBeCloseTo(computeStats(p.level, p.equip, p.attr)[ST_DMG] + 1, 5)
    // 더 쓸 점수가 없다
    step(s, mapOf, [{ ...idle(), cmd: CMD_ATTR, arg: 21 }])
    expect(p.mst[1]).toBe(0)
  })

  it('세이브: 만렙이 아니면 숙련 0 · 쓴 점이 레벨보다 많으면 되돌린다 · 시련 단계 범위', () => {
    expect(sanitizeSheet({ ...emptySheet(), level: 20, mlv: 5, mst: [5, 0, 0, 0] }).mlv).toBe(0)
    const a = sanitizeSheet({ ...emptySheet(), level: LEVEL_CAP, mlv: 3, mst: [2, 2, 0, 0], rift: 999 })
    expect(a.mst).toEqual([0, 0, 0, 0])
    expect(a.rift).toBe(60)
    const b = sanitizeSheet({ ...emptySheet(), level: LEVEL_CAP, mlv: 3, mst: [2, 1, 0, 0] })
    expect(b.mst).toEqual([2, 1, 0, 0])
    expect(QUESTS.length).toBeGreaterThan(0)
  })
})

// 2026-10-08 방송 검토: 시련 괴물만 단계만큼 세지고 후원으로 부른 괴물은 그대로였다 — 높은 단계에서 방해 후원이 약한 먹이가 되어 진행 막대를 채웠다
describe('시련 안의 후원 소환은 그 단계만큼 세다', () => {
  const summonedBoss = (stage: number) => {
    const { s, mapOf } = town(true, 62)
    s.players[0].riftBest = stage - 1
    step(s, mapOf, [{ ...idle(), cmd: CMD_TRIAL, arg: stage }])
    step(s, mapOf, [idle()])
    expect(s.rift?.stage).toBe(stage)
    const boss = DONATE_EVENTS.find((e) => e.key === 'boss')!.id
    step(s, mapOf, [{ ...idle(), cmd: CMD_DONATE, arg: boss | (1 << 4) }])
    const m = s.monsters.find((q) => q.sum === 2)!
    expect(m).toBeTruthy()
    return m
  }
  it('막 보스 후원: 10단계는 1단계보다 체력 · 공격력이 시련 배율만큼', () => {
    const a = summonedBoss(1)
    const b = summonedBoss(10)
    const k = riftScale(10).hp / riftScale(1).hp
    expect(b.maxHp / a.maxHp).toBeGreaterThan(k * 0.98)
    expect(b.maxHp / a.maxHp).toBeLessThan(k * 1.02)
    expect(b.pow).toBeGreaterThan(a.pow)
  })
})

// 2026-10-08 사용자: "도전 놀이에서 맵에 구조물이 너무 많아 보스가 나왔을 때 이동 자체가 어렵고 보스도 제대로 공격을 못 한다"
describe('시련 맵은 트인 싸움터', () => {
  it('막마다 · 맵마다: 상자 · 모래주머니 없음 · 바닥이 90% 안팎 · 테마는 그 막의 맵 그대로', async () => {
    const { TILE_CRATE, TILE_SANDBAG } = await import('../src/core/map')
    for (let act = 0; act < 4; act++)
      for (let n = 0; n < 5; n++) {
        const id = riftId(n, act)
        const m = buildAreaMap(7, id)
        let floor = 0
        for (const t of m.tiles) {
          expect(t === TILE_CRATE || t === TILE_SANDBAG).toBe(false)
          if (t === 0) floor++
        }
        expect(floor / m.tiles.length).toBeGreaterThan(0.88)
        expect(m.id).toBe(areaDef(id).map)
      }
  })
})
