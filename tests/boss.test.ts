// 막 보스 패턴 (2026-09-23 사용자: "보스는 각자 가진 특별한 패턴 · 퍼센트 데미지로 탱커든 딜러든 힐러든 동일하게 ·
// 넉백을 포함한 모든 상태 이상이 먹히지 않게 · 보스 방은 구조물 없이 넓게 · 각 막 보스는 적어도 3가지 일정한 패턴").
import { describe, expect, it } from 'vitest'
import { Input } from '../src/core/input'
import { GameMap, TILE, TILE_FLOOR, walkField } from '../src/core/map'
import { BOSS_PATS, BOSS_PLANS, BOSS_SWIPE_PM, BOSS_ULT, BOSS_ULT_CD, BossPatId, MONSTER_LIST, MonsterKindId } from '../src/core/monsters'
import { CharacterId } from '../src/core/characters'
import { createState, step } from '../src/core/sim'
import { GameState, MS_CHASE, MS_WINDUP, Monster, ZONE_FUSE, ZS_CONE, ZS_RING } from '../src/core/state'
import { cosA, sinA } from '../src/core/fixedmath'
import { areaLayout, buildAreaMap } from '../src/core/world'
import { inZone } from '../src/core/bosszone'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })
const BOSSES: [number, MonsterKindId][] = [
  [9, 'butcher'],
  [18, 'queen'],
  [27, 'warden'],
  [34, 'lord'],
]

function bossGame(area: number, seed: number, chars: CharacterId[] = ['chim']) {
  const map = buildAreaMap(seed, area)
  const s = createState({ area, seed, chars }, map)
  const boss = s.monsters.find((m) => MONSTER_LIST[m.kind].boss)!
  for (const m of s.monsters) if (m !== boss) m.hp = 0
  const run = () => step(s, map, chars.map(() => idle()))
  return { map, s, boss, run }
}

/** 보스에게서 d 떨어진, 결투장 가운데 쪽 자리 (결투장 밖으로 밀려나지 않게) */
function nearBoss(map: GameMap, b: Monster, d: number): { x: number; y: number } {
  const a = map.arena!
  let dx = a.x - b.x
  let dy = a.y - b.y
  const l = Math.hypot(dx, dy)
  if (l < 40) {
    dx = -1
    dy = 0
  } else {
    dx /= l
    dy /= l
  }
  return { x: b.x + dx * d, y: b.y + dy * d }
}

describe('보스 결투장', () => {
  for (const [area, id] of BOSSES) {
    it(`${MONSTER_LIST.find((m) => m.id === id)!.name}: 둥근 빈 방 가운데 · 입구는 멀리 · 걸어서 닿는다 · 무리는 결투장 밖`, () => {
      const { map, s, boss } = bossGame(area, 90 + area)
      const a = map.arena!
      expect(a).toBeTruthy()
      expect(MONSTER_LIST[boss.kind].id).toBe(id)
      expect(Math.hypot(boss.x - a.x, boss.y - a.y)).toBeLessThan(2)
      // 안쪽에는 벽 · 상자가 하나도 없다
      for (let ty = 0; ty < map.h; ty++) {
        for (let tx = 0; tx < map.w; tx++) {
          const x = tx * TILE + TILE / 2
          const y = ty * TILE + TILE / 2
          if (Math.hypot(x - a.x, y - a.y) <= a.r - TILE) expect(map.tiles[ty * map.w + tx]).toBe(TILE_FLOOR)
        }
      }
      expect(a.r).toBeGreaterThanOrEqual(12 * TILE)
      const l = areaLayout(area, map)
      expect(Math.hypot(l.exits[0].x - a.x, l.exits[0].y - a.y)).toBeGreaterThan(a.r)
      const steps = walkField(map, Math.floor(l.exits[0].y / TILE) * map.w + Math.floor(l.exits[0].x / TILE))
      expect(Number.isFinite(steps[Math.floor(a.y / TILE) * map.w + Math.floor(a.x / TILE)])).toBe(true)
      // 처음 채운 무리는 결투장 밖 (위에서 지운 것 말고 새로 만들어 본다)
      const s2 = createState({ area, seed: 90 + area, chars: ['chim'] }, map)
      for (const m of s2.monsters) if (!MONSTER_LIST[m.kind].boss) expect(Math.hypot(m.x - a.x, m.y - a.y)).toBeGreaterThan(a.r)
      void s
    })
  }
})

describe('보스 패턴 — 정해진 차례 · 셋 이상', () => {
  for (const [area, id] of BOSSES) {
    const plan = BOSS_PLANS[id]!
    it(`${MONSTER_LIST.find((m) => m.id === id)!.name}: ${plan.order[0].join(' → ')}`, () => {
      const { map, s, boss, run } = bossGame(area, 70 + area)
      const p = s.players[0]
      const seen: BossPatId[] = []
      let last = -1
      for (let t = 0; t < 60 * 45 && seen.length < plan.order[0].length + 2; t++) {
        const at = nearBoss(map, boss, 140)
        p.x = at.x
        p.y = at.y
        p.hp = p.maxHp
        p.invuln = 99
        // 부른 졸개는 치운다 (부르기가 다시 되게 · 보스만 본다)
        for (const m of s.monsters) if (m !== boss) m.hp = 0
        run()
        const pat = boss.st === MS_WINDUP ? (boss.pat ?? -1) : -1
        if (pat >= 0 && pat !== last) seen.push(BOSS_PATS[pat].id)
        last = pat
      }
      // 첫 바퀴는 정해진 차례 그대로
      expect(seen.slice(0, plan.order[0].length)).toEqual(plan.order[0])
      // 피해를 주는 패턴이 셋 이상 (부르기 빼고)
      const hurting = new Set(seen.filter((x) => x !== 'brood' && x !== 'guards' && x !== 'shades'))
      expect(hurting.size).toBeGreaterThanOrEqual(3)
    })
  }

  it('분노 단계: 도살자 · 여왕 · 관리인은 절반에서, 군주는 2/3 · 1/3 에서 (차례가 길어진다)', () => {
    for (const [area, id] of BOSSES) {
      const { map, s, boss, run } = bossGame(area, 60 + area)
      const p = s.players[0]
      const rages: number[] = []
      const plan = BOSS_PLANS[id]!
      for (let t = 0; t < 60 * 6; t++) {
        const at = nearBoss(map, boss, 140)
        p.x = at.x
        p.y = at.y
        p.hp = p.maxHp
        p.invuln = 99
        if (t === 60) boss.hp = Math.round(boss.maxHp * (plan.stages[0] - 0.02))
        if (t === 200 && plan.stages[1]) boss.hp = Math.round(boss.maxHp * (plan.stages[1] - 0.02))
        run()
        for (const e of s.events) if (e.type === 'bossRage') rages.push(e.stage)
      }
      expect(rages).toEqual(plan.stages.map((_, i) => i + 1))
      expect(plan.order[plan.order.length - 1].length).toBeGreaterThan(plan.order[0].length)
      void map
    }
  })
})

describe('보스 피해는 최대 체력의 % — 탱커든 딜러든 같게', () => {
  it('보스 범위: 탱커(철면)와 딜러(침착) 모두 최대 체력의 35% (방어 · 역할 감소 무시)', () => {
    const { s, boss, run } = bossGame(27, 51, ['cheolmyeon', 'chim'])
    boss.hp = 0
    const [a, b] = s.players
    b.x = a.x + 30
    b.y = a.y
    a.maxHp = a.hp = 400
    b.maxHp = b.hp = 173
    // 들어설 때의 무적을 끈다
    a.invuln = b.invuln = 0
    s.zones.push({ id: 9999, kind: ZONE_FUSE, owner: -1, x: a.x + 15, y: a.y, r: 120, t: 1, max: 1, dmg: 0, pm: 350 })
    run()
    expect(a.hp).toBe(400 - Math.round(400 * 0.35))
    expect(b.hp).toBe(173 - Math.round(173 * 0.35))
  })

  it('보스 휘두르기: 최대 체력의 10%', () => {
    const { s, boss, run } = bossGame(9, 52, ['cheolmyeon'])
    const p = s.players[0]
    p.maxHp = p.hp = 500
    boss.scd = 99999
    let hit = 0
    for (let t = 0; t < 60 * 8 && hit === 0; t++) {
      p.x = boss.x - (MONSTER_LIST[boss.kind].r + 20)
      p.y = boss.y
      const before = p.hp
      run()
      if (p.hp < before) hit = before - p.hp
    }
    expect(hit).toBe(Math.round(500 * (BOSS_SWIPE_PM / 1000)))
  })
})

describe('보스는 상태 이상이 먹히지 않는다', () => {
  it('기절 · 둔화 · 넉백 · 도발을 걸어도 한 틱 뒤에 모두 없다 · 밀려나지 않는다', () => {
    for (const [area] of BOSSES) {
      const { map, s, boss, run } = bossGame(area, 40 + area)
      const p = s.players[0]
      const at = nearBoss(map, boss, 200)
      p.x = at.x
      p.y = at.y
      p.invuln = 99
      boss.st = MS_CHASE
      boss.stun = 120
      boss.slow = 300
      boss.kx = 40
      boss.ky = -40
      boss.taunt = 200
      const x0 = boss.x
      const y0 = boss.y
      run()
      expect(boss.stun).toBe(0)
      expect(boss.slow).toBe(0)
      expect(boss.kx).toBe(0)
      expect(boss.ky).toBe(0)
      expect(boss.taunt).toBe(0)
      expect(Math.hypot(boss.x - x0, boss.y - y0)).toBeLessThan(MONSTER_LIST[boss.kind].speed * 2 + 1)
      void (s as GameState)
    }
  })
})

describe('예고 범위 모양', () => {
  it('원 · 고리(안쪽은 안전) · 줄 · 부채', () => {
    expect(inZone({ x: 0, y: 0, r: 100 }, 90, 0, 0)).toBe(true)
    expect(inZone({ x: 0, y: 0, r: 100 }, 120, 0, 0)).toBe(false)
    expect(inZone({ x: 0, y: 0, r: 300, shape: 1, r2: 100 }, 50, 0, 0)).toBe(false)
    expect(inZone({ x: 0, y: 0, r: 300, shape: 1, r2: 100 }, 200, 0, 0)).toBe(true)
    expect(inZone({ x: 0, y: 0, r: 20, shape: 2, a: 0, len: 400 }, 300, 10, 0)).toBe(true)
    expect(inZone({ x: 0, y: 0, r: 20, shape: 2, a: 0, len: 400 }, 300, 40, 0)).toBe(false)
    expect(inZone({ x: 0, y: 0, r: 20, shape: 2, a: 256, len: 400 }, 0, 300, 0)).toBe(true)
    expect(inZone({ x: 0, y: 0, r: 200, shape: 3, a: 0, arc: 128 }, 100, 30, 0)).toBe(true)
    expect(inZone({ x: 0, y: 0, r: 200, shape: 3, a: 0, arc: 128 }, -100, 0, 0)).toBe(false)
  })
})

// 즉사기 (2026-09-24 사용자: "보스들은 모두 가끔 쓰는 패턴에 맞으면 레벨 · 탱에 상관없이 무조건 한 방에 죽는 스킬 — 쓸 때는 특정 대사 ·
// 화면 경고" · "즉사기여도 무적 상태는 적용되게")
describe('막 보스 즉사기', () => {
  it('막 보스 넷 모두 즉사기 하나씩 — 대사 · 피하는 법 · 긴 예고', () => {
    for (const [, id] of BOSSES) {
      const ult = BOSS_ULT[id]!
      const d = BOSS_PATS.find((p) => p.id === ult)!
      expect(d.kill).toBe(true)
      expect(d.line?.length).toBeGreaterThan(3)
      expect(d.hint?.length).toBeGreaterThan(3)
      expect(d.windup).toBeGreaterThanOrEqual(120)
    }
    expect(BOSS_ULT_CD.first).toBeGreaterThan(10 * 60)
  })

  for (const [area, id] of BOSSES) {
    it(`${MONSTER_LIST.find((m) => m.id === id)!.name}: 범위 안의 탱커는 체력이 가득이어도 쓰러지고 · 무적은 버티고 · 안전한 곳은 멀쩡하다`, () => {
      const { map, s, boss, run } = bossGame(area, 50 + area, ['cheolmyeon', 'chim', 'magic'])
      const [tank, inv, safe] = s.players
      boss.st = MS_CHASE
      boss.target = 0
      boss.kcd = 0
      boss.scd = 0
      boss.los = 1
      let z: (typeof s.zones)[number] | undefined
      let ult = false
      for (let t = 0; t < 120 && !z; t++) {
        for (const p of s.players) {
          const at = nearBoss(map, boss, 140)
          p.x = at.x
          p.y = at.y
        }
        run()
        ult ||= s.events.some((e) => e.type === 'bossUlt')
        z = s.zones.find((q) => q.kill)
      }
      expect(ult).toBe(true)
      expect(z).toBeTruthy()
      expect(BOSS_PATS[boss.pat ?? 0].id).toBe(BOSS_ULT[id])
      const zone = z!
      const shape = zone.shape ?? 0
      // 위험한 자리 · 안전한 자리 (모양마다)
      const danger =
        shape === ZS_RING ? { x: zone.x + (zone.r2 ?? 0) + 150, y: zone.y }
        : shape === ZS_CONE ? { x: zone.x + cosA(zone.a ?? 0) * 200, y: zone.y + sinA(zone.a ?? 0) * 200 }
        : { x: zone.x + 100, y: zone.y }
      const safeAt =
        shape === ZS_RING ? { x: zone.x, y: zone.y }
        : shape === ZS_CONE ? { x: zone.x + cosA(((zone.a ?? 0) + 512) & 1023) * 150, y: zone.y + sinA(((zone.a ?? 0) + 512) & 1023) * 150 }
        : { x: zone.x + zone.r + 120, y: zone.y }
      expect(inZone(zone, danger.x, danger.y, 0)).toBe(true)
      expect(inZone(zone, safeAt.x, safeAt.y, 20)).toBe(false)
      let hit = false
      const ticks = zone.t + 5
      for (let t = 0; t < ticks; t++) {
        tank.x = danger.x
        tank.y = danger.y
        tank.hp = tank.maxHp
        tank.invuln = 0
        tank.bossCd = 999 // 보스 공격 쿨다운도 무시한다
        inv.x = danger.x
        inv.y = danger.y + 20
        inv.invuln = 99
        safe.x = safeAt.x
        safe.y = safeAt.y
        safe.invuln = 0
        safe.hp = safe.maxHp
        if (tank.downed) break
        run()
        hit ||= s.events.some((e) => e.type === 'ultHit' && e.p === tank.id)
      }
      expect(tank.downed).toBe(true)
      expect(hit).toBe(true)
      expect(inv.downed).toBe(false)
      expect(safe.downed).toBe(false)
    })
  }
})

// 2026-09-24 사용자: "보스는 자기가 공격하거나 스킬을 쓰려고 움직이는 게 아니면 밀려서 움직이는 일이 없게"
describe('막 보스는 밀리지 않는다', () => {
  for (const [area, id] of BOSSES) {
    it(`${MONSTER_LIST.find((m) => m.id === id)!.name}: 사람이 몸으로 밀고 들어가도 보스는 그대로 · 사람이 비킨다`, () => {
      const { s, boss, run } = bossGame(area, 30 + area)
      const p = s.players[0]
      // 깨어 있지만 예고 중(제자리) — 스스로는 움직이지 않는다
      boss.st = MS_WINDUP
      boss.t = 9999
      boss.pat = -1
      boss.mode = 0
      const bx = boss.x
      const by = boss.y
      const r = MONSTER_LIST[boss.kind].r
      for (let t = 0; t < 30; t++) {
        p.x = boss.x - r * 0.5
        p.y = boss.y
        p.invuln = 99
        run()
      }
      expect(Math.hypot(boss.x - bx, boss.y - by)).toBeLessThan(0.5)
      expect(Math.hypot(p.x - boss.x, p.y - boss.y)).toBeGreaterThan(r * 0.5 + 1)
    })
  }
})
