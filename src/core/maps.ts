// 맵 레지스트리. 맵을 추가하려면 MAPS 에 항목 하나를 넣으면 로비·프리뷰·네트워크가 자동으로 인식한다.
// rows 는 **크기와 테두리**만 정한다. 안쪽 구조물은 map.ts 가 매 판 시드로 생성한다(gen).

export type MapId = 'studio' | 'yard' | 'garage' | 'crypt' | 'town1' | 'fields' | 'cave' | 'cathedral' | 'butchery' | 'town2' | 'forest' | 'swamp' | 'hollow' | 'nest'

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
  /**
   * 어두운 던전 조명 (없으면 덕의 밝은 낮). sun·hemi = 해·하늘빛 세기, fogAlpha = 시야 밖 어둠의 진하기,
   * lantern = 플레이어마다 드는 등불 세기 (디아블로의 '빛 반경' — 시야 제한과 겹쳐 분위기를 만든다)
   */
  dark?: { sun: number; hemi: number; fogAlpha: number; lantern: number }
  /**
   * 3D 모습 (render3d/world3d.ts): 돌벽·바위·목책/천막, 장애물·소품·횃불의 종류. 없으면 덕의 상자 모습(투기장 맵)
   */
  style?: WorldStyle
}

export type WorldStyle = 'crypt' | 'cathedral' | 'butchery' | 'fields' | 'cave' | 'town' | 'forest'

/**
 * 안쪽 구조물 생성 규칙.
 * - rooms: 영역을 재귀로 갈라 방과 문을 만든다 (실내, 통로 싸움)
 * - scatter: 벽 덩어리와 상자를 흩뿌린다 (야외, 트인 시야)
 * - pillars: 기둥을 격자로 세운다 (주차장, 일정한 엄폐)
 */
export interface MapGen {
  /** fixed = rows 를 그대로 쓴다 (마을처럼 손으로 짠 곳: '#' 벽 · 'c' 상자 · '.' 바닥) */
  style: 'rooms' | 'scatter' | 'pillars' | 'fixed'
  /** rooms = 분할 깊이 · scatter = 벽 덩어리 수 · pillars = 기둥 간격(타일) */
  density: number
  /** 상자 군집 수 (40x30 기준, 맵이 넓어지면 비례) */
  crates: number
  /** 흩어진 모래주머니 줄 수 (중앙 진지는 항상 별도로 생긴다) */
  sandbags: number
  /** scatter 벽 덩어리 최대 길이 */
  maxLen: number
  /** 중앙 모래주머니 진지 (기본 true). 던전에는 없다 */
  forts?: boolean
}

export interface MapDef {
  id: MapId
  name: string
  desc: string
  /** 크기·테두리 전용 (안쪽은 생성된다) */
  rows: string[]
  /** 인원과 상관없이 이 크기 그대로 (던전 층은 거울로 늘리지 않는다 — 대칭이면 던전 같지 않다) */
  fixedScale?: boolean
  /** 모닥불 자리 (2×2 장애물의 왼쪽 위 타일) — 마을 */
  fire?: [number, number]
  gen: MapGen
  theme: MapTheme
}

/**
 * 1막 마을 "순례자 야영지" (46×34, 손으로 짠 배치). 목책 안에 천막(벽)·수레(상자)·가운데 모닥불.
 * 동쪽 목책 가운데가 성문 — 거기로 걸어 나가면 핏빛 들판(world.ts 의 TOWNS 에 자리 좌표가 있다)
 */
function town1Rows(): string[] {
  const W = 46
  const H = 34
  const g: string[][] = []
  for (let y = 0; y < H; y++) g.push(Array.from({ length: W }, (_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1 ? '#' : '.')))
  const box = (x0: number, y0: number, w: number, h: number, ch: string) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g[y][x] = ch
  }
  // 목책 안쪽 모서리를 조금 막아 둥근 야영지처럼
  box(1, 1, 3, 3, '#')
  box(W - 4, 1, 3, 3, '#')
  box(1, H - 4, 3, 3, '#')
  box(W - 4, H - 4, 3, 3, '#')
  // 천막 (4×3) — 상인 · 대장장이 · 도박꾼 · 촌장 · 용병 대장 자리 곁
  box(8, 5, 4, 3, '#')
  box(20, 4, 5, 3, '#')
  box(32, 5, 4, 3, '#')
  box(8, 25, 4, 3, '#')
  box(32, 25, 5, 3, '#')
  // 수레 · 짐 더미
  box(15, 8, 2, 1, 'c')
  box(28, 9, 1, 2, 'c')
  box(14, 24, 2, 1, 'c')
  box(27, 26, 2, 1, 'c')
  box(39, 11, 1, 2, 'c')
  box(39, 21, 1, 2, 'c')
  // 모닥불 (2×2)
  box(22, 16, 2, 2, 'c')
  return g.map((r) => r.join(''))
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
  crypt: {
    id: 'crypt',
    name: '지하 묘지',
    desc: '무너진 성당 아래. 방과 복도마다 굶주린 것들이 잠들어 있다.',
    rows: frame(72, 54),
    fixedScale: true,
    gen: { style: 'rooms', density: 7, crates: 10, sandbags: 0, maxLen: 5, forts: false },
    theme: {
      // 젖은 돌바닥 · 이끼 낀 벽 · 달빛 같은 푸른 기운. 따뜻한 빛은 플레이어의 등불뿐
      floor: 0x3a3631, floorAlt: 0x34302b, floorLine: 0x292622,
      // crate = 돌 관·무너진 돌무더기 (갈색 나무 상자는 어둠 속에서 새까만 덩어리로 보였다)
      wall: 0x4b463f, wallTop: 0x5d574e, crate: 0x77706a, outside: 0x040405,
      sunColor: 0x8aa0c8, ambientColor: 0x4a4868, fog: 0x050507,
      dark: { sun: 0.55, hemi: 0.5, fogAlpha: 0.9, lantern: 2.6 },
      style: 'crypt',
    },
  },
  // ---------------- 1막 무너진 성당 (GUIDE 5.1) ----------------
  town1: {
    id: 'town1',
    name: '순례자 야영지',
    desc: '성당 아래에서 도망쳐 나온 사람들의 야영지. 모닥불만이 밤을 버틴다.',
    rows: town1Rows(),
    fixedScale: true,
    fire: [22, 16],
    gen: { style: 'fixed', density: 0, crates: 0, sandbags: 0, maxLen: 0, forts: false },
    theme: {
      floor: 0x3b352c, floorAlt: 0x363027, floorLine: 0x2b2620,
      wall: 0x4a3a2a, wallTop: 0x6a5238, crate: 0x6e5236, outside: 0x040403,
      sunColor: 0x8aa0c8, ambientColor: 0x4a4458, fog: 0x050505,
      dark: { sun: 1.1, hemi: 0.95, fogAlpha: 0.8, lantern: 2.8 },
      style: 'town',
    },
  },
  fields: {
    id: 'fields',
    name: '핏빛 들판',
    desc: '야영지 밖 들판. 마른 풀과 무너진 돌담 사이로 시체들이 떼 지어 떠돈다.',
    rows: frame(72, 54),
    fixedScale: true,
    // 흩어진 돌담·바위 (트인 시야 — 무리가 멀리서 몰려온다)
    gen: { style: 'scatter', density: 9, crates: 9, sandbags: 0, maxLen: 5, forts: false },
    theme: {
      floor: 0x3a3428, floorAlt: 0x353024, floorLine: 0x2a261d,
      wall: 0x49443c, wallTop: 0x5b554b, crate: 0x5a534a, outside: 0x030303,
      sunColor: 0x9aa8c8, ambientColor: 0x464a5a, fog: 0x050506,
      dark: { sun: 1.0, hemi: 0.85, fogAlpha: 0.86, lantern: 2.6 },
      style: 'fields',
    },
  },
  cave: {
    id: 'cave',
    name: '굶주린 굴',
    desc: '들판 옆 바위굴. 좁고 굽은 굴마다 굶주린 것들이 웅크리고 있다.',
    rows: frame(52, 40),
    fixedScale: true,
    gen: { style: 'rooms', density: 5, crates: 8, sandbags: 0, maxLen: 4, forts: false },
    theme: {
      floor: 0x3a3026, floorAlt: 0x342b22, floorLine: 0x2a221b,
      wall: 0x4a3b2c, wallTop: 0x5c4a38, crate: 0x6a5a48, outside: 0x030202,
      sunColor: 0x8a90a8, ambientColor: 0x4a3e38, fog: 0x050403,
      dark: { sun: 0.5, hemi: 0.45, fogAlpha: 0.92, lantern: 2.6 },
      style: 'cave',
    },
  },
  cathedral: {
    id: 'cathedral',
    name: '무너진 성당',
    desc: '종이 멈춘 성당. 줄지은 기둥 사이로 해골 궁수들이 겨눈다.',
    rows: frame(64, 46),
    fixedScale: true,
    gen: { style: 'pillars', density: 5, crates: 8, sandbags: 0, maxLen: 4, forts: false },
    theme: {
      floor: 0x3c3a40, floorAlt: 0x37353a, floorLine: 0x2c2a30,
      wall: 0x4e4a55, wallTop: 0x625d6a, crate: 0x6b6470, outside: 0x040405,
      sunColor: 0x9aa0d0, ambientColor: 0x4a4868, fog: 0x050507,
      dark: { sun: 0.55, hemi: 0.5, fogAlpha: 0.9, lantern: 2.6 },
      style: 'cathedral',
    },
  },
  butchery: {
    id: 'butchery',
    name: '도살장',
    desc: '피 냄새가 가장 짙은 곳. 갈고리에 걸린 것들 사이로 무언가 칼을 간다.',
    rows: frame(44, 34),
    fixedScale: true,
    gen: { style: 'rooms', density: 3, crates: 6, sandbags: 0, maxLen: 4, forts: false },
    theme: {
      floor: 0x3a2c28, floorAlt: 0x352824, floorLine: 0x2a1e1b,
      wall: 0x4b3530, wallTop: 0x5e433c, crate: 0x6a4a40, outside: 0x040202,
      sunColor: 0xa08880, ambientColor: 0x503838, fog: 0x060303,
      dark: { sun: 0.5, hemi: 0.45, fogAlpha: 0.92, lantern: 2.6 },
      style: 'butchery',
    },
  },
  // ---------------- 2막 안개 숲 ----------------
  town2: {
    id: 'town2',
    name: '숲 가장자리 야영지',
    desc: '안개 숲 어귀의 사냥꾼 야영지. 늑대 울음이 밤새 목책을 두드린다.',
    rows: town1Rows(),
    fixedScale: true,
    fire: [22, 16],
    gen: { style: 'fixed', density: 0, crates: 0, sandbags: 0, maxLen: 0, forts: false },
    theme: {
      floor: 0x2f3526, floorAlt: 0x2a3022, floorLine: 0x22281c,
      wall: 0x3e3424, wallTop: 0x5a4a30, crate: 0x5e4a30, outside: 0x020403,
      sunColor: 0x8ab0b0, ambientColor: 0x3e5048, fog: 0x030504,
      dark: { sun: 1.0, hemi: 0.9, fogAlpha: 0.8, lantern: 2.8 },
      style: 'town',
    },
  },
  forest: {
    id: 'forest',
    name: '안개 숲',
    desc: '빽빽한 전나무 사이로 길이 갈라지고, 안개 너머에서 무언가 따라온다.',
    rows: frame(72, 54),
    fixedScale: true,
    gen: { style: 'scatter', density: 14, crates: 8, sandbags: 0, maxLen: 5, forts: false },
    theme: {
      floor: 0x3a4430, floorAlt: 0x353f2c, floorLine: 0x283222,
      wall: 0x2a3a26, wallTop: 0x2a3a24, crate: 0x5e6458, outside: 0x020403,
      sunColor: 0xa8c4d8, ambientColor: 0x506a60, fog: 0x040705,
      dark: { sun: 1.15, hemi: 1.0, fogAlpha: 0.84, lantern: 2.6 },
      style: 'forest',
    },
  },
  swamp: {
    id: 'swamp',
    name: '포자 늪',
    desc: '사람 키만 한 버섯이 늪을 덮었다. 포자가 안개처럼 떠다닌다.',
    rows: frame(64, 48),
    fixedScale: true,
    gen: { style: 'scatter', density: 9, crates: 12, sandbags: 0, maxLen: 4, forts: false },
    theme: {
      floor: 0x33402e, floorAlt: 0x3a4834, floorLine: 0x263022,
      wall: 0x2e3e2a, wallTop: 0x34462c, crate: 0x7a6a8a, outside: 0x020302,
      sunColor: 0xa8d0b4, ambientColor: 0x4a6a58, fog: 0x030604,
      dark: { sun: 1.05, hemi: 0.95, fogAlpha: 0.85, lantern: 2.6 },
      style: 'forest',
    },
  },
  hollow: {
    id: 'hollow',
    name: '버섯 동굴',
    desc: '뿌리가 천장을 뚫고 내려온 굴. 빛나는 버섯이 길을 밝힌다.',
    rows: frame(60, 44),
    fixedScale: true,
    gen: { style: 'rooms', density: 6, crates: 8, sandbags: 0, maxLen: 4, forts: false },
    theme: {
      floor: 0x2e2a26, floorAlt: 0x2a2622, floorLine: 0x201c18,
      wall: 0x3a3428, wallTop: 0x4a4434, crate: 0x5a4a6a, outside: 0x020202,
      sunColor: 0x8aa8a0, ambientColor: 0x3a4a44, fog: 0x040504,
      dark: { sun: 0.5, hemi: 0.5, fogAlpha: 0.92, lantern: 2.6 },
      style: 'cave',
    },
  },
  nest: {
    id: 'nest',
    name: '거미 둥지',
    desc: '숲의 심장은 거미줄로 덮여 있다. 알을 품은 여왕이 실을 당기며 기다린다.',
    rows: frame(48, 38),
    fixedScale: true,
    gen: { style: 'rooms', density: 3, crates: 6, sandbags: 0, maxLen: 4, forts: false },
    theme: {
      floor: 0x2a2a2a, floorAlt: 0x262626, floorLine: 0x1c1c1c,
      wall: 0x3a3a38, wallTop: 0x4e4e4a, crate: 0xc8c8c0, outside: 0x020202,
      sunColor: 0xa8a8c0, ambientColor: 0x44444e, fog: 0x040404,
      dark: { sun: 0.5, hemi: 0.5, fogAlpha: 0.92, lantern: 2.6 },
      style: 'cave',
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
/** 던전 층 (M1 은 지하 묘지 하나). 덕의 맵 셋은 생성기 시험용으로 남겨 둔다 */
export const DEFAULT_MAP: MapId = 'crypt'

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
