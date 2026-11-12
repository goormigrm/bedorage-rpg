// 2026-11-12 검토 — 흥미 요소: 보물 고블린 전리품 · 제단은 파티 모두 · 연속 처치 금화 · 함정 상자 · 일으킨 동료 기록
import { describe, expect, it } from 'vitest'
import { BTN_FIRE, BTN_USE, Input } from '../src/core/input'
import { CharacterId } from '../src/core/characters'
import { buildMap } from '../src/core/map'
import { makeMonster } from '../src/core/dungeon'
import { GOBLIN_KIND } from '../src/core/monsters'
import { createState, step } from '../src/core/sim'
import { CURSE_WAVES, MS_RECOVER, Monster, OBJ_CHEST, OBJ_CURSED, OBJ_SHRINE, SHRINE_TICKS } from '../src/core/state'
import { ACHIEVEMENTS, emptyStats, sanitizeStats } from '../src/core/stats'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

function field(chars: CharacterId[] = ['chim'], seed = 61) {
  const map = buildMap('crypt', 1, seed)
  const s = createState({ area: 4, seed, chars, noMonsters: true }, map)
  s.objects = []
  const run = (n: number, inp: Input = idle()) => {
    for (let t = 0; t < n; t++) step(s, map, s.players.map((_, i) => (i === 0 ? inp : idle())))
  }
  /** 괴물을 0번 앞(+x)에 붙잡아 두고 쓰러질 때까지 쏜다 */
  const shoot = (m: Monster) => {
    const p = s.players[0]
    for (let t = 0; t < 900 && m.hp > 0; t++) {
      m.st = MS_RECOVER
      m.t = 999
      m.x = p.x + 70
      m.y = p.y
      run(1, { ...idle(), buttons: t % 2 ? BTN_FIRE : 0, aim: 0, aimDist: 15 })
    }
  }
  return { s, map, run, shoot }
}

describe('흥미 요소 (2026-11-12 검토)', () => {
  it('보물 고블린을 잡으면 금화 여덟 더미와 아이템 셋', () => {
    const { s, shoot } = field()
    const p = s.players[0]
    const g = makeMonster(s, GOBLIN_KIND, p.x + 70, p.y, 9997, 0.05)
    s.monsters.push(g)
    s.monstersTotal++
    const d0 = s.drops.length
    shoot(g)
    expect(g.hp).toBeLessThanOrEqual(0)
    const mine = s.drops.slice(d0).filter((d) => d.owner === 0)
    expect(mine.filter((d) => d.item).length).toBe(3)
    expect(mine.filter((d) => d.gold > 0).length).toBeGreaterThanOrEqual(8)
  })

  it('제단: 누른 사람만이 아니라 곁의 파티 모두가 축복을 받는다 · 쓰러져 나간 사람은 빼고', () => {
    const { s, run } = field(['chim', 'chim', 'chim'])
    const [a, b, c] = s.players
    b.x = a.x + 60
    b.y = a.y
    c.out = true
    s.objects.push({ id: 4, kind: OBJ_SHRINE, x: a.x + 20, y: a.y, used: false, v: 3 })
    run(1, { ...idle(), buttons: BTN_USE })
    expect(a.shrineT).toBeGreaterThan(SHRINE_TICKS - 5)
    expect(b.shrine).toBe(3)
    expect(b.shrineT).toBeGreaterThan(SHRINE_TICKS - 5)
    expect(c.shrineT).toBe(0)
    const ev = s.events.find((e) => e.type === 'shrine')
    expect(ev && ev.type === 'shrine' && ev.to).toBe(0b011)
  })

  it('연속 처치: 2.5초 안에 이어 열 마리째에 금화 더미 · 끊기면 처음부터', () => {
    const { s, run, shoot } = field()
    const p = s.players[0]
    const kill = () => {
      const m = makeMonster(s, 0, p.x + 70, p.y, 900, 0.01, 100, 1)
      s.monsters.push(m)
      s.monstersTotal++
      shoot(m)
    }
    let streaks = 0
    const count = () => (streaks += s.events.filter((e) => e.type === 'streak').length)
    for (let k = 0; k < 9; k++) kill()
    expect(p.ks).toBe(9)
    count()
    expect(streaks).toBe(0)
    const d0 = s.drops.length
    kill()
    expect(p.ks).toBe(10)
    expect(s.events.some((e) => e.type === 'streak' && e.n === 10 && e.p === 0)).toBe(true)
    expect(s.drops.slice(d0).filter((d) => d.owner === 0 && d.gold > 0).length).toBeGreaterThanOrEqual(3)
    run(160)
    kill()
    expect(p.ks).toBe(1)
  })

  it('함정 상자: 보통 상자 일부는 열면 저주받은 상자로 바뀌어 물결 하나 — 다 잡으면 열린다 (보상은 희귀 확정 없음)', () => {
    const { s, run } = field()
    const p = s.players[0]
    let trap = -1
    for (let k = 0; k < 300 && trap < 0; k++) {
      s.objects.push({ id: 100 + k, kind: OBJ_CHEST, x: p.x + 20, y: p.y, used: false, v: 0 })
      run(1, { ...idle(), buttons: BTN_USE })
      if (s.events.some((e) => e.type === 'trap')) trap = 100 + k
      run(1)
    }
    expect(trap).toBeGreaterThan(0)
    const o = s.objects.find((q) => q.id === trap)!
    expect(o.kind).toBe(OBJ_CURSED)
    expect(o.used).toBe(false)
    run(2)
    const pack = s.monsters.filter((m) => m.pack === 7000 + trap && m.hp > 0)
    expect(pack.length).toBe(6)
    expect(pack.filter((m) => m.elite > 0).length).toBe(1)
    const d0 = s.drops.length
    for (const m of pack) m.hp = 0
    run(2)
    expect(o.used).toBe(true)
    expect(o.v).toBe(9)
    expect(o.v).toBeGreaterThan(CURSE_WAVES)
    expect(s.drops.slice(d0).filter((d) => d.owner === 0 && d.item).length).toBe(2)
  })

  it('일으킨 동료 수는 기록에 남는다 (옛 세이브는 0) · 업적이 있다', () => {
    expect(sanitizeStats({ kills: 3 }).revives).toBe(0)
    expect(emptyStats().revives).toBe(0)
    expect(ACHIEVEMENTS.some((a) => a.id === 'revive20')).toBe(true)
  })
})
