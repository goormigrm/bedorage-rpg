// 사용자가 고른 개선 1단계 (2026-09-25): 도박 천장 · 상인 진열의 전설 · 소리 크기 · 세이브 백업 알림
import { describe, expect, it } from 'vitest'
import { BTN_USE, CMD_GAMBLE, Input } from '../src/core/input'
import { GameMap } from '../src/core/map'
import { buildAreaMap, townNpcs } from '../src/core/world'
import { createState, step } from '../src/core/sim'
import { GAMBLE_PITY, buyPrice, emptySheet, itemValue, rollItem, sanitizeSheet } from '../src/core/items'
import { makeRng } from '../src/core/rng'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

function town(seed = 17) {
  const maps = new Map<number, GameMap>()
  const mapOf = (id: number): GameMap => {
    let m = maps.get(id)
    if (!m) {
      m = buildAreaMap(seed, id)
      maps.set(id, m)
    }
    return m
  }
  const s = createState({ seed, chars: ['chim'] }, mapOf)
  for (let t = 0; t < 3; t++) step(s, mapOf, [idle()])
  const p = s.players[0]
  const g = townNpcs(p.area).find((x) => x.id === 'gambler')!
  const gamble = (arg: number) => {
    p.x = g.x + 10
    p.y = g.y + 10
    p.btnPrev = 0
    step(s, mapOf, [{ ...idle(), buttons: BTN_USE, cmd: CMD_GAMBLE, arg }])
  }
  return { s, p, gamble }
}

describe('도박 천장', () => {
  it(`전설 없이 ${GAMBLE_PITY}번이면 다음은 전설 이상 · 나오면 0 부터`, () => {
    const { p, gamble } = town()
    p.gold = 1e7
    p.gpity = GAMBLE_PITY
    gamble(1)
    const it = p.bag[p.bag.length - 1]
    expect(it.rarity).toBeGreaterThanOrEqual(3)
    expect(p.gpity).toBe(0)
  })
  it('전설이 아니면 하나씩 센다', () => {
    const { p, gamble } = town(23)
    p.gold = 1e7
    p.gpity = 0
    for (let k = 0; k < 20; k++) {
      const before = p.gpity
      p.bag.length = 0
      gamble(2)
      const it = p.bag[p.bag.length - 1]
      expect(p.gpity).toBe(it.rarity >= 3 ? 0 : before + 1)
    }
  })
  it('세이브에 남는다', () => {
    expect(sanitizeSheet({ ...emptySheet(), gpity: 12 }).gpity).toBe(12)
    expect(sanitizeSheet({ ...emptySheet(), gpity: 999 }).gpity).toBe(GAMBLE_PITY)
  })
})

describe('상인 진열의 전설', () => {
  it('드물게 전설이 깔리고 값은 두 배', () => {
    const rng = makeRng(5)
    let legend = 0
    const N = 4000
    for (let i = 0; i < N; i++) {
      const it = rollItem(rng, i, 20, 'rapier', 'shop', 0, 1)
      if (it.rarity >= 3) {
        legend++
        expect(buyPrice(it)).toBe(itemValue(it) * 8)
      } else expect(buyPrice(it)).toBe(itemValue(it) * 4)
      expect(it.rarity).toBeLessThan(4)
    }
    // 한 칸 약 2.4%
    expect(legend / N).toBeGreaterThan(0.012)
    expect(legend / N).toBeLessThan(0.04)
  })
})

describe('소리 크기 · 백업 알림', () => {
  // 브라우저 저장소 흉내
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  }
  it('크기는 0~1 로 자르고 바뀌면 알린다', async () => {
    const vol = await import('../src/audio/volume')
    let n = 0
    const off = vol.onVolume(() => n++)
    vol.setVolume('mon', 1.7)
    expect(vol.volumes().mon).toBe(1)
    vol.setVolume('bgm', -1)
    expect(vol.volumes().bgm).toBe(0)
    vol.setVolume('sfx', 0.35)
    expect(vol.volumes().sfx).toBeCloseTo(0.35)
    expect(n).toBe(3)
    off()
    vol.setVolume('sfx', 0.5)
    expect(n).toBe(3)
    expect(JSON.parse(mem.get('brpg.vol')!).sfx).toBe(0.5)
  })
  it('5레벨 넘게 키웠는데 내보낸 적이 없거나 7일이 지나면 알린다', async () => {
    const save = await import('../src/game/save')
    mem.set('brpg.save.v1', JSON.stringify({ v: 1, chars: { chim: { ...emptySheet(), level: 3 } }, updated: 1 }))
    expect(save.backupNag()).toBeNull()
    mem.set('brpg.save.v1', JSON.stringify({ v: 1, chars: { chim: { ...emptySheet(), level: 12 } }, updated: 1 }))
    expect(save.backupNag()).toContain('파일로 받아 두세요')
    const now = 1_800_000_000_000
    mem.set('brpg.save.exported', String(now - 2 * 86400000))
    expect(save.backupNag(now)).toBeNull()
    mem.set('brpg.save.exported', String(now - 9 * 86400000))
    expect(save.backupNag(now)).toContain('9일')
  })
})
