// 봇은 쓰러진 사람(유저) 캐릭터를 싸움보다 먼저 일으킨다 (2026-10-17 사용자)
import { describe, expect, it } from 'vitest'
import { botInput, makeBot } from '../src/core/bot'
import { Input } from '../src/core/input'
import { TILE, TILE_FLOOR, walkField } from '../src/core/map'
import { createState, step } from '../src/core/sim'
import { MS_CHASE } from '../src/core/state'
import { buildAreaMap } from '../src/core/world'

const idle = (): Input => ({ mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 })

describe('봇의 부활 우선', () => {
  it('곁에 싸우는 괴물이 있어도 · 12칸보다 멀어도, 쓰러진 사람에게 달려가 일으킨다', () => {
    const area = 1
    const map = buildAreaMap(3, area)
    const s = createState({ area, seed: 3, chars: ['chim', 'dangun'], follow: [-1, 0] }, () => map)
    const [me, bot] = s.players
    // 봇 자리에서 걸어서 15 ~ 20칸 떨어진 바닥에 사람을 눕힌다
    const from = Math.floor(bot.y / TILE) * map.w + Math.floor(bot.x / TILE)
    const field = walkField(map, from)
    let far = -1
    for (let i = 0; i < field.length; i++) if (map.tiles[i] === TILE_FLOOR && field[i] >= 15 && field[i] <= 20) { far = i; break }
    expect(far).toBeGreaterThanOrEqual(0)
    me.x = ((far % map.w) + 0.5) * TILE
    me.y = (Math.floor(far / map.w) + 0.5) * TILE
    me.downed = true
    me.downTimer = 100000
    // 봇 곁에 깨어 있는 괴물 하나 (나머지는 치운다)
    const m = s.monsters.find((q) => q.hp > 0)!
    for (const q of s.monsters) if (q !== m) q.hp = 0
    m.x = bot.x + 60
    m.y = bot.y
    m.st = MS_CHASE
    m.maxHp = m.hp = 1e7
    const mem = makeBot(5)
    let t = 0
    for (; t < 60 * 20 && me.downed; t++) {
      bot.hp = bot.maxHp
      bot.invuln = 99
      step(s, () => map, [idle(), botInput(s, map, 1, mem, 'normal')])
    }
    expect(me.downed).toBe(false)
    expect(me.alive).toBe(true)
  })
})
