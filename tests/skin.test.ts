// 분위기(스킨 — game/skin.ts, 2026-10-06): 어둡게 · 밝게. 그림 · 글만 바꿔 끼우고 되돌린다 — 판정(타일)은 그대로
import { afterEach, describe, expect, it } from 'vitest'
import { asSkin, bt, registerBrightTheme, registerText, setSkin, skin, skinMap } from '../src/game/skin'
import { ACTS, AREAS, NPC_NAMES, QUESTS, buildAreaMap } from '../src/core/world'
import { BOSS_PATS } from '../src/core/monsters'
import '../src/game/skinText'
import { MapTheme } from '../src/core/maps'
import { BRIGHT_FLOOR } from '../src/render3d/brightFloor'
import { planLandmarks } from '../src/render3d/brightLandmarks'
import { TILE_WALL, buildMap } from '../src/core/map'
import { BRIGHT_WALL } from '../src/render3d/brightWalls'
import '../src/game/skinThemes'

afterEach(() => setSkin('dark'))

describe('분위기', () => {
  it('☀ 랜드마크는 꽉 찬 벽 덩어리(2 × 2 · 3 × 2) 자리 안에만 — 충돌과 겉모습이 맞다 (그래픽 개편 D)', () => {
    for (const area of [1, 6, 11, 14, 22, 25, 29, 30, 33]) {
      const map = buildAreaMap(1, area)
      const marks = planLandmarks(map)
      expect(marks.length, map.id).toBeGreaterThan(0)
      for (const m of marks) {
        expect([4, 6]).toContain(m.tiles.length)
        for (const t of m.tiles) expect(map.tiles[t]).toBe(TILE_WALL)
      }
    }
  })

  it('☀ 보스 방 넷: 둥근 고리 벽의 칸마다 주제 조각 하나 (세 칸마다 장식) · 바깥 테두리는 벽 그대로', () => {
    for (const area of [9, 18, 27, 34]) {
      const map = buildAreaMap(1, area)
      const marks = planLandmarks(map)
      expect(marks.length, map.id).toBe(82)
      for (const m of marks) {
        expect(m.tiles.length).toBe(1)
        expect(map.tiles[m.tiles[0]]).toBe(TILE_WALL)
      }
      expect(new Set(marks.map((m) => m.def)).size, map.id).toBeGreaterThanOrEqual(3)
    }
  })

  it('☀ 투기장 맵 셋도 밝은 테마 · 바닥 · 벽 (주차장 기둥 일부는 주차 탑)', () => {
    setSkin('bright')
    for (const id of ['studio', 'yard', 'garage'] as const) {
      const map = skinMap(buildMap(id, 1, 5))
      expect(map.theme.style, id).toBeTruthy()
      expect(BRIGHT_FLOOR[id], id).toBeTruthy()
      expect(BRIGHT_WALL[id], id).toBeTruthy()
    }
    const marks = planLandmarks(buildMap('garage', 1, 5))
    expect(marks.length).toBeGreaterThan(5)
    for (const m of marks) expect(m.tiles.length).toBe(4)
  })

  it('☀ 쓰이는 지역 맵마다 맵별 바닥이 있다 (그래픽 개편 B — brightFloor)', () => {
    const missing = [...new Set(AREAS.filter((a) => !a.retired).map((a) => a.map))].filter((id) => !BRIGHT_FLOOR[id])
    expect(missing).toEqual([])
  })

  it('모르는 값은 어둡게', () => {
    expect(asSkin('bright')).toBe('bright')
    expect(asSkin('x')).toBe('dark')
    expect(asSkin(undefined)).toBe('dark')
  })

  it('밝게면 맵 테마를 바꿔 끼우고, 어둡게면 원래 테마로 — 타일은 그대로', () => {
    const map = buildAreaMap(11, 1)
    const base = map.theme
    const tiles = map.tiles.slice()
    const bright: MapTheme = { ...base, floor: 0xffeedd, dark: undefined }
    registerBrightTheme(map.id, bright)
    setSkin('bright')
    skinMap(map)
    expect(map.theme).toBe(bright)
    setSkin('dark')
    skinMap(map)
    expect(map.theme).toBe(base)
    expect(Array.from(map.tiles)).toEqual(Array.from(tiles))
  })

  it('글은 밝게에서 바뀌고 어둡게로 돌아온다 (등록이 늦어도)', () => {
    const def = { name: '도살자', lore: '갈고리' }
    registerText(def, 'name', '술래 버섯왕')
    expect(def.name).toBe('도살자')
    setSkin('bright')
    expect(skin()).toBe('bright')
    expect(def.name).toBe('술래 버섯왕')
    registerText(def, 'lore', '무궁화 꽃이 피었습니다')
    expect(def.lore).toBe('무궁화 꽃이 피었습니다')
    setSkin('dark')
    expect(def).toEqual({ name: '도살자', lore: '갈고리' })
  })

  it('밝은 글 (skinText): 막 · 지역 · 우두머리 · 안내원 · 퀘스트 · 즉사기 대사 — 보상 · 목표는 그대로', () => {
    const before = QUESTS.map((q) => [q.reward, q.goal, q.area])
    setSkin('bright')
    expect(ACTS[0].name).toBe('무궁화 운동장')
    expect(AREAS[1].name).toBe('무궁화 운동장')
    expect(AREAS[3].unique?.name).toBe('줄넘기 대장 오스')
    expect(NPC_NAMES.elder).toBe('안내원 모모')
    expect(QUESTS[3].name).toBe('술래 버섯왕')
    expect(BOSS_PATS.find((p) => p.id === 'slaughter')?.line).toBe('무궁화 꽃이… 피었습니다!')
    expect(bt('마을의 촌장 카인에게 보고하라')).toBe('마을의 안내원 모모에게 보고하라')
    expect(bt('심연의 군주가 분노한다')).toBe('파티 드래곤이 분노한다')
    expect(bt('도살자를 쓰러뜨렸습니다')).toBe('술래 버섯왕을 쓰러뜨렸습니다')
    expect(QUESTS.map((q) => [q.reward, q.goal, q.area])).toEqual(before)
    // 모든 퀘스트 · 지역(빠진 것 없이)에 밝은 이름이 있다 — 어두운 낱말이 남지 않게
    for (const q of QUESTS) expect(q.ask).not.toMatch(/종|촌장|시체/)
    setSkin('dark')
    expect(ACTS[0].name).toBe('무너진 성당')
    expect(AREAS[1].name).toBe('핏빛 들판')
    expect(NPC_NAMES.elder).toBe('촌장 카인')
    expect(bt('촌장')).toBe('촌장')
    expect(BOSS_PATS.find((p) => p.id === 'slaughter')?.line).toBe('신선한 고기다…!')
  })
})

// 2026-10-08 방송 검토 9: ☀ 철면수심전용에서 후원 이름에 공포 낱말이 보이지 않게 (치지직 창 안내 글에 "지옥문" 이 박혀 있었다)
describe('밝은 판의 후원 이름', () => {
  it('후원 이벤트의 이름 · 설명에 좀비 · 지옥 · 암흑이 없다 · 어둡게로 돌아오면 원래 이름', async () => {
    const { DONATE_EVENTS } = await import('../src/core/donate')
    const dark = DONATE_EVENTS.map((e) => e.name)
    setSkin('bright')
    for (const e of DONATE_EVENTS) expect(`${e.name} ${e.desc}`).not.toMatch(/좀비|지옥|암흑|피|시체/)
    expect(DONATE_EVENTS.find((e) => e.key === 'horde')!.name).toBe('괴물 떼')
    expect(DONATE_EVENTS.find((e) => e.key === 'hell')!.name).toBe('깜짝 파티')
    setSkin('dark')
    expect(DONATE_EVENTS.map((e) => e.name)).toEqual(dark)
  })
})

// 2026-10-17 완성도 검토: ☀ 에서 업적 배너 · 기록 창 · 아이템 이름표 · 저주받은 상자에 어두운 글이 그대로 나왔다
describe('밝은 판의 업적 · 아이템 · 상자 글', () => {
  it('업적 · 전설 · 세트 이름과 설명에 막 보스 이름 · 피 · 시체가 없다 · 어둡게로 돌아오면 원래 글', async () => {
    const { ACHIEVEMENTS } = await import('../src/core/stats')
    const { LEGENDS, SETS } = await import('../src/core/items')
    const dark = [...ACHIEVEMENTS.map((a) => a.name + a.desc), ...LEGENDS.map((l) => l.name + l.desc), ...SETS.map((s) => s.name + s.tag)]
    setSkin('bright')
    const words = [...ACHIEVEMENTS.map((a) => `${a.name} ${a.desc}`), ...LEGENDS.map((l) => `${l.name} ${l.desc}`), ...SETS.map((s) => `${s.name} ${s.tag}`)]
    for (const w of words) expect(w).not.toMatch(/도살|거미|심연|관리인|고블린|시체|피의|종이 다시/)
    expect(bt('저주받은 상자!')).toBe('깜짝 상자!')
    expect(bt('저주가 풀렸다')).toBe('깜짝 상자 성공')
    setSkin('dark')
    expect([...ACHIEVEMENTS.map((a) => a.name + a.desc), ...LEGENDS.map((l) => l.name + l.desc), ...SETS.map((s) => s.name + s.tag)]).toEqual(dark)
  })
})
