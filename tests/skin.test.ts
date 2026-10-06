// 분위기(스킨 — game/skin.ts, 2026-10-06): 어둡게 · 밝게. 그림 · 글만 바꿔 끼우고 되돌린다 — 판정(타일)은 그대로
import { afterEach, describe, expect, it } from 'vitest'
import { asSkin, registerBrightTheme, registerText, setSkin, skin, skinMap } from '../src/game/skin'
import { buildAreaMap } from '../src/core/world'
import { MapTheme } from '../src/core/maps'

afterEach(() => setSkin('dark'))

describe('분위기', () => {
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
})
