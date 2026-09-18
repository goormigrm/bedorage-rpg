// 맵 레지스트리. 맵을 추가하려면 MAPS 에 항목 하나를 넣으면 로비·프리뷰·네트워크가 자동으로 인식한다.
// rows 는 **크기와 테두리**만 정한다. 안쪽 구조물은 map.ts 가 매 판 시드로 생성한다(gen).

export type MapId = 'studio' | 'yard' | 'garage'

export interface MapTheme {
  /** 바닥 기본/보조 색 */
  floor: number
  floorAlt: number
  floorLine: number
  /** 벽 옆면/윗면 색 */
  wall: number
  wallTop: number
  /** 낮은 상자 색 */
  crate: number
  /** 배경(맵 밖) */
  outside: number
  /** 조명 색 (3D) */
  sunColor: number
  ambientColor: number
  /** 안개 색 (3D) */
  fog: number
}

/**
 * 안쪽 구조물 생성 규칙.
 * - rooms: 영역을 재귀로 갈라 방과 문을 만든다 (실내, 통로 싸움)
 * - scatter: 벽 덩어리와 상자를 흩뿌린다 (야외, 트인 시야)
 * - pillars: 기둥을 격자로 세운다 (주차장, 일정한 엄폐)
 */
export interface MapGen {
  style: 'rooms' | 'scatter' | 'pillars'
  /** rooms = 분할 깊이 · scatter = 벽 덩어리 수 · pillars = 기둥 간격(타일) */
  density: number
  /** 상자 군집 수 (40x30 기준, 맵이 넓어지면 비례) */
  crates: number
  /** 흩어진 모래주머니 줄 수 (중앙 진지는 항상 별도로 생긴다) */
  sandbags: number
  /** scatter 벽 덩어리 최대 길이 */
  maxLen: number
}

export interface MapDef {
  id: MapId
  name: string
  desc: string
  /** 크기·테두리 전용 (안쪽은 생성된다) */
  rows: string[]
  gen: MapGen
  theme: MapTheme
}

/** 테두리만 있는 빈 격자 (크기 정의용) */
function frame(w: number, h: number): string[] {
  const rows: string[] = []
  for (let y = 0; y < h; y++) {
    rows.push(y === 0 || y === h - 1 ? '#'.repeat(w) : `#${'.'.repeat(w - 2)}#`)
  }
  return rows
}

export const MAPS: Record<MapId, MapDef> = {
  studio: {
    id: 'studio',
    name: '스튜디오',
    desc: '실내. 방과 복도로 갈려 있어 문 앞 싸움이 잦다.',
    rows: frame(40, 30),
    gen: { style: 'rooms', density: 4, crates: 8, sandbags: 1, maxLen: 6 },
    theme: {
      floor: 0xd8d3bf, floorAlt: 0xd1cbb6, floorLine: 0xc4bda6,
      wall: 0x5c6347, wallTop: 0x7a8360, crate: 0x8c6a3e, outside: 0x1c1f17,
      sunColor: 0xfff2d6, ambientColor: 0x9aa48c, fog: 0x2a2e24,
    },
  },
  yard: {
    id: 'yard',
    name: '마당',
    desc: '야외. 벽이 적고 상자·모래주머니로 엄폐한다. 시야가 트여 저격이 강하다.',
    rows: frame(40, 30),
    gen: { style: 'scatter', density: 7, crates: 14, sandbags: 2, maxLen: 5 },
    theme: {
      floor: 0x9fb26a, floorAlt: 0x93a660, floorLine: 0x86985a,
      wall: 0x6e6a60, wallTop: 0x8d887b, crate: 0xa87b45, outside: 0x1b2418,
      sunColor: 0xfff7e0, ambientColor: 0x8fb0c8, fog: 0x2c3a2a,
    },
  },
  garage: {
    id: 'garage',
    name: '주차장',
    desc: '지하 주차장. 기둥이 줄지어 서 있어 숨었다 나오는 싸움이 된다.',
    rows: frame(44, 28),
    gen: { style: 'pillars', density: 5, crates: 10, sandbags: 2, maxLen: 4 },
    theme: {
      floor: 0x8f9298, floorAlt: 0x86898f, floorLine: 0x74777d,
      wall: 0x4a4d54, wallTop: 0x63666d, crate: 0x8a6a3c, outside: 0x14161a,
      sunColor: 0xe8eef7, ambientColor: 0x7d8894, fog: 0x1e2126,
    },
  },
}

export const MAP_LIST: MapDef[] = Object.values(MAPS)
export const DEFAULT_MAP: MapId = 'studio'

export function isMapId(s: string): s is MapId {
  return s in MAPS
}

// ---------- 인원별 맵 확장 ----------
// 2명 = 원본, 3명 = 가로 2배(거울), 4명 = 가로·세로 2배(4배). 거울로 붙이므로 어느 쪽에서 시작해도 공평하다.
// 이음새는 테두리 벽을 한 줄 빼고 붙여 열린 통로가 된다.

export type MapScale = 1 | 2 | 4

export function scaleForPlayers(n: number): MapScale {
  // 사람이 많을수록 넓게. 5~6명도 4배를 쓴다(그 이상 배율은 없다)
  return n >= 4 ? 4 : n === 3 ? 2 : 1
}

export function isMapScale(v: number): v is MapScale {
  return v === 1 || v === 2 || v === 4
}

export function expandRows(rows: string[], scale: MapScale): string[] {
  if (scale === 1) return rows
  const mirrorX = (r: string) => {
    const inner = r.slice(0, -1)
    return inner + inner.split('').reverse().join('')
  }
  let out = rows.map(mirrorX)
  if (scale === 4) {
    const top = out.slice(0, -1)
    out = [...top, ...[...top].reverse()]
  }
  return out
}
