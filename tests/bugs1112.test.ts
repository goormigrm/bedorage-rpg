// 2026-11-12 버그 검사 — 정독으로 찾은 결함들의 되살아남 방지 시험 (결함마다 하나)
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, BTN_LOADING, BTN_SKILL1, BTN_SKILL3, BTN_USE, CMD_EQUIP, CMD_HIRE, CMD_LOCK, CMD_PICK, CMD_RESPEC, CMD_SELL, CMD_SKILL_SLOT, CMD_SKILL_UP, CMD_SKIN, CMD_TRIAL, CMD_UNEQUIP, Input } from '../src/core/input'
import { Item, SLOT_ARMOR, ST_HP, ST_SPEED, rollItem, sanitizeSheet } from '../src/core/items'
import { GameMap, TILE, TILE_FLOOR } from '../src/core/map'
import { makeRng } from '../src/core/rng'
import { createState, dropPlayer, hashState, joinPlayer, mercPrice, snapshot, step, warpPlayer } from '../src/core/sim'
import { GameState, PlayerState } from '../src/core/state'
import { ACTS, areaLayout, buildAreaMap, townNpcs } from '../src/core/world'
import { wireInput } from '../src/net/lockstep'
import { idle, invariants, richSheet, world } from './_fuzz'

const mapOf = world(31)
const TOWN = ACTS[0].town
const near = (p: PlayerState, id: string) => {
  const n = townNpcs(TOWN).find((q) => q.id === id)!
  p.x = n.x
  p.y = n.y + 20
}
const run = (s: GameState, n: number, f: (i: number, t: number) => Input = () => idle()) => {
  for (let t = 0; t < n; t++) step(s, mapOf, s.players.map((_, i) => f(i, t)))
}
const cmd = (s: GameState, who: number, c: number, arg: number) => run(s, 1, (i) => (i === who ? { ...idle(), cmd: c, arg } : idle()))
const mk = (uid: number, slot = SLOT_ARMOR): Item => rollItem(makeRng(uid), uid, 20, 'rifle', 'chest', 0, 1, slot)

describe('명령 · 경제', () => {
  it('잠근 아이템은 CMD_SELL 로도 팔리지 않는다', () => {
    const s = createState({ seed: 5, chars: ['chim'], sheets: [richSheet('chim', 20)] }, mapOf)
    const p = s.players[0]
    near(p, 'merchant')
    p.bag = [mk(11)]
    cmd(s, 0, CMD_LOCK, 0)
    const g0 = p.gold
    cmd(s, 0, CMD_SELL, 0)
    expect(p.bag.length).toBe(1)
    expect(p.gold).toBe(g0)
  })

  it('체력 옵션 장비를 벗었다 껴도 체력이 차지 않는다 (비율을 지킨다) · 쓰러진 사람은 0 그대로', () => {
    const s = createState({ seed: 5, chars: ['chim'], sheets: [richSheet('chim', 20)], area: 4, noMonsters: true }, mapOf)
    const p = s.players[0]
    const it = mk(12)
    it.aff = [ST_HP, 300]
    p.equip[SLOT_ARMOR] = it
    cmd(s, 0, CMD_UNEQUIP, SLOT_ARMOR)
    cmd(s, 0, CMD_EQUIP, p.bag.indexOf(it))
    // 가득이면 가득
    expect(p.hp).toBe(p.maxHp)
    p.hp = p.maxHp / 2
    for (let k = 0; k < 3; k++) {
      cmd(s, 0, CMD_UNEQUIP, SLOT_ARMOR)
      cmd(s, 0, CMD_EQUIP, p.bag.indexOf(it))
    }
    expect(p.hp).toBeCloseTo(p.maxHp / 2, 3)
    p.hp = 0
    p.downed = true
    p.downTimer = 600
    cmd(s, 0, CMD_UNEQUIP, SLOT_ARMOR)
    cmd(s, 0, CMD_EQUIP, p.bag.indexOf(it))
    expect(p.hp).toBe(0)
  })

  it('덮임 신호(BTN_LOADING)에 사격을 같이 실어도 보호받는 동안에는 쏘지 못한다', () => {
    const s = createState({ seed: 9, chars: ['chim'], sheets: [richSheet('chim', 8, 1)], area: 4 }, mapOf)
    const p = s.players[0]
    const m0 = s.monsters[Math.floor(s.monsters.length / 2)]
    p.x = m0.x + 40
    p.y = m0.y
    const x0 = p.x
    // CMD_SKIN 으로 보호 시간을 다시 세며 내내 쏘고 움직인다
    run(s, 900, (_i, t) => ({ ...idle(), buttons: BTN_FIRE | BTN_LOADING, mx: 1, cmd: t % 600 === 0 ? CMD_SKIN : 0 }))
    expect(p.shots).toBe(0)
    expect(p.kills).toBe(0)
    expect(p.x).toBe(x0)
  })

  it('재분배 뒤 같은 스킬이 두 칸에 걸리지 않는다', () => {
    const s = createState({ seed: 7, chars: ['magic'], sheets: [richSheet('magic', 30)], area: 4, noMonsters: true }, mapOf)
    const p = s.players[0]
    if (p.build.r[2] === 0) cmd(s, 0, CMD_SKILL_UP, 2)
    cmd(s, 0, CMD_SKILL_SLOT, (0 << 4) | 2)
    expect(p.build.s).toEqual([2, 1, 0, 3])
    warpPlayer(s, mapOf, 0, TOWN)
    cmd(s, 0, CMD_RESPEC, 0)
    expect(new Set(p.build.s).size).toBe(4)
    // Q · E 만 바꿔 쓰던 배치는 남는다
    cmd(s, 0, CMD_SKILL_SLOT, (0 << 4) | 1)
    expect(p.build.s).toEqual([1, 0, 2, 3])
    cmd(s, 0, CMD_RESPEC, 0)
    expect(p.build.s).toEqual([1, 0, 2, 3])
    void BTN_SKILL1
    void BTN_SKILL3
  })

  it('CMD_PICK: 전리품 번호가 255 를 넘어도 보낸 사람 판과 받은 사람 판이 같다 (입력은 한 바이트)', () => {
    const make = () => {
      const s = createState({ seed: 7, chars: ['chim', 'magic'], sheets: [richSheet('chim', 20), richSheet('magic', 20, 4, 8)], area: 4, noMonsters: true }, mapOf)
      const p = s.players[0]
      s.nextDropId = 301
      s.drops.push({ id: 300, owner: 0, x: p.x + 150, y: p.y, item: mk(88), gold: 0, pot: 0, ttl: 9999, lock: 0 })
      p.autoPick = 0
      return s
    }
    const A = make()
    const B = make()
    const local: Input = { ...idle(), cmd: CMD_PICK, arg: 300 }
    const wire = wireInput(local)
    expect(wire.arg).toBe(300 & 255)
    step(A, mapOf, [local, idle()])
    step(B, mapOf, [wire, idle()])
    for (let t = 0; t < 120; t++) {
      step(A, mapOf, [idle(), idle()])
      step(B, mapOf, [idle(), idle()])
    }
    expect(A.players[0].bag.some((b) => b.uid === 88)).toBe(true)
    expect(hashState(B)).toBe(hashState(A))
  })
})

describe('용병 · 시련 — 다른 지역에 있는 사람도 센다', () => {
  it('주인이 나가면 용병도 물러난다 — 그 자리에 들어온 사람의 용병이 되지 않는다', () => {
    const s = createState({ seed: 7, chars: ['chim', 'magic', 'magic'], absent: [true, false, true], sheets: [undefined, richSheet('magic', 30)] }, mapOf)
    joinPlayer(s, mapOf, 0, 'chim', 0, richSheet('chim', 30))
    const a = s.players[0]
    near(a, 'captain')
    cmd(s, 0, CMD_HIRE, 0)
    const m = s.players.find((q) => q.merc === 0)!
    expect(m).toBeTruthy()
    dropPlayer(s, 0)
    run(s, 30)
    expect(m.left && m.vacant && m.merc === -1).toBe(true)
    joinPlayer(s, mapOf, 0, 'oknyang', 0, richSheet('oknyang', 5, 1, 3))
    run(s, 5)
    expect(s.players.some((q) => q.merc === 0 && !q.left)).toBe(false)
    expect(invariants(s)).toEqual([])
  })

  it('들판에 쓰러져 있는 용병도 값 계산 · 모두 내보내기에 든다', () => {
    const s = createState({ seed: 7, chars: ['chim', 'magic', 'magic'], absent: [false, true, true], sheets: [richSheet('chim', 30)] }, mapOf)
    const a = s.players[0]
    near(a, 'captain')
    cmd(s, 0, CMD_HIRE, 0)
    const m = s.players.find((q) => q.merc === 0)!
    warpPlayer(s, mapOf, 0, 4)
    run(s, 3)
    expect(m.area).toBe(4)
    m.hp = 0
    m.downed = true
    m.downTimer = 600
    warpPlayer(s, mapOf, 0, TOWN)
    near(a, 'captain')
    const g = a.gold
    cmd(s, 0, CMD_HIRE, 0)
    expect(g - a.gold).toBe(mercPrice(30, 1))
    cmd(s, 0, CMD_HIRE, 255)
    run(s, 2)
    expect(s.players.filter((q) => q.merc === 0 && !q.left).length).toBe(0)
    // 내보낸 자리는 빈 자리 그대로다 (지역 묶기가 끝나며 left 가 되살아나지 않는다)
    expect(m.left && m.vacant).toBe(true)
    expect(invariants(s)).toEqual([])
  })

  it('파티원이 시련 안에 있으면 새 시련을 열지 못한다', () => {
    const s = createState({ seed: 7, chars: ['chim', 'magic'], sheets: [richSheet('chim', 30), richSheet('magic', 30, 4, 8)] }, mapOf)
    const [a, b] = s.players
    near(a, 'trial')
    near(b, 'trial')
    cmd(s, 0, CMD_TRIAL, 1)
    run(s, 2)
    const r1 = s.rift!.area
    expect(b.area).toBe(r1)
    // 방장만 마을로 돌아와 새 시련을 열어 본다
    warpPlayer(s, mapOf, 0, TOWN)
    near(a, 'trial')
    cmd(s, 0, CMD_TRIAL, 1)
    run(s, 2)
    expect(s.rift!.area).toBe(r1)
    expect(b.area).toBe(r1)
  })
})

describe('손댄 세이브', () => {
  const armor = (aff: unknown[]) => ({ ...mk(5), aff })
  const sheetWith = (it: unknown) => sanitizeSheet(JSON.parse(JSON.stringify({ ...richSheet('chim', 12, 1), equip: [null, null, it, null, null] })))

  it('옵션 배열이 홀수 길이 · 없는 옵션 번호 · 음수 · 너무 큰 값인 아이템은 버린다', () => {
    for (const aff of [[ST_HP], [99, 10], [-1, 10], [1.5, 10], [ST_SPEED, -1e7], [ST_HP, 1e308], [ST_HP, -400]]) expect(sheetWith(armor(aff)).equip[2]).toBeNull()
    // 멀쩡한 것은 남는다
    expect(sheetWith(armor([ST_HP, 300])).equip[2]).not.toBeNull()
  })

  it('부위 · 등급 · 레벨이 글자 · 소수인 아이템은 버린다', () => {
    const sh = sanitizeSheet(JSON.parse(JSON.stringify({ ...richSheet('chim', 12, 1), bag: [{ ...mk(6), slot: '1' }, { ...mk(7), slot: 0.5 }, { ...mk(8), rarity: 2.5 }, { ...mk(9), ilvl: '30' }, { ...mk(10), wt: 'pan' }, mk(11)] })))
    expect(sh.bag.map((b) => b.uid)).toEqual([11])
  })

  it('나쁜 옵션이 든 기록으로 판을 만들어도 최대 체력이 NaN 이 아니고 JSON 으로 받은 판과 같다', () => {
    const s = createState({ seed: 9, chars: ['chim', 'magic'], sheets: [sheetWith(armor([ST_HP])), richSheet('magic', 12, 1, 3)], area: 4 }, mapOf)
    expect(Number.isFinite(s.players[0].maxHp)).toBe(true)
    run(s, 200)
    const j = JSON.parse(JSON.stringify(snapshot(s))) as GameState
    run(s, 200)
    for (let t = 0; t < 200; t++) step(j, mapOf, j.players.map(() => idle()))
    expect(invariants(s)).toEqual([])
    expect(hashState(j)).toBe(hashState(s))
  })
})

describe('지역 자리 (areaLayout)', () => {
  it('구조물이 부서진 뒤 맵을 새로 만든 사람(난입 · 리싱크)도 출구 자리가 같다', () => {
    const seed = 61
    const AREA = 8
    const CRATE = 222
    const fresh = () => {
      const maps = new Map<number, GameMap>()
      return (id: number) => maps.get(id) ?? maps.set(id, buildAreaMap(seed, id)).get(id)!
    }
    const mapA = fresh()
    const A = createState({ seed, chars: ['chim'], area: AREA, noMonsters: true }, mapA)
    const p = A.players[0]
    const m = mapA(AREA)
    const L0 = JSON.stringify(areaLayout(AREA, m))
    const cx = CRATE % m.w
    const cy = Math.floor(CRATE / m.w)
    // 상자에서 곧게 3 ~ 6칸 떨어진 바닥에 서서 부서질 때까지 쏜다
    let broke = false
    outer: for (const [dx, dy, aim] of [[-1, 0, 0], [1, 0, 512], [0, -1, 256], [0, 1, 768]] as const) {
      for (const dist of [3, 4, 5, 6]) {
        let ok = true
        for (let k = 1; k <= dist; k++) if (m.tiles[(cy + dy * k) * m.w + cx + dx * k] !== TILE_FLOOR) ok = false
        if (!ok) continue
        p.x = (cx + dx * dist + 0.5) * TILE
        p.y = (cy + dy * dist + 0.5) * TILE
        for (let t = 0; t < 4000 && A.cover?.[AREA]?.[CRATE] !== 0; t++) step(A, mapA, [{ ...idle(), aim, aimDist: 30, buttons: BTN_FIRE }])
        broke = A.cover?.[AREA]?.[CRATE] === 0
        if (broke) break outer
      }
    }
    expect(broke).toBe(true)
    // 판을 받은 사람: 맵을 시드로 새로 만들고, 받은 판의 부서진 구조물을 맞춘 뒤 자리를 묻는다
    const mapB = fresh()
    const B = JSON.parse(JSON.stringify(snapshot(A))) as GameState
    step(A, mapA, [idle()])
    step(B, mapB, [idle()])
    expect(JSON.stringify(areaLayout(AREA, mapB(AREA)))).toBe(L0)
    // 옆 지역으로 나갔다 돌아와도 같은 판
    const goBy = (to: number) => {
      for (const [S, mo] of [[A, mapA], [B, mapB]] as const) {
        const q = S.players[0]
        const e = areaLayout(q.area, mo(q.area)).exits.find((x) => x.to === to)!
        q.x = e.x
        q.y = e.y
        q.exitLock = 0
      }
      for (let t = 0; t < 41; t++) {
        const inp = { ...idle(), buttons: t === 0 ? BTN_USE : 0 }
        step(A, mapA, [inp])
        step(B, mapB, [inp])
      }
    }
    const back = areaLayout(AREA, m).exits[0].to
    goBy(back)
    goBy(AREA)
    expect(A.players[0].area).toBe(AREA)
    expect(hashState(B)).toBe(hashState(A))
  })
})
