// 봇 자리의 캐릭터 기록 (2026-09-20 사용자: "봇은 1레벨에 아이템 없을 때부터 시작인가?
// 방장의 레벨과 템 수준에 맞게 봇도 생성되게 해 줘 — 안 그러면 하다가 중간에 끄고 다시 할 때 봇들이 너무 약해").
//
// 전에는 `{ ...emptySheet(), level }` 이라 **레벨만** 방장과 같고 장비 · 스킬 · 능력치는 맨몸이었다.
// 이제 그 레벨짜리 한 벌을 굴려 입히고, 스킬 트리와 능력치도 레벨만큼 찍는다 (계측 도구 tools/campaign.ts 와 같은 방식).
//
// **모두의 계산이 같아야 한다**(락스텝): 방 시드 · 방장 레벨 · 자리 번호로만 정한다 — 내 세이브를 섞지 않는다.

import { ATTR_REC, CHARACTERS, CharacterId } from './characters'
import { Item, SLOT_COUNT, Sheet, attrFree, emptySheet, rollItem } from './items'
import { makeRng } from './rng'
import { MAX_RANK, ULT_NODE, defaultBuild, freePoints } from './skills'

/** 그 레벨짜리 한 벌 (마법 등급 이상 — 사람도 이쯤이면 주워 갈아입는다) */
function gear(char: CharacterId, level: number, seed: number): (Item | null)[] {
  const rng = makeRng(seed * 131 + level * 7)
  const out: (Item | null)[] = []
  for (let slot = 0; slot < SLOT_COUNT; slot++) out.push(rollItem(rng, 900000 + slot, level, CHARACTERS[char].weapon, 'elite', 0, 1, slot))
  return out
}

/** 스킬 포인트: 칸 스킬 · 궁극기 · 트리 스킬 · 패시브 차례로 한 점씩 */
function build(level: number, bonus: number): Sheet['build'] {
  const b = defaultBuild()
  const order = [0, 1, ULT_NODE, 2, 3, 6, 7, 8, 9]
  for (const n of [2, 3]) if (b.r[n] === 0) b.r[n] = 1
  let k = 0
  let guard = 0
  while (freePoints(level, b, bonus) > 0 && guard++ < 500) {
    const n = order[k++ % order.length]
    if (b.r[n] < MAX_RANK) b.r[n]++
  }
  return b
}

/** 능력치: 캐릭터 추천대로 6:4 (사람이 C 창에서 "추천대로" 를 누른 셈 — sim.ts autoAttr 과 같다) */
function attrOf(char: CharacterId, level: number): number[] {
  const [a, b] = ATTR_REC[char]
  const out = [0, 0, 0, 0]
  for (let n = attrFree(level, out); n > 0; n--) {
    if (out[a] * 4 <= out[b] * 6) out[a]++
    else out[b]++
  }
  return out
}

/**
 * 방장의 **템 수준** — 낀 것들의 평균 아이템 레벨. 세 칸도 안 끼고 있으면 그냥 레벨로 본다.
 * (레벨만 보면 "장비를 갈아입지 않은 방장" 곁에 봇만 좋은 걸 입고 서 있게 된다)
 */
export function gearLevelOf(s: { level: number; equip: (Item | null)[] } | undefined): number {
  if (!s) return 1
  const on = (s.equip ?? []).filter((e): e is Item => !!e)
  if (on.length < 3) return Math.max(1, Math.floor(s.level))
  return Math.max(1, Math.round(on.reduce((a, e) => a + e.ilvl, 0) / on.length))
}

/**
 * 봇 한 명의 기록. level · ilvl · quests · questBonus 는 **방장**의 것을 쓴다 — 모두가 같은 값을 넣어야 판이 어긋나지 않는다.
 * seed 는 방 시드에 자리 번호를 섞은 값 (자리마다 다른 한 벌).
 */
export function botSheet(char: CharacterId, level: number, ilvl: number, seed: number, quests: number[] = [], questBonus = 0): Sheet {
  const lv = Math.max(1, Math.floor(level))
  return { ...emptySheet(), level: lv, equip: gear(char, Math.max(1, Math.floor(ilvl)), seed), build: build(lv, questBonus), attr: attrOf(char, lv), quests: [...quests] }
}
