// 보스 배경음 (2026-09-19 M7): 보는 지역에 깨어 있는 막 보스가 있으면 던전 배경음이 보스 곡으로 바뀐다.
// 소리는 브라우저에서만 나므로, 여기서는 "언제 보스 곡인가" 판정만 본다 (Web Audio 는 만들지 않는다).
import { beforeAll, describe, expect, it } from 'vitest'
import { MONSTER_LIST } from '../src/core/monsters'
import type { GameState } from '../src/core/state'

type SfxLike = { onEvents: (e: unknown[], s: GameState, lp: number) => void }

let Sfx: new () => SfxLike
beforeAll(async () => {
  // Sfx 는 만들 때 window 에 소리 풀기 손잡이를 단다 — 시험에서는 빈 창으로
  ;(globalThis as unknown as { window: unknown }).window ??= { addEventListener() {}, removeEventListener() {} }
  Sfx = (await import('../src/audio/sfx')).Sfx as unknown as new () => SfxLike
})

const BOSS = MONSTER_LIST.findIndex((d) => d.boss)
const GHOUL = 0

function state(monsters: { kind: number; hp: number; maxHp: number; st: number }[], mode = 'dungeon'): GameState {
  return { mode, phase: 'playing', phaseTimer: 0, players: [], monsters } as unknown as GameState
}

const bossOf = (sfx: SfxLike) => (sfx as unknown as { boss: number }).boss

describe('보스 배경음 판정', () => {
  it('깨어 있는 막 보스가 있으면 보스 곡, 체력 30% 아래면 성남', () => {
    const sfx = new Sfx()
    sfx.onEvents([], state([{ kind: GHOUL, hp: 10, maxHp: 10, st: 1 }]), 0)
    expect(bossOf(sfx)).toBe(0)
    sfx.onEvents([], state([{ kind: BOSS, hp: 900, maxHp: 1000, st: 1 }]), 0)
    expect(bossOf(sfx)).toBe(1)
    sfx.onEvents([], state([{ kind: BOSS, hp: 250, maxHp: 1000, st: 1 }]), 0)
    expect(bossOf(sfx)).toBe(2)
  })

  it('잠든 보스 · 쓰러진 보스 · 투기장은 아니다', () => {
    const sfx = new Sfx()
    sfx.onEvents([], state([{ kind: BOSS, hp: 1000, maxHp: 1000, st: 0 }]), 0)
    expect(bossOf(sfx)).toBe(0)
    sfx.onEvents([], state([{ kind: BOSS, hp: 900, maxHp: 1000, st: 1 }]), 0)
    expect(bossOf(sfx)).toBe(1)
    // 쓰러뜨리면 던전 곡으로 (소리가 준비되지 않았으니 승리음은 건너뛴다 — 에러 없이)
    sfx.onEvents([{ type: 'mdeath', m: 1, kind: BOSS, by: 0, x: 0, y: 0, aim: 0 }], state([{ kind: BOSS, hp: 0, maxHp: 1000, st: 1 }]), 0)
    expect(bossOf(sfx)).toBe(0)
    sfx.onEvents([], state([{ kind: BOSS, hp: 900, maxHp: 1000, st: 1 }], 'arena'), 0)
    expect(bossOf(sfx)).toBe(0)
  })
})
