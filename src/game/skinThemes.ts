// 밝은 분위기 맵 테마 (2026-10-06 — docs/밝은-분위기-개편-계획.md 4 · 5장). 맵 모양 · 길은 그대로, 색 · 빛만.
// 1막 무궁화 운동장 · 2막 달고나 숲 · 3막 구슬 골목 · 물놀이장 · 4막 불꽃 축제 · 파스텔 계단. 마을은 파스텔 대기실.
// 모두 낮: 해 · 하늘빛을 올리고, 시야 밖은 검정 대신 흐린 파스텔 안개(시야 제한 규칙은 그대로 — visionFog).
// 투기장 맵(studio · yard · garage)은 없다 → 원래 모습.

import type { MapTheme, WorldStyle } from '../core/maps'
import { registerBrightTheme } from './skin'

/** 바닥 · 보조 · 줄 · 벽 · 벽 위 · 상자 · 하늘(맵 밖 · 안개) */
type Pal = [floor: number, floorAlt: number, floorLine: number, wall: number, wallTop: number, crate: number, outside: number]

function theme(style: WorldStyle, p: Pal, town = false): MapTheme {
  const [floor, floorAlt, floorLine, wall, wallTop, crate, outside] = p
  return {
    floor, floorAlt, floorLine, wall, wallTop, crate, outside,
    sunColor: 0xfff3e0,
    ambientColor: 0xe6f2ff,
    fog: outside,
    // 낮 조명 · 시야 밖 안개는 옅게(마을은 더 옅게) · 등불은 거의 끈다(대낮이라)
    dark: { sun: 1.9, hemi: 1.25, fogAlpha: town ? 0.22 : 0.42, lantern: 0.5 },
    visionFog: outside,
    style,
  }
}

const T: Record<string, MapTheme> = {
  // ---- 1막 무궁화 운동장
  town1: theme('town', [0xe9d3a8, 0xe0c89a, 0xc9b083, 0x8fd6c4, 0xb9eadc, 0xf5a3bd, 0xbfe3ff], true), // 1번 대기실
  fields: theme('fields', [0xe6c98f, 0xdcbd82, 0xc7a76d, 0xa8dcc9, 0xcff0e3, 0xf7b0c6, 0xc4e7ff]), // 무궁화 운동장 · 줄넘기 길
  cave: theme('cave', [0xf0d49a, 0xe6c88c, 0xd1b175, 0xffb98a, 0xffd6b3, 0x9fd3ff, 0xc4e7ff]), // 모래 놀이터
  cathedral: theme('cathedral', [0xd9a86c, 0xcf9d62, 0xb88650, 0x9ec2f2, 0xc8dcff, 0xffd56e, 0xd4ecff]), // 체육관
  crypt: theme('crypt', [0xd5c6ee, 0xcbbbe6, 0xb3a2d4, 0xf3a9c3, 0xffcadb, 0x8fd0ff, 0xe3dbff]), // 공 창고
  butchery: theme('butchery', [0xebc98e, 0xe2bd80, 0xcda46a, 0xff9eb6, 0xffc6d4, 0xfff0a0, 0xffe3ec]), // 술래의 마당
  // ---- 2막 달고나 숲
  town2: theme('town', [0xf0d6e6, 0xe8cbdd, 0xd4b3c8, 0xc6a8f0, 0xe0d0ff, 0xfff0a8, 0xffe6f2], true), // 2번 대기실
  forest: theme('forest', [0xb9e3a0, 0xaedb94, 0x96c47d, 0xffb3d6, 0xffcfe4, 0xc9b2ff, 0xffe6f5]), // 솜사탕 숲 · 꽃길
  swamp: theme('forest', [0xcdb8f5, 0xc2acee, 0xa892dc, 0x9fe3c8, 0xc6f2e0, 0xffc2e0, 0xe9e0ff]), // 젤리 늪
  hollow: theme('cave', [0xf2d2a2, 0xe9c693, 0xd2ab78, 0xd9a37a, 0xf0c7a3, 0xff8fa8, 0xffeedd]), // 공룡 굴 · 버섯 과자 동굴
  nest: theme('cave', [0xffe08c, 0xf8d47a, 0xe2bb60, 0xffc04a, 0xffdb8a, 0xfff3c4, 0xfff4d6]), // 벌집 궁전
  // ---- 3막 구슬 골목 · 물놀이장
  town3: theme('town', [0xd8eef7, 0xcbe6f2, 0xb2d4e4, 0x9fd2f0, 0xc9e8fb, 0xffd36e, 0xcfeeff], true), // 3번 대기실
  sewer: theme('crypt', [0xbfe6f7, 0xb2ddf1, 0x96c7e0, 0xffcf6e, 0xffe4a6, 0xff9fb6, 0xcff2ff]), // 미끄럼틀 수로 · 분수 광장
  cistern: theme('cave', [0x8fd4ee, 0x82cbe8, 0x68b4d6, 0xf6e2b8, 0xfff1d6, 0xff8fa8, 0xc8f0ff]), // 파도 풀
  ruins: theme('cathedral', [0xead2b0, 0xe0c6a1, 0xc9ab84, 0xa9dba0, 0xcdeec5, 0xff9f8f, 0xdff3ff]), // 구슬치기 골목
  rite: theme('cathedral', [0xcfeefa, 0xc2e6f6, 0xa6d2e8, 0xcab4ff, 0xe2d6ff, 0xffe58f, 0xe0f4ff]), // 유리 징검다리
  archive: theme('crypt', [0xf2dfc6, 0xe8d3b8, 0xd0b896, 0xa8c9f0, 0xcfe0fb, 0xffc2d4, 0xeaf2ff]),
  wardroom: theme('butchery', [0xffdbe6, 0xf8cfdc, 0xe4b3c3, 0xff8fb0, 0xffbfd1, 0x9fe0cf, 0xffe8ef]), // 반장실
  // ---- 4막 불꽃 축제 · 파스텔 계단
  town4: theme('town', [0xfde0c8, 0xf6d4b8, 0xe2b996, 0xffa98a, 0xffcbb3, 0xc8b2ff, 0xffe9da], true), // 마지막 대기실
  rift: theme('fields', [0xffd9bd, 0xf7ccad, 0xe3b08c, 0xff9f84, 0xffc4b0, 0xffe58f, 0xffe4d6]), // 불꽃놀이 언덕
  ashen: theme('fields', [0xfff0b8, 0xf7e5a6, 0xe3cc85, 0xffb2cf, 0xffd3e2, 0x9fd3ff, 0xfff2dc]), // 폭죽 들판
  pit: theme('cave', [0xc4e6ff, 0xb7ddfa, 0x9cc8ec, 0xffd36e, 0xffe6a8, 0xff8fa8, 0xdff2ff]), // 볼풀 구덩이
  maze: theme('crypt', [0xe6e0fb, 0xdcd5f6, 0xc3bbe8, 0xbfe3ff, 0xe0f2ff, 0xffb6d2, 0xf0ecff]), // 거울 미로
  stair: theme('cathedral', [0xffd8e8, 0xf8cddf, 0xe4b2c8, 0xaee4ff, 0xd2f1ff, 0xfff09f, 0xffeef6]), // 파스텔 계단
  throne: theme('butchery', [0xf3dcb4, 0xebd0a4, 0xd4b585, 0xff9fc2, 0xffc6dc, 0x9fe0cf, 0xffeef4]), // 결승 마당
}

for (const [id, t] of Object.entries(T)) registerBrightTheme(id, t)
