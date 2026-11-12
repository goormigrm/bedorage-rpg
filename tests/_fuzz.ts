// 시험 도우미 (2026-11-12 버그 검사): 이어진 세계 판 만들기 · 불변식 검사 · 시드 고정 무작위 입력.
// 시험 파일(*.test.ts)이 아니다 — fuzz · scenario · mpsync 시험이 같이 쓴다.
import { CHARACTER_LIST, CharacterId } from '../src/core/characters'
import { botSheet } from '../src/core/botsheet'
import { Input } from '../src/core/input'
import { Item, LEVEL_CAP, SLOT_COUNT } from '../src/core/items'
import { GameMap } from '../src/core/map'
import { Rng, rand, randInt } from '../src/core/rng'
import { GameState } from '../src/core/state'
import { AREAS, QUESTS, WAYPOINTS, areaLayout, buildAreaMap, isRift, questPoints, townNpcs, wpBit } from '../src/core/world'

export const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0, cmd: 0, arg: 0 })

/** 지역 맵을 한 번만 만드는 맵 함수 (세션의 mapOf 와 같다). 시드마다 모듈에 붙잡아 둬 시험끼리 나눠 쓴다 — 맵 만들기가 시험 시간의 대부분이다 */
const mapCache = new Map<number, Map<number, GameMap>>()
export function world(seed: number): (id: number) => GameMap {
  let maps = mapCache.get(seed)
  if (!maps) mapCache.set(seed, (maps = new Map()))
  return (id) => {
    let m = maps.get(id)
    if (!m) maps.set(id, (m = buildAreaMap(seed, id)))
    return m
  }
}

/** 막 act 까지 끝낸 그 레벨짜리 한 벌 (퀘스트 · 웨이포인트 모두 · 골드 넉넉히) */
export function richSheet(char: CharacterId, level: number, act = 4, seed = 7) {
  // 봇 한 벌의 uid 는 누구나 900000 + 부위다 — 사람 세이브처럼 사람마다 다르게 (시드로 벌린다)
  const uid0 = 1000 + (seed % 5000) * 10
  const quests = QUESTS.map((q) => (q.act < act ? 3 : 0))
  const sh = botSheet(char, level, level, seed, quests, questPoints(quests), level >= LEVEL_CAP ? 12 : 0)
  sh.wps = WAYPOINTS.reduce((m, id) => (AREAS[id].act <= Math.min(3, act) ? m | wpBit(id) : m), 0)
  sh.gold = 500000
  sh.equip.forEach((it, i) => {
    if (it) it.uid = uid0 + i
  })
  return sh
}

const walk = (v: unknown, path: string, bad: string[]): void => {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) bad.push(`${path} = ${v}`)
  } else if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) walk(v[i], `${path}[${i}]`, bad)
  } else if (v && typeof v === 'object') {
    for (const k in v) walk((v as Record<string, unknown>)[k], `${path}.${k}`, bad)
  }
}

/**
 * 판의 불변식 — 어긴 것들의 글(없으면 빈 배열). 어느 틱에서나 참이어야 하는 것만:
 * 숫자는 모두 유한 · 체력 0 ~ 최대 · 골드는 0 이상 정수 · 가방 · 보관함은 한도 안 · 아이템 uid 는 한 사람 안에서 겹치지 않음 ·
 * 바닥 전리품의 주인은 -1 이거나 있는 자리 · 죽은/나간 사람의 상태 · 괴물 표적은 있는 자리
 */
export function invariants(s: GameState): string[] {
  const bad: string[] = []
  const { events: _e, evSpans: _s, ...rest } = s
  walk(rest, 's', bad)
  const n = s.players.length
  for (const p of s.players) {
    const tag = `p${p.id}`
    if (p.hp < 0 || p.hp > p.maxHp + 1e-6) bad.push(`${tag} hp ${p.hp} / ${p.maxHp}`)
    if (p.maxHp <= 0) bad.push(`${tag} maxHp ${p.maxHp}`)
    if (!(p.gold >= 0) || !Number.isInteger(p.gold)) bad.push(`${tag} gold ${p.gold}`)
    if (p.level < 1 || p.level > LEVEL_CAP || !Number.isInteger(p.level)) bad.push(`${tag} level ${p.level}`)
    if (p.xp < 0) bad.push(`${tag} xp ${p.xp}`)
    if (p.bag.length > p.bagMax) bad.push(`${tag} bag ${p.bag.length} > ${p.bagMax}`)
    if (p.stash.length > p.stashMax) bad.push(`${tag} stash ${p.stash.length} > ${p.stashMax}`)
    if (p.equip.length !== SLOT_COUNT) bad.push(`${tag} equip 길이 ${p.equip.length}`)
    if (p.stamina < 0 || p.stamina > p.staminaMax + 1e-6) bad.push(`${tag} stamina ${p.stamina}`)
    if (p.alive && p.left) bad.push(`${tag} 나갔는데 살아 있음`)
    if (!p.alive && p.downed) bad.push(`${tag} 죽었는데 쓰러진 상태`)
    if (p.alive && !p.downed && p.hp <= 0) bad.push(`${tag} 살아 있는데 hp ${p.hp}`)
    if (p.merc >= n || p.follow >= n) bad.push(`${tag} merc ${p.merc} follow ${p.follow}`)
    for (const c of p.cd) if (c < 0) bad.push(`${tag} cd ${c}`)
    const seen = new Set<number>()
    const items: (Item | null | undefined)[] = [...p.equip, ...p.bag, ...p.stash]
    p.equip.forEach((it, slot) => {
      if (it && it.slot !== slot) bad.push(`${tag} 장비 칸 ${slot} 에 ${it.slot} 부위`)
    })
    for (const it of items) {
      if (it === null) continue
      if (!it || typeof it !== 'object') {
        bad.push(`${tag} 아이템 자리에 ${String(it)}`)
        continue
      }
      if (seen.has(it.uid)) bad.push(`${tag} uid ${it.uid} 겹침`)
      seen.add(it.uid)
      if (it.slot < 0 || it.slot >= SLOT_COUNT) bad.push(`${tag} 아이템 부위 ${it.slot}`)
    }
  }
  const areaOk = (id: number) => isRift(id) || !!AREAS[id]
  for (const a of s.areas ?? []) {
    if (!areaOk(a.id)) bad.push(`지역 ${a.id} 없음`)
    for (const d of a.drops) {
      if (d.owner !== -1 && !(d.owner >= 0 && d.owner < n)) bad.push(`지역 ${a.id} 전리품 주인 ${d.owner}`)
      if (d.gold < 0) bad.push(`지역 ${a.id} 전리품 골드 ${d.gold}`)
    }
    const ids = new Set<number>()
    for (const m of a.monsters) {
      if (ids.has(m.id)) bad.push(`지역 ${a.id} 괴물 id ${m.id} 겹침`)
      ids.add(m.id)
      if (m.target >= n) bad.push(`지역 ${a.id} 괴물 ${m.id} 표적 ${m.target}`)
      if (m.hp > m.maxHp + 1e-6) bad.push(`지역 ${a.id} 괴물 ${m.id} hp ${m.hp} / ${m.maxHp}`)
    }
  }
  for (const p of s.players) if (!p.left && !areaOk(p.area)) bad.push(`p${p.id} 지역 ${p.area} 없음`)
  return bad
}

const CMD_MAX = 36
/** 무작위 입력 하나: 이동 · 조준 · 버튼 아무거나 + 가끔 아무 명령 · 아무 인자 (손댄 손님이 보낼 수 있는 모든 것) */
export function fuzzInput(r: Rng, cmdRate = 0.25): Input {
  const wide = rand(r) < 0.1
  return {
    mx: wide ? randInt(r, -128, 128) : randInt(r, -1, 2),
    my: wide ? randInt(r, -128, 128) : randInt(r, -1, 2),
    aim: randInt(r, 0, 1024),
    aimDist: randInt(r, 0, 256),
    // 버튼은 드문드문 켠다 (모두 켜면 늘 포털 · 구르기만 한다) — 가끔은 16비트 아무 값
    buttons: rand(r) < 0.05 ? randInt(r, 0, 65536) : (rand(r) < 0.5 ? 1 : 0) | (rand(r) < 0.3 ? 1 << randInt(r, 0, 16) : 0),
    char: rand(r) < 0.02 ? randInt(r, 0, 256) : 0,
    cmd: rand(r) < cmdRate ? randInt(r, 1, CMD_MAX + 1) : 0,
    arg: rand(r) < 0.5 ? randInt(r, 0, 256) : randInt(r, 0, 12),
  }
}

/** 사람을 그 지역의 뜻 있는 자리(NPC 곁 · 웨이포인트 · 출구 · 시작 자리) 가운데 하나로 옮긴다 — 명령이 조건에 닿게 */
export function hopSpot(s: GameState, mapOf: (id: number) => GameMap, r: Rng, idx: number): void {
  const p = s.players[idx]
  if (!p || p.left || !AREAS[p.area]) return
  const l = areaLayout(p.area, mapOf(p.area))
  const spots: { x: number; y: number }[] = [l.spawn, ...l.exits, ...townNpcs(p.area)]
  if (l.wp) spots.push(l.wp)
  if (l.special) spots.push(l.special)
  const at = spots[randInt(r, 0, spots.length)]
  p.x = at.x
  p.y = at.y
  p.exitLock = 0
}

export const ALL_CHARS = CHARACTER_LIST.map((c) => c.id as CharacterId)
