// 밝은 분위기 화면 글 (2026-10-06 — docs/밝은-분위기-개편-계획.md 2 · 3 · 4 · 6장).
// 정의표(MONSTER_LIST · AREAS · QUESTS …)의 이름 · 글을 "밝게" 일 때 이 글로 갈아 끼운다(game/skin.ts registerText).
// sim 은 이 글을 읽지 않는다 — 판정은 두 분위기에서 같다. 어둡게로 돌아가면 원래 글.

import { MONSTER_LIST } from '../core/monsters'
import { registerText } from './skin'

// ---- 괴물 (행동은 그대로 · 이름 · 모습만) ----
const MONSTER_NAMES: Record<string, string> = {
  ghoul: '말랑 슬라임',
  archer: '가시 선인장',
  bloater: '빵빵 복어',
  butcher: '술래 버섯왕',
  goblin: '보물 토끼',
  wolf: '꼬마 공룡',
  spider: '꿀벌',
  shaman: '치유 버섯',
  queen: '여왕벌',
  shield: '분홍 진행요원',
  necro: '꼬마 마법사',
  spitter: '먹물 오징어',
  warden: '진행요원 반장',
  shade: '장난꾸러기 유령',
  demon: '폭죽 꼬마 도깨비',
  lord: '파티 드래곤',
}
for (const def of MONSTER_LIST) {
  const n = MONSTER_NAMES[def.id]
  if (n) registerText(def, 'name', n)
}
