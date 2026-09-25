// Three.js 렌더러. sim 상태(prev, curr)를 보간해 그린다. sim 을 절대 바꾸지 않는다.
// 카메라: 고정 피치 55°, 요 45° 고정(camera.ts). HUD 는 2D 캔버스 오버레이. 인원 2~4명.

import * as THREE from 'three'
import { CHARACTERS, headHitScale } from '../core/characters'
import { angleToRad } from '../core/fixedmath'
import { GameMap, SANDBAG_HP, TILE } from '../core/map'
import { Ally, DASH_TICKS, GameState, MS_CHASE, MS_WINDUP, OBJ_CHEST, OBJ_GOLDCHEST, OBJ_SHRINE, OBJ_URN, SHRINE_NAMES, PLAYER_RADIUS, Monster, PlayerState, REVIVE_TICKS, SimEvent, ZONE_ACID, ZONE_FUSE, ZONE_TRAP, ZONE_VORTEX, ZONE_WARN, ZS_CIRCLE, ZS_CONE, ZS_LINE, ZS_RING, Zone, isEnemy, isTeamMatch } from '../core/state'
import { FX_CRIT, FX_GUARD, FX_PARTYDR, FX_RATE, FX_SNIPE, FX_WHIRL, SkillId, skillShout } from '../core/skills'
import { ACID, BOSS_PATS, EA_UNIQUE, LORD, MONSTER_LIST, MonsterDef, PAT, QUEEN, affixNames, bodyR, isBossLike, isGiant } from '../core/monsters'

/** 팔 묶음의 제자리 높이 (내려치기에서 잠깐 올렸다가 되돌린다) */
function armsBaseY(rig: { arms: THREE.Object3D }): number {
  const d = rig.arms.userData as { baseY?: number }
  d.baseY ??= rig.arms.position.y
  return d.baseY
}

/** 보스 등장 배너의 한 줄 (막 보스 넷) */
const BOSS_INTRO: Record<string, string> = {
  butcher: '성당 지하의 푸줏간 — 갈고리에 걸린 것은 모두 고기가 된다',
  queen: '늪 깊은 둥지에서 여왕이 깨어났다 — 알이 터지기 전에',
  warden: '지하 감옥의 열쇠를 쥔 자 — 이 문으로 나간 죄수는 없다',
  lord: '옥좌에서 심연이 일어선다 — 마지막 싸움이다',
}
import { ACTS, AREAS, NPC_NAMES, QUESTS, actBossQuest, areaDef, areaLayout, elderMarks, isTown, townNpcs } from '../core/world'
import { gateOpen, townPortalSpot } from '../core/sim'
import { keyLabel } from '../game/keymap'
import { HEAD_AIM_FRAC, PART_HEAD, WEAPONS, WeaponDef } from '../core/weapons'
import { BASE_H, BASE_W, GL_PIXELS, Hud, RenderOptions, STAGE_SCALE, ScreenText, VIEW_H, VIEW_K, VIEW_W, canvasRatio, hex, lowAmmo, roundRect } from '../render/hud'
import { renderMapTiles } from '../render/minimap'
import { PITCH, YAW, worldDirToScreen } from './camera'
import { CharacterRig, buildCharacter, enableXray, setRigOpacity, makeShield } from './character3d'
import { VIEW_RADIUS_TILES, Viewer, Vision, canSee } from './vision'
import { U, World3D, buildWorld, paintFloorSteps } from './world3d'
import { MONSTER_TOP, MonsterView, isQuadruped, monsterTop } from './monsters3d'
import { BloodDecals, SPLAT_DROPS, SPLAT_POOL, SPLAT_SPRAY } from './blood'
import { DARK_VIEW_TILES, DON_DARK, DON_SHAKE } from '../core/donate'
import { RARITY_COLORS, RARITY_NAMES, itemName } from '../core/items'

export { VIEW_W, VIEW_H }
export type { RenderOptions }

export { YAW }
/**
 * 카메라 거리. 15.5 → 18.5 (2026-09-23 사용자: "기본 시점을 조금 더 위에서 — 후원이 추가되면서 몹이 많아져 시야를 넓게").
 * 피치(55°)는 그대로라 높이도 같은 비율로 오른다(12.7 → 15.2). 보이는 땅이 가로세로 약 1.2 배(넓이 약 1.4 배).
 */
const FOLLOW_DIST = 18.5
/** 기준 세로 시야각. 화면이 넓어지면 resize() 가 이 값을 줄여 보이는 면적을 유지한다 */
const BASE_FOV = 40
const GUN_H = 0.95
/**
 * 미니맵 창 한 변(px)과 타일당 px. 회전돼 있어 대각선으로는 더 멀리 보인다.
 * 처음 170/11(한 변 ≈ 15칸)은 "보여 주는 게 너무 적다"(2026-09-05) → 190/7 로 넓혔다 (한 변 ≈ 27칸, 대각선 ≈ 38칸).
 */
/** 미니맵 · 전체 지도의 NPC 점 색 (2026-09-20 요청). 가까이 가면 이름표가 뜨므로 눈에 띄는 정도면 된다 */
const NPC_DOT: Record<string, string> = {
  merchant: '#ffd86a',
  smith: '#c8c8c8',
  gambler: '#d8a8ff',
  stash: '#c98a4a',
  elder: '#8affa8',
  captain: '#ff9a7a',
}

const MINIMAP_SIZE = 190
/**
 * 이펙트 상한 · 재사용 (2026-09-23 최적화 — "4명이 해도 렉이 없게"). 전에는 고리 · 총구 섬광 구를 만들 때마다 도형 · 재질을 새로 만들고
 * **지울 때 해제하지 않아** GPU 메모리가 계속 샜다(SMG 한 사람이 초당 10개 — 세 시간이면 10만 개). 파편은 한 알이 그리기 한 번이라
 * 큰 싸움에서 그리기 호출이 수백 개로 튀었다. 이제 모두 모아 두었다가 다시 쓰고, 파편은 인스턴스 하나로 그린다. 넘치면 오래된 것부터 끝낸다.
 */
const PART_MAX = 1200
const RING_MAX = 80
const IMPACT_MAX = 80
/** 동시에 켜 둘 점광원 (넘치면 카메라에서 먼 것부터 잠깐 끈다 — 빛 수가 늘면 셰이더를 다시 컴파일해 화면이 멈춘다) */
const LIGHT_BUDGET = 16
const MINIMAP_PX_PER_TILE = 7

/** 파편 한 알 (그리기는 인스턴스 하나로 모아서 — partMesh) */
interface Particle {
  x: number
  y: number
  z: number
  rx: number
  rz: number
  size: number
  r: number
  g: number
  b: number
  vx: number
  vy: number
  vz: number
  life: number
  max: number
  gravity: number
  spin: number
}

interface WorldText {
  x: number
  z: number
  y: number
  text: string
  life: number
  max: number
  color: string
  big: boolean
  /** 막 뜰 때 튀어 오르는 정도 (기본 0.8, 헤드샷은 더 크게) */
  pop?: number
}

interface DuckVis {
  sx: number
  sy: number
  vsx: number
  vsy: number
  walk: number
  flash: number
  /** 피격 플래시 색 (몸통 빨강 · 머리 금색) */
  flashColor: number
  deadT: number
  fall: number
  /** 피격 튐 쿨다운 (한 틱에 여러 발 맞아도 한 번만) */
  hitCd: number
  /** 근접 휘두르기 (1 → 0) */
  swing: number
  /** 재장전 중 총을 몸 앞으로 끌어당긴 각도(팔 y 회전). 휘두르기와 같은 축이라 따로 둔다 */
  reloadSwing: number
}

interface Flash {
  light: THREE.PointLight
  /** 총구 섬광 구 (없으면 빛만) */
  mesh: THREE.Mesh | null
  life: number
}

interface Ring {
  mesh: THREE.Mesh
  life: number
  max: number
  r0: number
  r1: number
  /** 가장 진할 때의 투명도 */
  peak: number
  /** 가는 고리 (넓은 범위 표시 — 두꺼운 고리는 반경의 15% 라 12칸이면 2칸 가까운 띠가 화면을 덮었다) */
  thin: boolean
}

/** 근접 베기 궤적 (2026-09-19 손맛 — 무기의 사거리 · 각도 그대로의 부채꼴이 번쩍 지나간다) */
interface Slash {
  mesh: THREE.Mesh
  life: number
  max: number
}

/** 빠른 감정 표현 (키 1·2·3, 폰은 버튼). 글은 여기 한 곳에서 정한다 */
/** 말풍선 · 후원 이름표 글꼴 */
const SAY_FONT = '"IBM Plex Sans KR", "Malgun Gothic", sans-serif'

/** 점광원 수를 이 단위로 맞춘다 (빈 빛은 최대 LIGHT_STEP-1 개 — 셰이더 비용이 그만큼 는다) */
const LIGHT_STEP = 4
/** 미리 컴파일하는 가장 큰 빛 수 = 빛 상한(LIGHT_BUDGET). 24 → 16 (2026-09-23 — 넘치면 먼 빛을 끄므로 새 컴파일이 없다) */
const LIGHT_MAX = 16
/** 미리 컴파일하는 빛 수 차례 — 던전에서 흔한 것부터 (등불만 4 · 드랍 빛 8 …, 0 은 모두 쓰러졌을 때뿐) */
const WARM_ORDER = [4, 8, 12, 16, 0]

export const EMOTES: Record<number, string> = { 1: 'ㅋㅋㅋ', 2: '굿 👍', 3: '미안 🙏' }

/** 총성 위치 표시 (단군란 패시브): 안 보이는 상대가 쏘면 그 자리를 잠깐 알려 준다 */
interface Ping {
  x: number
  z: number
  life: number
  max: number
}

export class Renderer3D {
  readonly canvas: HTMLCanvasElement
  readonly hud: Hud
  private gl: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private world: World3D
  private vision: Vision
  /** 시야 밖(안 보이는) 플레이어 */
  private hidden: boolean[] = []
  /**
   * 화면에 그리는 위치. sim 위치를 그대로 쓰면, 상대 입력이 늦어 멈췄다가
   * 한꺼번에 여러 틱을 처리할 때 **순간이동처럼** 보인다.
   * 그래서 실제 이동 속도보다 조금 빠른 상한을 두고 따라가게 한다(리스폰처럼 멀면 즉시 이동).
   */
  private dispPos: { x: number; z: number }[] = []
  /** 마지막으로 본 뒤 남은 시간 — 경계에서 깜빡이지 않도록 (초) */
  private seenT: number[] = []
  /** 스코프(저격 정조준) 중인가 */
  private scoped = false
  /** 가방 가득 알림을 마지막으로 띄운 때 (performance.now) */
  private bagWarnAt = -1e9
  private miniCanvas: HTMLCanvasElement | null = null
  /** 모래주머니 내구도 표시 캐시 (타일 인덱스 → 마지막으로 칠한 비율) */
  private bagShown = new Map<number, number>()
  private lastViewer: Viewer | null = null
  private rigs: CharacterRig[] = []
  private rigChars: string[] = []
  private vis: DuckVis[] = []
  private aimSmooth: number[] = []
  /** 피격 후 체력 바를 보여 줄 남은 시간(초). 상대는 맞았을 때만 보인다 */
  private hitShow: number[] = []
  /** 회복 구슬 (id → 빛나는 구). 디아블로의 붉은 체력 구슬 */
  private globeMeshes = new Map<number, THREE.Group>()
  /** 몬스터 (인스턴스 렌더) */
  private monsterView = new MonsterView()
  /** 마지막으로 그린 판 (조준점 — aimPoint) */
  private lastCurr: GameState | null = null
  /** 시야 밖이라 숨긴 몬스터 id · 경계에서 깜빡이지 않게 남은 시간 */
  private hiddenM = new Set<number>()
  /** 이미 등장을 알린 보스 (몬스터 번호) */
  private bossSeen = new Set<number>()
  private seenM = new Map<number, number>()
  /** 몬스터 투사체 (빛나는 구슬) */
  private shotPool: THREE.Sprite[] = []
  /** 던전: 플레이어마다 드는 등불 — 디아블로의 빛 반경. 어둠과 시야 제한이 겹쳐 분위기를 만든다 */
  private lanterns: THREE.PointLight[] = []
  /** 거대한 막 보스를 카메라 쪽에서 비추는 빛 (등불 반경 밖으로 몸이 나가 검은 덩어리로 보였다 — 2026-09-24) */
  private giantLight = new THREE.PointLight(0xffb48c, 0, 30, 1.1)
  /** 스킬 연출: 땅의 무대(스포트라이트) · 던진 수류탄 · 버프 고리 */
  private zoneMeshes = new Map<number, THREE.Group>()
  private throwMeshes = new Map<number, THREE.Mesh>()
  private auras: THREE.Mesh[] = []
  /** 투기장: 나를 마지막으로 죽인 사람 (복수 알림) */
  private lastKiller = -1
  /** 계단 (층마다) */
  /** 전체 지도(M) 가 열려 있다 */
  mapOpen = false
  /** 다음 막으로 가는 문 (보스를 잡으면 보인다) */
  private gate: THREE.Group | null = null
  /** 지역의 붙박이 표시(출구 · 웨이포인트) — 맵이 바뀌면 새로 만든다 */
  private markers: THREE.Group | null = null
  private markersFor: GameMap | null = null
  /** 타운 포털 (주인 → 푸른 문) */
  private portalMeshes = new Map<number, THREE.Group>()
  /** 지역 물건 (상자 · 항아리 · 제단) */
  private objMeshes = new Map<number, THREE.Group>()
  /** 바닥 전리품 (id → 빛기둥). 내 것과 버려진 것만 보인다 (개인 전리품) */
  private dropMeshes = new Map<number, THREE.Group>()
  private localForDrops = -1
  private bulletPool: THREE.Group[] = []
  /** 명중·벽 섬광 (카메라를 보는 스프라이트, 커지며 사라진다) */
  private impacts: { sprite: THREE.Sprite; life: number; max: number; size: number }[] = []
  private particles: Particle[] = []
  private partMesh!: THREE.InstancedMesh
  private readonly partDummy = new THREE.Object3D()
  private ringGeo = new THREE.RingGeometry(0.85, 1, 32)
  private thinRingGeo = new THREE.RingGeometry(0.975, 1, 72)
  private thinPool: THREE.Mesh[] = []
  private slashPool: THREE.Mesh[] = []
  /**
   * 떨어진 것 · 장판의 도형 · 재질은 같이 쓴다 (2026-09-23 최적화): 전에는 금화 한 더미에 원기둥 6 개 · 아이템 하나에 원기둥 + 상자를
   * 새로 만들고 주울 때 해제하지 않아 GPU 메모리가 샜다(몇 시간이면 수천 개).
   */
  private dropRes = {
    coin: new THREE.CylinderGeometry(0.07, 0.07, 0.025, 10),
    coinMat: new THREE.MeshLambertMaterial({ color: 0xffc84a, emissive: 0x6a4a0a, emissiveIntensity: 0.6 }),
    flask: new THREE.SphereGeometry(0.11, 10, 8),
    flaskMat: new THREE.MeshLambertMaterial({ color: 0xc81e28, emissive: 0x5a0a0a, emissiveIntensity: 0.8 }),
    neck: new THREE.CylinderGeometry(0.035, 0.04, 0.12, 6),
    neckMat: new THREE.MeshLambertMaterial({ color: 0xd8c8a8 }),
    box: new THREE.BoxGeometry(0.22, 0.12, 0.3),
    beams: [] as THREE.CylinderGeometry[],
    beamMats: [] as THREE.MeshBasicMaterial[],
    boxMats: [] as THREE.MeshLambertMaterial[],
  }
  private zoneDisc = new THREE.CircleGeometry(1, 40)
  private zoneRim = new THREE.RingGeometry(0.94, 1, 48)
  /** 보스 줄 범위: (0, 0) 에서 +x 로 길이 1 · 폭 1 (그룹 크기로 늘린다) */
  private zoneLine = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0)
  private zoneLineEdge = new THREE.EdgesGeometry(this.zoneLine)
  private ringPool: THREE.Mesh[] = []
  private impactPool: THREE.Sprite[] = []
  private flashGeo = new THREE.SphereGeometry(0.12, 6, 4)
  private flashMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0 })
  private flashMeshPool: THREE.Mesh[] = []
  private lightPool: THREE.PointLight[] = []
  /** 빛 상한으로 잠깐 끈 빛 (다음 프레임 처음에 되살리고 다시 잰다) */
  private capped: THREE.PointLight[] = []
  /** 3D 해상도 배율 (setRenderScale) */
  private renderScale = 1
  private readonly tmpColor = new THREE.Color()
  private readonly tmpV3 = new THREE.Vector3()
  private texts: WorldText[] = []
  private flashes: Flash[] = []
  private rings: Ring[] = []
  private slashes: Slash[] = []
  /** 무기마다 베기 부채꼴 모양 (한 번 만들어 둔다) */
  private slashGeo = new Map<string, THREE.BufferGeometry>()
  private pings: Ping[] = []
  /** 팀 신호 (같은 편이 찍은 "여기"). 지면 마커 + 화면 밖이면 가장자리 화살표 */
  private marks: { x: number; z: number; life: number; max: number; mesh: THREE.Mesh }[] = []
  /** 빠른 감정 표현 말풍선 (플레이어 번호 → 글·끝나는 시각) */
  private emotes = new Map<number, { text: string; until: number; ally?: boolean; shout?: boolean }>()
  /**
   * 괴물 말풍선 (방송 채팅 · 후원 글 — 2026-09-23). 괴물 id → 누가 · 무엇을 · 언제까지 · 마지막으로 그린 자리.
   * 괴물이 죽어도 말풍선은 제 시간까지 그 자리(시체 위)에 남는다 — 사용자: "죽어도 일정 시간은 떠 있도록"
   */
  private says = new Map<number, { nick: string; text: string; until: number; gold: boolean; warn?: boolean; x?: number; z?: number; top?: number }>()
  /** 막 보스 즉사기 경고 (화면 가장자리 붉게 · 가운데 큰 글 — 예고가 끝날 때까지) */
  private ultWarn: { name: string; hint: string; t0: number; until: number } | null = null
  /** 후원 소환 괴물의 이름표: (부른 사람, 후원 번호) → "○○님의" (세션이 넣는다 — 이름은 sim 밖) */
  private summonLabel: ((by: number, seq: number) => string | undefined) | null = null

  setSummonLabel(fn: (by: number, seq: number) => string | undefined): void {
    this.summonLabel = fn
    this.hud.d4.summonLabel = fn
  }
  private shake = 0
  /** 손맛 (2026-09-19): 역경직(연출 시간을 잠깐 거의 멈춤) · 카메라 펀치(잠깐 당겨짐) */
  private hitStop = 0
  /**
   * 첫 던전 버벅임 (2026-09-23 사용자: "최초 던전 입장 시 버벅인다 — 처음엔 야영지니까 그동안 나눠서 받거나 그려 둬").
   * 지역에 들어서는 프레임에 몰리던 일 셋을 마을에서 나눠 끝낸다:
   *   ① 다음 지역의 3D 세계 · 시야 덮개 만들기(바닥 텍스처 2016×1488 을 캔버스에 그리기) → `prebuildStep`
   *   ② 그 텍스처를 GPU 로 올리고 재질 셰이더를 컴파일하기 → `prepStep`
   *   ③ **점광원 수가 바뀌면 모든 재질의 셰이더를 다시 컴파일한다**(three 는 빛 수가 셰이더에 박힌다). 마을은 횃불 빛 6 개,
   *      들판은 0 개라 들어서는 순간 화면의 모든 재질이 다시 컴파일됐고, 첫 싸움에서 드랍 · 구슬 · 투사체 빛이 늘 때마다
   *      처음 보는 빛 수가 나와 또 컴파일됐다. → 빛 수를 LIGHT_STEP 단위로 맞추고(`padLights`), 그 단위마다 마을에서 미리 컴파일한다.
   * v0.43.1 (사용자: "야영지에서도 몇 초 후 약간 버벅인다 — 컴파일에 제한을 둬서 천천히 나눠서"): 한 걸음을 더 잘게 —
   *   바닥은 6 줄씩 · 셰이더는 **새로 만드는 것 하나씩, 다 될 때까지 기다렸다가** 다음 · 텍스처 올리기도 한 걸음에 하나.
   *   컴파일은 본 장면이 아니라 빛만 둔 컴파일 전용 장면(`warmScene`)에 대고 한다 — 본 장면에 대고 하면 그때마다
   *   본 장면의 빛 상태가 바뀌어 화면의 모든 재질이 셰이더를 다시 골랐다.
   */
  private prebuilt = new Map<GameMap, { world: World3D; vision: Vision }>()
  /** 만드는 중인 지역 (한 걸음씩 — prebuildGen) */
  private prebuilding = new Map<GameMap, Generator<void, void>>()
  /** 빛 수 맞추기용 빈 점광원 (세기 0 · 멀리) — 본 장면에는 LIGHT_STEP-1 개면 된다 */
  private lightPads: THREE.PointLight[] = []
  /** 컴파일 전용 장면: 반구광 · 해(그림자) · 빈 점광원 LIGHT_MAX 개. 본 장면과 빛 종류 · 수만 같게 맞춘다 */
  private warmScene = new THREE.Scene()
  private warmPads: THREE.PointLight[] = []
  /** 준비 작업 줄 (마을에서 prepStep 이 한 걸음씩): 텍스처 올리기 · 셰이더 컴파일(대상 × 빛 수) · 할 일 */
  private prepJobs: ({ t: 'tex'; tex: THREE.Texture } | { t: 'warm'; obj: THREE.Object3D; n: number } | { t: 'run'; run: () => void })[] = []
  /** 이미 줄 세운 것 (재질 · 대상 모양 · 빛 수) — 같은 셰이더를 두 번 부르지 않게 */
  private warmKeys = new Set<string>()
  private upTex = new WeakSet<THREE.Texture>()
  /** 새로 만든 셰이더가 다 될 때까지(이 시각까지) 다음 컴파일을 미룬다 — 다 됐다는 소식이 안 와도 3초면 넘어간다 */
  private warmUntil = 0
  /** 버린 지역의 물체 · 텍스처 (줄에 남은 그 일은 건너뛴다 — 버린 텍스처를 올리면 GPU 메모리가 샌다) */
  private gone = new WeakSet<object>()
  private sceneQueued = false
  /** 모델을 미리 받아 둔 막 (-1 = 아직) */
  private prefetchedAct = -1
  private punch = 0
  /** 바닥 핏자국 (인스턴스 — 오래된 것부터 덮어쓴다) */
  private blood: BloodDecals | null = null
  /** 저격 반동: 카메라가 조준 반대쪽으로 밀렸다가 돌아온다 (월드 단위) */
  private kick = 0
  private kickDir = 0
  /** 저격 조준경 섬광 (0~1). 스코프 안에서는 총구 화염이 안 보여 쐈는지도 몰랐다(제보) */
  private scopeFlash = 0
  private camTarget = new THREE.Vector3()
  private camDist = FOLLOW_DIST
  /** GPU 상태 (확인용 — __bd.gpu(): 컴파일된 셰이더 · 지오메트리 · 텍스처 수). 첫 던전 버벅임을 재는 데 쓴다 */
  gpuInfo(): { programs: number; geometries: number; textures: number; calls: number; tris: number } {
    const i = this.gl.info
    return { programs: this.gl.info.programs?.length ?? 0, geometries: i.memory.geometries, textures: i.memory.textures, calls: i.render.calls, tris: i.render.triangles }
  }

  /** 확인용 카메라 당김 (__bd.zoom — 모델 모습 보기) */
  private debugZoom = 1
  private camInit = false
  private t = 0
  private lastDt = 0.016
  private dpr = 1
  /**
   * 탄 = 빛줄기(덕코프식). 예전에는 구슬 + 짧은 막대라 끝에 동그란 알갱이가 보였다(2026-09-05 제보).
   * 머리는 밝고 꼬리로 갈수록 사라지는 띠 하나. 바닥과 나란한 판 + 세로 판을 겹쳐 어느 각도에서도 보인다.
   */
  private streakGeo = new THREE.PlaneGeometry(1, 1)
  private streakTex = makeStreakTexture()
  private glowTex = makeGlowTexture()
  private streakMats = {
    default: this.streakMat(0xffe28a),
    sniper: this.streakMat(0xffffff),
    shotgun: this.streakMat(0xffb060),
  }
  private particleGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1)
  private raycaster = new THREE.Raycaster()
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  map: GameMap

  constructor(
    readonly container: HTMLElement,
    map: GameMap,
  ) {
    this.map = map
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'gl'
    const hudCanvas = document.createElement('canvas')
    hudCanvas.className = 'hud'
    container.appendChild(this.canvas)
    container.appendChild(hudCanvas)
    this.hud = new Hud(hudCanvas)

    this.gl = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      // 스텐실: 가려진 캐릭터 윤곽이 제 몸 · 다른 캐릭터 위에 그려지지 않게 (character3d enableXray)
      stencil: true,
      powerPreference: 'high-performance',
      // 스크린샷을 뜰 때만 켠다(기본은 성능 우선). 주소 뒤 ?shot=1
      preserveDrawingBuffer: typeof location !== 'undefined' && location.search.includes('shot=1'),
    })
    this.gl.shadowMap.enabled = true
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap
    this.gl.outputColorSpace = THREE.SRGBColorSpace
    this.gl.toneMapping = THREE.ACESFilmicToneMapping
    this.gl.toneMappingExposure = 1.05

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, VIEW_W / VIEW_H, 0.5, 140)
    this.scene.background = new THREE.Color(map.theme.outside)
    this.scene.fog = new THREE.Fog(map.theme.fog, 34, 70)
    this.world = buildWorld(map)
    this.scene.add(this.world.group)
    this.vision = new Vision(map)
    this.scene.add(this.vision.group)
    this.scene.add(this.monsterView.group)
    // 구운 실사 모델: 텍스처 올리기 · 셰이더 컴파일을 줄 세우고, 다 되면 보이게 한다(show — 그때 모양 키 텍스처를 만든다).
    // 마을이 아니면 줄이 돌지 않지만, 그 괴물이 화면에 나오면 monsters3d 가 바로 보이게 한다 (2026-09-20 · 09-23)
    this.monsterView.setWarm((objs, show) => {
      for (const o of objs) this.queueWarm(o)
      this.prepJobs.push({ t: 'run', run: show })
    })
    this.partMesh = new THREE.InstancedMesh(this.particleGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), PART_MAX)
    this.partMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PART_MAX * 3), 3)
    this.partMesh.count = 0
    this.partMesh.frustumCulled = false
    this.scene.add(this.partMesh)
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffcf9a, 0, 10, 1.4)
      l.visible = false
      this.lanterns.push(l)
      this.scene.add(l)
    }
    this.giantLight.visible = false
    this.scene.add(this.giantLight)
    const pad = (): THREE.PointLight => {
      const l = new THREE.PointLight(0x000000, 0, 0.01, 2)
      l.position.set(0, -60, 0)
      l.visible = false
      l.userData.pad = true
      return l
    }
    for (let i = 0; i < LIGHT_STEP - 1; i++) {
      const l = pad()
      this.lightPads.push(l)
      this.scene.add(l)
    }
    // 컴파일 전용 장면: 세계(buildDark)와 같은 반구광 하나 · 그림자 드리우는 해 하나 + 점광원
    const wsun = new THREE.DirectionalLight(0xffffff, 1)
    wsun.castShadow = true
    this.warmScene.add(new THREE.HemisphereLight(0xffffff, 0x000000, 1), wsun)
    for (let i = 0; i < LIGHT_MAX; i++) {
      const l = pad()
      this.warmPads.push(l)
      this.warmScene.add(l)
    }
    this.resize()
  }

  /** 팀 신호를 찍는다 (sim 밖이라 결정론과 무관하다) */
  addMark(x: number, y: number): void {
    const geo = new THREE.RingGeometry(0.5, 0.72, 24)
    const mat = new THREE.MeshBasicMaterial({ color: 0x7ee0a0, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, depthTest: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x * U, 0.06, y * U)
    mesh.renderOrder = 5
    this.scene.add(mesh)
    this.marks.push({ x: x * U, z: y * U, life: 6, max: 6, mesh })
    if (this.marks.length > 4) {
      const old = this.marks.shift()!
      this.scene.remove(old.mesh)
    }
  }

  /** 빠른 감정 표현: 머리 위 말풍선 2.2초 */
  showEmote(i: number, id: number): void {
    const text = EMOTES[id]
    if (!text) return
    this.emotes.set(i, { text, until: performance.now() + 2200 })
  }

  /**
   * 스킬 외침 (core/skills.ts skillShout): 머리 위 말풍선 — 스킬명만이면 1.5초, 우리 편을 부르는 말이면 초록으로 2.8초.
   * 채팅 말풍선이 떠 있으면 덮지 않는다 (사람이 쓴 글이 먼저)
   */
  showShout(i: number, text: string, ally: boolean): void {
    const cur = this.emotes.get(i)
    const now = performance.now()
    if (cur && cur.until > now && !cur.shout) return
    this.emotes.set(i, { text, until: now + (ally ? 2800 : 1500), ally, shout: true })
  }

  /** 채팅 말풍선: 머리 위에 받은 글 (길면 줄여서) · 글 길이에 따라 3~6초 */
  showSay(i: number, text: string): void {
    const t = text.length > 26 ? `${text.slice(0, 25)}…` : text
    this.emotes.set(i, { text: t, until: performance.now() + Math.min(6000, 3000 + text.length * 60) })
  }

  /**
   * 괴물이 말한다 (방송 채팅 · 후원 글): 머리 위 말풍선에 닉네임과 글. 길면 줄인다. 글 길이만큼 3.5~7초.
   * gold = 후원 글 (금빛 테두리)
   */
  monsterSay(id: number, nick: string, text: string, gold = false, warn = false, ms = 0): void {
    const t = text.length > 30 ? `${text.slice(0, 29)}…` : text
    this.says.set(id, { nick: nick.slice(0, 12), text: t, until: performance.now() + (ms || Math.min(8000, 4500 + text.length * 90)), gold, warn })
  }

  /**
   * 말할 괴물 고르기: 지금 화면에 보이는(시야 안 · 화면 안) 산 괴물 중 말하고 있지 않은 것 하나를 아무렇게나. 없으면 -1.
   * 화면 가운데(내 캐릭터)에 가까울수록 잘 뽑힌다 — 멀리 구석에서 말하면 못 읽는다
   */
  pickSpeaker(curr: GameState): number {
    const now = performance.now()
    let best = -1
    let bestScore = -Infinity
    for (const m of curr.monsters) {
      if (m.hp <= 0 || this.hiddenM.has(m.id)) continue
      const s = this.says.get(m.id)
      if (s && s.until > now) continue
      const at = this.monsterView.shown.get(m.id)
      if (!at) continue
      const p = this.worldToScreen(at.x, 1.2, at.z)
      if (p.x < 40 || p.x > VIEW_W - 40 || p.y < 60 || p.y > VIEW_H - 150) continue
      const d = Math.hypot(p.x - VIEW_W / 2, p.y - VIEW_H / 2)
      const score = Math.random() * 400 - d
      if (score > bestScore) {
        bestScore = score
        best = m.id
      }
    }
    return best
  }

  /** 화면 위쪽 큰 배너 (지역 이름) */
  banner(title: string, sub: string, color?: string): void {
    this.hud.banner(title, sub, color)
  }

  /** 새 판(새 맵)으로 교체 */
  setMap(map: GameMap): void {
    this.emotes.clear()
    this.says.clear()
    // 핏자국은 떠나온 지역 것 — 새 지역 바닥에 남지 않게
    this.blood?.clear()
    this.hud.clearNotices()
    for (const g of this.portalMeshes.values()) this.scene.remove(g)
    this.portalMeshes.clear()
    for (const g of this.objMeshes.values()) this.scene.remove(g)
    this.objMeshes.clear()
    this.scene.remove(this.world.group)
    this.world.dispose()
    this.scene.remove(this.vision.group)
    this.vision.dispose()
    this.map = map
    // 만들다 만 것이면 남은 걸음을 지금 끝낸다 (한 일은 그대로 쓴다)
    const gen = this.prebuilding.get(map)
    if (gen) for (let r = gen.next(); !r.done; r = gen.next());
    this.prebuilding.clear()
    const pre = this.prebuilt.get(map)
    this.prebuilt.delete(map)
    this.world = pre ? pre.world : buildWorld(map)
    this.scene.add(this.world.group)
    this.vision = pre ? pre.vision : new Vision(map)
    this.scene.add(this.vision.group)
    // 남은 것은 떠나온 지역의 이웃이었다 — 새 지역에서 필요한 것은 다시 만든다 (GPU 메모리)
    for (const p of this.prebuilt.values()) this.dropPrebuilt(p)
    this.prebuilt.clear()
    this.scene.background = new THREE.Color(map.theme.outside)
    this.scene.fog = new THREE.Fog(map.theme.fog, 34, 70)
    this.miniCanvas = null
    this.bagShown.clear()
    for (const g of this.globeMeshes.values()) this.scene.remove(g)
    this.globeMeshes.clear()
    this.camInit = false
  }

  /**
   * 다음 지역을 미리 만드는 **한 걸음** (마을에서 — session.idlePrep). 한 일이 있으면 true, 다 만들었으면 false.
   * 걸음: 바닥 그림 6 줄씩 → 세계 → 시야 덮개. 텍스처 올리기 · 셰이더 컴파일은 준비 줄(prepJobs)에 세운다.
   */
  prebuildStep(map: GameMap): boolean {
    if (map === this.map || this.prebuilt.has(map)) return false
    let gen = this.prebuilding.get(map)
    if (!gen) {
      gen = this.prebuildGen(map)
      this.prebuilding.set(map, gen)
    }
    if (gen.next().done) this.prebuilding.delete(map)
    return true
  }

  private *prebuildGen(map: GameMap): Generator<void, void> {
    const style = map.theme.style
    let floor: THREE.CanvasTexture | undefined
    if (style) {
      const paint = paintFloorSteps(map, style, 6)
      for (let r = paint.next(); ; r = paint.next()) {
        if (r.done) {
          floor = r.value
          break
        }
        yield
      }
      yield
    }
    const world = buildWorld(map, floor)
    yield
    const vision = new Vision(map)
    this.prebuilt.set(map, { world, vision })
    this.queueWarm(world.group)
    this.queueWarm(vision.group)
  }

  private dropPrebuilt(p: { world: World3D; vision: Vision }): void {
    for (const g of [p.world.group, p.vision.group]) {
      g.traverse((o) => {
        this.gone.add(o)
        const mat = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | THREE.MeshLambertMaterial[] | undefined
        for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) if (m.map) this.gone.add(m.map)
      })
    }
    p.world.dispose()
    p.vision.dispose()
  }

  /**
   * 대상의 텍스처 올리기 · 셰이더 컴파일을 준비 줄에 세운다.
   * 빛을 쓰는 재질(Lambert 등)은 빛 수 단위마다, 빛을 안 쓰는 재질은 한 번(그 뒤로는 빛 수가 바뀌어도 셰이더를 다시 고르지 않는다).
   * 빛 수 순서는 던전에서 흔한 것부터 — 등불(사람마다 하나)만 켜진 4 · 드랍 빛이 는 8 …
   */
  private queueWarm(root: THREE.Object3D): void {
    const warm: { obj: THREE.Object3D; key: string; lit: boolean }[] = []
    root.traverse((o) => {
      const r = o as THREE.Mesh & { isSprite?: boolean; isPoints?: boolean; isLine?: boolean; isInstancedMesh?: boolean; instanceColor?: unknown; morphTexture?: unknown }
      if (!(r.isMesh || r.isSprite || r.isPoints || r.isLine) || !r.material) return
      for (const m of Array.isArray(r.material) ? r.material : [r.material]) {
        const tm = m as THREE.MeshLambertMaterial
        for (const t of [tm.map, tm.normalMap, tm.emissiveMap, tm.alphaMap]) {
          if (t && !this.upTex.has(t)) {
            this.upTex.add(t)
            this.prepJobs.push({ t: 'tex', tex: t })
          }
        }
        const g = r.geometry
        const shape = `${r.isInstancedMesh ? 1 : 0}${r.instanceColor ? 1 : 0}${r.morphTexture ? 1 : 0}${g?.morphAttributes?.position ? 1 : 0}${g?.attributes?.color ? 1 : 0}${r.receiveShadow ? 1 : 0}${r.isSprite ? 's' : ''}`
        const lit = !!((m as THREE.MeshLambertMaterial).isMeshLambertMaterial || (m as THREE.MeshStandardMaterial).isMeshStandardMaterial || (m as THREE.MeshPhongMaterial).isMeshPhongMaterial || (m as THREE.MeshToonMaterial).isMeshToonMaterial || (m as THREE.ShaderMaterial & { lights?: boolean }).lights)
        // 빛을 안 쓰는 재질은 한 번 셰이더를 가지면 끝이다 — 이미 그려진 것은 건너뛴다
        if (!lit && (this.gl.properties.get(m) as { currentProgram?: unknown }).currentProgram) continue
        warm.push({ obj: o, key: `${m.uuid}|${shape}`, lit })
      }
    })
    for (const n of WARM_ORDER) {
      for (const w of warm) {
        if (!w.lit && n !== WARM_ORDER[0]) continue
        const k = `${w.key}|${w.lit ? n : '-'}`
        if (this.warmKeys.has(k)) continue
        this.warmKeys.add(k)
        this.prepJobs.push({ t: 'warm', obj: w.obj, n })
      }
    }
  }

  /**
   * 준비 줄 한 걸음 (마을에서 — session.idlePrep). 할 일이 남았으면 true.
   * - 텍스처는 한 걸음에 하나.
   * - 셰이더는 이미 있는 것(캐시)이면 budgetMs 안에서 이어 가고, **새로 만든 것이 하나 나오면 멈춘다** —
   *   그 셰이더가 다 될 때까지(KHR_parallel_shader_compile) 다음 걸음은 쉰다.
   */
  prepStep(budgetMs = 3): boolean {
    if (!this.sceneQueued) {
      // 캐릭터 · 괴물(도형) · 효과 재질은 장면에 있다 — 던전의 빛 수에서도 쓰게 한 번 줄 세운다
      this.sceneQueued = true
      this.queueWarm(this.scene)
    }
    const t0 = performance.now()
    if (t0 < this.warmUntil) return true
    const programs = this.gl.info.programs as unknown[] | null
    const p0 = programs?.length ?? 0
    while (this.prepJobs.length > 0) {
      const job = this.prepJobs.shift()!
      if (job.t === 'tex') {
        if (this.gone.has(job.tex)) continue
        this.gl.initTexture(job.tex)
        return true
      }
      if (job.t === 'run') {
        job.run()
        return true
      }
      if (this.gone.has(job.obj)) continue
      this.warmScene.fog = this.scene.fog
      this.warmPads.forEach((l, i) => (l.visible = i < job.n))
      // 자식은 빼고 그 물체 하나만 (그룹이면 아래 것들이 한꺼번에 컴파일된다)
      const one = Object.create(job.obj) as THREE.Object3D
      one.children = []
      const done = this.gl.compileAsync(one, this.camera, this.warmScene).catch(() => {})
      if ((programs?.length ?? 0) > p0) {
        this.warmUntil = t0 + 3000
        void done.finally(() => (this.warmUntil = 0))
        return true
      }
      if (performance.now() - t0 > budgetMs) return true
    }
    return false
  }

  /** 장면에서 지금 켜진 점광원 (빈 빛 제외) */
  private realLights(): THREE.PointLight[] {
    const out: THREE.PointLight[] = []
    this.scene.traverseVisible((o) => {
      if ((o as THREE.PointLight).isPointLight && !o.userData.pad) out.push(o as THREE.PointLight)
    })
    return out
  }

  /** 켜진 점광원 수를 LIGHT_STEP 의 배수로 맞춘다 — 빛 수가 몇 가지로만 나와 미리 컴파일한 셰이더를 다시 쓴다 */
  private padLights(): void {
    // 빛 상한: 넘치면 카메라가 보는 곳에서 먼 것부터 이번 프레임만 끈다 (다음 프레임 draw 처음에 되살린다)
    let lights = this.realLights()
    if (lights.length > LIGHT_BUDGET) {
      const cx = this.camTarget.x
      const cz = this.camTarget.z
      const wp = this.tmpV3
      const dist = new Map<THREE.PointLight, number>()
      for (const l of lights) {
        l.getWorldPosition(wp)
        dist.set(l, (wp.x - cx) ** 2 + (wp.z - cz) ** 2)
      }
      lights = [...lights].sort((a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0))
      for (let i = LIGHT_BUDGET; i < lights.length; i++) {
        lights[i].visible = false
        this.capped.push(lights[i])
      }
    }
    const real = Math.min(lights.length, LIGHT_BUDGET)
    const need = real >= LIGHT_MAX ? 0 : Math.ceil(real / LIGHT_STEP) * LIGHT_STEP - real
    for (let i = 0; i < this.lightPads.length; i++) {
      const on = i < need
      if (this.lightPads[i].visible !== on) this.lightPads[i].visible = on
    }
  }

  /**
   * 3D 해상도 배율 (2026-09-23 최적화 — 느린 PC 에서 자동으로 낮춘다 · 설정의 화질). HUD 글씨는 그대로 또렷하다.
   * 1 = 화면 해상도대로. 바뀌면 캔버스 크기를 다시 잡는다.
   */
  setRenderScale(k: number): void {
    const v = Math.max(0.35, Math.min(1, k))
    if (Math.abs(v - this.renderScale) < 0.01) return
    this.renderScale = v
    this.resize()
  }

  get renderScaleValue(): number {
    return this.renderScale
  }

  /** 그림자 켜고 끄기 (화질 낮음 · 가장 낮은 자동 단계). 바꾸면 재질 셰이더를 한 번 다시 고른다 */
  setShadows(on: boolean): void {
    if (this.gl.shadowMap.enabled === on) return
    this.gl.shadowMap.enabled = on
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      for (const mm of Array.isArray(m) ? m : m ? [m] : []) mm.needsUpdate = true
    })
  }

  /** 실사 괴물 켜기/끄기 (Esc 메뉴 — 2026-09-19) */
  setRealMonsters(on: boolean): void {
    this.monsterView.setReal(on)
  }

  /** 확인용: 카메라 거리 배율 (1 = 보통) */
  setDebugZoom(k: number): void {
    this.debugZoom = Math.max(0.15, Math.min(2, k))
  }

  /** 확인용: 괴물 렌더러 */
  debugMonsters(): unknown {
    return this.monsterView
  }

  /** 실사 괴물 모델 상태 (확인용) */
  monsterModels(): { ready: number[]; loading: number[]; failed: number[] } {
    return this.monsterView.modelStatus()
  }

  resize(): void {
    // 화면 해상도대로 그린다(전에는 dpr 만 봐서 큰 창에서 720p 를 늘려 흐릿했다) — 픽셀 수 상한 GL_PIXELS
    this.dpr = canvasRatio(STAGE_SCALE, GL_PIXELS) * this.renderScale
    this.gl.setPixelRatio(this.dpr)
    this.gl.setSize(VIEW_W, VIEW_H, false)
    // 폭이 넓어진 만큼 좌우로 더 보이면 넓은 화면이 유리해진다.
    // 세로 시야를 sqrt(기준비율/현재비율) 만큼 좁혀 **보이는 월드 면적**을 일정하게 맞춘다.
    const a = VIEW_W / VIEW_H
    const a0 = BASE_W / BASE_H
    const halfBase = ((BASE_FOV / 2) * Math.PI) / 180
    const half = Math.atan(Math.tan(halfBase) * Math.sqrt(a0 / a))
    this.camera.aspect = a
    this.camera.fov = (half * 2 * 180) / Math.PI
    this.camera.updateProjectionMatrix()
    this.hud.resize()
  }

  /** 화면 좌표(1280x720 프레임) → sim 좌표(px) */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const ndc = new THREE.Vector2((sx / VIEW_W) * 2 - 1, -(sy / VIEW_H) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GUN_H)
    const hit = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(plane, hit)) {
      this.raycaster.ray.intersectPlane(this.ground, hit)
    }
    return { x: hit.x / U, y: hit.z / U }
  }

  worldToScreen(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.camera)
    return { x: ((v.x + 1) / 2) * VIEW_W, y: ((1 - v.y) / 2) * VIEW_H }
  }

  private ensureRigs(state: GameState): void {
    const chars = state.players.map((p) => p.char)
    if (chars.length !== this.rigChars.length) {
      for (const r of this.rigs) this.scene.remove(r.root)
      this.rigs = chars.map((c) => {
        const r = buildCharacter(CHARACTERS[c])
        enableXray(r)
        return r
      })
      this.rigChars = [...chars]
      for (const r of this.rigs) this.scene.add(r.root)
      this.vis = chars.map(() => newVis())
      this.aimSmooth = chars.map(() => 0)
      this.hitShow = chars.map(() => 0)
      return
    }
    // 캐릭터 교체: 바뀐 사람만 다시 만든다
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === this.rigChars[i]) continue
      this.scene.remove(this.rigs[i].root)
      const rig = buildCharacter(CHARACTERS[chars[i]])
      enableXray(rig)
      this.scene.add(rig.root)
      this.rigs[i] = rig
      this.rigChars[i] = chars[i]
      this.vis[i] = newVis()
    }
  }

  // ---------- 이벤트 → 이펙트 ----------
  onEvents(events: SimEvent[], state: GameState, localPlayer: number, names?: string[]): void {
    this.ensureRigs(state)
    // 이름이 없는 자리(영상용 손님 등)는 캐릭터 이름으로 — "undefined 레벨 7" 이 떴다
    const nm = state.players.map((p, i) => names?.[i] ?? CHARACTERS[p.char].name)
    for (const e of events) {
      switch (e.type) {
        case 'bash': {
          // 저격총 개머리판: 후라이팬처럼 휘두른다
          this.vis[e.p].swing = 1
          break
        }
        case 'fire': {
          const w = WEAPONS[e.weapon]
          const rig = this.rigs[e.p]
          const v = this.vis[e.p]
          if (w.melee) {
            // 근접: 휘두르는 몸짓 + 베기 궤적 (바이올린 = 넓고 붉은 호 · 장검 = 가늘고 긴 흰 쐐기 · 후라이팬 = 누런 호)
            v.swing = 1
            const pl = state.players[e.p]
            if (pl && !this.hidden[e.p]) this.spawnSlash(pl.x * U, pl.y * U, (e.aim / 1024) * Math.PI * 2, w)
            break
          }
          // 단군란 패시브(중계, 투기장): 시야 밖 적의 총성 위치를 1.2초 표시
          if (state.mode === 'arena' && localPlayer >= 0 && state.players[localPlayer].char === 'dangun' && this.hidden[e.p] && state.players[e.p].team !== state.players[localPlayer].team) {
            this.pings.push({ x: e.x * U, z: e.y * U, life: 1.2, max: 1.2 })
          }
          const tip = new THREE.Vector3()
          rig.gunTip.getWorldPosition(tip)
          const big = w.family === 'sniper' || w.boom !== undefined
          this.spawnFlash(tip, big ? 2.6 : w.pellets > 1 ? 1.6 : 1)
          v.vsx -= big ? 0.3 : 0.12
          v.vsy += big ? 0.2 : 0.08
          if (e.p === localPlayer) {
            if (w.scope) {
              // 저격: 크게 흔들리고, 카메라가 반동으로 뒤로 밀리며, 조준경이 번쩍인다
              this.shake = Math.max(this.shake, 0.32)
              this.kick = 1.1
              this.kickDir = angleToRad(e.aim)
              this.scopeFlash = 1
            } else this.shake = Math.max(this.shake, w.pellets > 1 ? 0.12 : 0.05)
          }
          break
        }
        case 'wall': {
          const rad = angleToRad(e.aim)
          for (let i = 0; i < 7; i++) {
            const a = rad + Math.PI + (Math.random() - 0.5) * 1.8
            const sp = 0.05 + Math.random() * 0.13
            const spark = i % 2 === 0
            this.spawnParticle(e.x * U, GUN_H, e.y * U, Math.cos(a) * sp, 0.05 + Math.random() * 0.09, Math.sin(a) * sp, spark ? 0.2 : 0.35, spark ? 0xffe8a8 : 0xc9c0ae, spark ? 0.35 : 0.55)
          }
          this.spawnImpact(e.x * U, GUN_H, e.y * U, 0xffe8b0, 0.8)
          break
        }
        case 'hit': {
          // 투기장: 플레이어가 플레이어를 맞힘 — 덕의 명중 연출 (몸통 빨강 · 머리 금색)
          const v = this.vis[e.p]
          if (!v) break
          const head = e.part === PART_HEAD
          this.hitShow[e.p] = 2.5
          v.flash = head ? 0.22 : 0.15
          v.flashColor = head ? 0xffd84a : 0xff3b30
          if (v.hitCd <= 0) {
            v.hitCd = 0.1
            v.vsx += head ? 0.4 : 0.28
            v.vsy -= head ? 0.34 : 0.24
          }
          if (e.by === localPlayer || e.p === localPlayer)
            this.texts.push({ x: e.x * U, z: e.y * U, y: head ? 2.1 : 1.9, text: head ? `헤드샷 ${e.dmg}` : `${e.dmg}`, life: head ? 1.0 : 0.8, max: head ? 1.0 : 0.8, color: head ? '#ffd84a' : '#ff5a4a', big: head, pop: head ? 1.6 : 0.8 })
          const n = head ? 16 : 10
          for (let k = 0; k < n; k++) {
            const a = Math.random() * Math.PI * 2
            const sp = (head ? 0.1 : 0.07) + Math.random() * 0.13
            const col = head ? (k % 3 === 0 ? 0xfff3c0 : 0xffd84a) : k % 3 === 0 ? 0xff9a6a : 0xff4a3a
            this.spawnParticle(e.x * U, GUN_H, e.y * U, Math.cos(a) * sp, 0.05 + Math.random() * 0.12, Math.sin(a) * sp, 0.24 + Math.random() * 0.12, col, head ? 0.5 : 0.44)
          }
          this.spawnImpact(e.x * U, GUN_H, e.y * U, head ? 0xffd84a : 0xff5a4a, head ? 2.8 : 1.7)
          if (e.by === localPlayer) this.hud.hitMark(head)
          if (e.p === localPlayer) {
            this.shake = Math.max(this.shake, 0.18)
            const from = state.players[e.by]
            const me = state.players[e.p]
            if (from && me) {
              const sd = worldDirToScreen(from.x - me.x, from.y - me.y)
              if (sd.x !== 0 || sd.y !== 0) this.hud.addHitDir(Math.atan2(sd.y, sd.x), e.dmg >= 40)
            }
          }
          break
        }
        case 'skill':
          this.onSkill(e, state, localPlayer)
          break
        case 'loot': {
          // 내 것(또는 버려진 것)만 보인다. 등급이 높을수록 크게 번쩍 — 전설은 주황 기둥이 솟는다
          if (e.owner !== localPlayer && e.owner !== -1) break
          const col = new THREE.Color(RARITY_COLORS[e.rarity]).getHex()
          this.spawnRing(e.x * U, e.y * U, 0.2, 0.6 + e.rarity * 0.4, 0.5, col)
          if (e.rarity >= 2) this.spawnImpact(e.x * U, 0.6, e.y * U, col, 1.5 + e.rarity)
          break
        }
        case 'bagFull': {
          // 자동 줍기를 하려는데 가방이 가득 — 5초에 한 번만 알린다
          if (e.p !== localPlayer || performance.now() - this.bagWarnAt < 5000) break
          this.bagWarnAt = performance.now()
          this.hud.notice('가방이 가득 찼습니다 — 마을에서 팔거나 보관하세요 (I 가방)', '#ffb0a0')
          break
        }
        case 'pickup': {
          if (e.p !== localPlayer) break
          const it = state.players[e.p].bag.find((b) => b.uid === e.uid)
          if (it) this.hud.notice(`${it.rarity > 0 ? RARITY_NAMES[it.rarity] + ' ' : ''}${itemName(it)} 획득`, RARITY_COLORS[it.rarity])
          break
        }
        case 'chain': {
          // 연쇄 번개: 두 점 사이 번쩍
          this.spawnRing(e.x2 * U, e.y2 * U, 0.1, 0.8, 0.3, 0x9ad8ff)
          for (let k = 0; k <= 6; k++) {
            const t = k / 6
            this.spawnParticle((e.x + (e.x2 - e.x) * t) * U, 0.9, (e.y + (e.y2 - e.y) * t) * U, 0, 0.01, 0, 0.25, 0xbfe8ff, 0.5)
          }
          break
        }
        case 'goblinGone':
          this.spawnRing(e.x * U, e.y * U, 0.2, 2, 0.8, 0xffd84a)
          this.hud.notice('보물 고블린이 도망쳤다…', '#ffd86a')
          break
        case 'mheal':
          // 괴물이 스스로 고친다 — 초록은 우리 편 좋은 효과라 **보라**(적이 세지는 것)로 (2026-09-23)
          this.spawnRing(e.x * U, e.y * U, 0.3, e.r * U, 0.8, ENEMY_BUFF)
          break
        case 'allyfx': {
          // 동료를 고치거나 지켜 주는 스킬이 닿는 범위: **초록** (적의 범위 공격은 빨강). 투기장에서 상대 편이 쓴 것은 보라
          const me = localPlayer >= 0 ? state.players[localPlayer] : undefined
          const caster = state.players[e.p]
          const foe = !!me && !!caster && me !== caster && isEnemy(me, caster)
          const col = foe ? ENEMY_BUFF : ALLY_GOOD
          // 가는 고리 둘 — 퍼져 나가는 것 · 닿는 끝에 잠깐 남는 것 (두꺼운 띠가 화면을 덮었다 — 2026-09-23 영상에서 확인)
          this.spawnRing(e.x * U, e.y * U, 0.3, e.r * U, 0.6, col, true, 0.7)
          this.spawnRing(e.x * U, e.y * U, e.r * U * 0.985, e.r * U, 0.9, col, true, 0.55)
          break
        }
        case 'summon':
          this.spawnRing(e.x * U, e.y * U, 0.3, 2.4, 0.7, 0xd8c8ff)
          break
        case 'questDone': {
          // 막 보스 퀘스트면 **다음 막으로 가는 문**이 열렸다고 크게 알린다
          // (2026-09-20 사용자: "1막 보스를 잡았는데 어디로 가야 하는지 몰랐다")
          const qd = QUESTS[e.q]
          const nextAct = e.q === actBossQuest(qd.act) ? qd.act + 1 : -1
          if (nextAct > 0 && nextAct < ACTS.length) {
            this.hud.banner(`${qd.act + 1}막을 끝냈다 — ${ACTS[nextAct].name}`, '보스가 섰던 자리에 문이 열렸다 · F 로 건너간다 (마을 촌장에게도 부탁할 수 있다)', '#e0a8ff')
          } else {
            this.hud.banner(`퀘스트 이룸 — ${qd.name}`, '마을의 촌장 카인에게 보고하라', '#ffd86a')
          }
          break
        }
        case 'questReward':
          if (e.p === localPlayer) this.hud.notice(`보상: ${QUESTS[e.q].reward}`, '#ffd86a')
          break
        case 'gold':
          if (e.p === localPlayer) this.texts.push({ x: e.x * U, z: e.y * U, y: 0.9, text: `+${Math.round(e.n)} 골드`, life: 0.9, max: 0.9, color: '#ffd86a', big: false, pop: 0.4 })
          break
        case 'potGet':
          if (e.p === localPlayer) this.texts.push({ x: e.x * U, z: e.y * U, y: 0.9, text: '+물약', life: 0.9, max: 0.9, color: '#ff7a7a', big: false, pop: 0.4 })
          break
        case 'potion': {
          const p = state.players[e.p]
          if (p) this.spawnRing(p.x * U, p.y * U, 0.2, 1.2, 0.5, 0xff4a4a)
          break
        }
        case 'objOpen':
          if (e.kind === OBJ_URN) {
            for (let k = 0; k < 6; k++) {
              const a = Math.random() * Math.PI * 2
              this.spawnParticle(e.x * U, 0.3, e.y * U, Math.cos(a) * 0.05, 0.08, Math.sin(a) * 0.05, 0.7, 0x8a6a4a, 0.6)
            }
          } else this.spawnRing(e.x * U, e.y * U, 0.2, 1.6, 0.6, e.kind === OBJ_GOLDCHEST ? 0xffd86a : 0xd8c8a8)
          break
        case 'shrine':
          this.spawnRing(e.x * U, e.y * U, 0.3, 2.8, 0.8, [0xff5a3a, 0x5aa8ff, 0xd8a8ff, 0x7aff9a][e.kind] ?? 0xffffff)
          if (e.p === localPlayer) this.hud.notice(`${SHRINE_NAMES[e.kind]} — ${['피해 +25%', '받는 피해 -25%', '경험치 +50%', '이동 +20%'][e.kind]} (30초)`, '#d8c8ff')
          break
        case 'wpFound':
          if (e.p === localPlayer) {
            // 창은 띄우지 않는다 — 알리기만 (2026-09-25 사용자: "찍었을 때 알려만 주고")
            this.hud.notice(`웨이포인트 열림 — ${areaDef(e.area).name} · F 로 이동 창`, '#7ab8ff')
            const l = areaLayout(e.area, this.map)
            if (l.wp) this.spawnRing(l.wp.x * U, l.wp.y * U, 0.3, 2.4, 0.7, 0x7ab8ff)
          }
          break
        case 'portalCast':
          this.spawnRing(e.x * U, e.y * U, 0.2, 1.4, 1.5, 0x5a8cff)
          break
        case 'portalOpen':
          if (e.p === localPlayer) this.hud.notice('타운 포털 — F 로 마을에 드나든다', '#7ab8ff')
          else this.hud.notice(`${nm[e.p]} 의 타운 포털`, '#7ab8ff')
          break
        case 'areaEnter':
          if (e.p !== localPlayer && e.how !== 'follow') this.hud.notice(`${nm[e.p]} — ${areaDef(e.area).name}`, '#a89878')
          break
        case 'bossDown': {
          const a = areaDef(e.area)
          if (a.boss !== undefined && a.act === ACTS.length - 1) this.hud.banner('심연이 닫혔다', `${MONSTER_LIST[e.kind].name}이(가) 쓰러졌다`, '#ffcf6a')
          else if (a.boss !== undefined) this.hud.banner(`${a.act + 1}막을 끝냈다`, `${MONSTER_LIST[e.kind].name}이(가) 쓰러졌다 · 촌장에게 가면 ${a.act + 2}막으로`, '#ffcf6a')
          else this.hud.notice(`우두머리 ${a.unique?.name ?? ''} 쓰러짐!`, '#ffb46a')
          break
        }
        case 'levelup': {
          const p = state.players[e.p]
          if (!p) break
          if (e.p === localPlayer) this.hud.notice(`레벨 ${e.level} — 능력치 포인트 +3 · 스킬 포인트 +1 (C · K)`, '#ffd86a')
          this.spawnRing(p.x * U, p.y * U, 0.3, 3, 0.8, 0xffd86a)
          this.spawnImpact(p.x * U, 1.2, p.y * U, 0xffd86a, 4)
          for (let k = 0; k < 24; k++) {
            const a = (k / 24) * Math.PI * 2
            this.spawnParticle(p.x * U, 0.4, p.y * U, Math.cos(a) * 0.06, 0.14 + Math.random() * 0.06, Math.sin(a) * 0.06, 1.1, k % 2 ? 0xffd86a : 0xfff3c0, 0.6)
          }
          this.hud.notice(e.p === localPlayer ? `레벨 ${e.level}!` : `${nm[e.p]} 레벨 ${e.level}`, '#ffd86a')
          break
        }
        case 'aoe':
          this.onAoe(e)
          break
        case 'hurt': {
          // 플레이어가 몬스터에게 맞음: 빨간 번쩍 + 숫자
          const v = this.vis[e.p]
          if (!v) break
          this.hitShow[e.p] = 2.5
          v.flash = 0.15
          v.flashColor = 0xff3b30
          if (v.hitCd <= 0) {
            v.hitCd = 0.1
            v.vsx += 0.28
            v.vsy -= 0.24
          }
          this.texts.push({ x: e.x * U, z: e.y * U, y: 1.9, text: `-${Math.round(e.dmg)}`, life: 0.8, max: 0.8, color: '#ff8a7a', big: false, pop: 0.6 })
          if (e.p === localPlayer) {
            this.shake = Math.max(this.shake, 0.18)
            const me = state.players[e.p]
            const src = state.monsters.find((m) => m.id === e.by)
            if (src && me) {
              const sd = worldDirToScreen(src.x - me.x, src.y - me.y)
              if (sd.x !== 0 || sd.y !== 0) this.hud.addHitDir(Math.atan2(sd.y, sd.x), e.dmg >= 30)
            }
          }
          break
        }
        case 'mhit': {
          // 몬스터 명중: 보통은 빨강, 치명타(약점)는 금색으로 더 크게 — 덕의 헤드샷 연출 그대로
          const head = e.crit
          // 쏜 방향 (쏜 사람 → 맞은 자리) — 몸이 밀리고 피가 그쪽으로 튄다 (손맛)
          const dir = this.shotDir(state, e.by, e.x, e.y)
          this.monsterView.hit(e.m, head, dir.x, dir.z)
          const hidden = this.hiddenM.has(e.m)
          // 숫자는 **내가 맞힌 것만** 띄운다 — 동료·폭발 숫자까지 띄우면 무리 싸움에서 화면이 숫자로 덮였다(2026-09-18 확인)
          const mine = e.by === localPlayer
          if (mine && head) {
            this.hitStop = Math.max(this.hitStop, 0.045)
            this.punch = Math.max(this.punch, 0.45)
          }
          if (!hidden && mine) {
            this.texts.push({
              x: e.x * U, z: e.y * U, y: head ? 1.7 : 1.5,
              text: head ? `치명 ${e.dmg}` : `${e.dmg}`,
              life: head ? 0.9 : 0.6, max: head ? 0.9 : 0.6,
              color: head ? '#ffd84a' : '#ffffff', big: head, pop: head ? 1.4 : 0.5,
            })
            if (this.texts.length > 80) this.texts.splice(0, this.texts.length - 80)
          }
          if (!hidden) {
            // 피는 쏜 방향으로 뿜어진다 (사방이 아니라) · 치명타는 금빛 불꽃이 더
            const n = head ? 14 : mine ? 6 : 2
            for (let k = 0; k < n; k++) {
              const spread = (Math.random() - 0.5) * 1.3
              const ca = Math.cos(spread)
              const sa = Math.sin(spread)
              const fx = dir.x * ca - dir.z * sa
              const fz = dir.x * sa + dir.z * ca
              const sp = (head ? 0.11 : 0.07) + Math.random() * 0.1
              const col = head ? (k % 3 === 0 ? 0xfff3c0 : k % 3 === 1 ? 0xffd84a : 0x8a1010) : k % 2 === 0 ? 0x7a1010 : 0x3a0a0a
              this.spawnParticle(e.x * U, 0.8, e.y * U, fx * sp, 0.04 + Math.random() * 0.09, fz * sp, 0.3 + Math.random() * 0.2, col, head ? 0.45 : 0.4)
            }
            // 바닥 핏자국: 내 치명타는 늘, 내 명중은 가끔 (쏜 방향 뒤쪽에)
            if (mine && (head || Math.random() < 0.25)) this.addBlood(e.x * U + dir.x * 0.5, e.y * U + dir.z * 0.5, head ? 0.36 : 0.22, head ? SPLAT_SPRAY : SPLAT_DROPS, dir)
            this.spawnImpact(e.x * U, 0.8, e.y * U, head ? 0xffd84a : 0xff5a4a, head ? 2.2 : 1.1)
            if (head) this.spawnRing(e.x * U, e.y * U, 0.3, 1.4, 0.35, 0xffd84a)
          }
          if (e.by === localPlayer) this.hud.hitMark(head)
          break
        }
        case 'mdeath': {
          // 쓰러짐 (손맛): 쏜 쪽 반대로 날아가 넘어진다 · 바닥에 큰 핏자국 · 내가 잡으면 펀치 · 정예·우두머리·보스는 섬광 · 충격파 · 역경직
          const dir = this.shotDir(state, e.by, e.x, e.y)
          const rank = MONSTER_LIST[e.kind]?.boss !== undefined ? 3 : this.monsterView.rank(e.m)
          const mineKill = e.by === localPlayer
          this.monsterView.died(e, dir.x, dir.z, rank >= 2 ? 1.2 : mineKill ? 2.6 : 1.6)
          if (mineKill) {
            this.punch = Math.max(this.punch, rank >= 1 ? 1 : 0.35)
            this.hud.killMark()
          }
          if (rank >= 1) {
            const big = rank >= 2
            const light = this.takeLight(big ? 0xffe0a0 : 0xffc870, big ? 40 : 22, big ? 14 : 8, 1.4)
            light.position.set(e.x * U, 1.4, e.y * U)
            this.flashes.push({ light, mesh: null, life: big ? 0.35 : 0.2 })
            this.spawnRing(e.x * U, e.y * U, 0.3, big ? 5 : 2.8, big ? 0.7 : 0.45, big ? 0xffe0a0 : 0xffc870)
            this.shake = Math.max(this.shake, big ? 0.55 : 0.3)
            if (mineKill || big) this.hitStop = Math.max(this.hitStop, big ? 0.14 : 0.07)
          }
          if (this.hiddenM.has(e.m)) break
          // 핏자국 (2026-09-24 — 동그라미 대신 미리 그린 모양 여덟 · blood.ts): 쓰러진 자리의 웅덩이 + 쏜 방향 뒤로 튄 자국
          if (e.kind !== 1) {
            this.addBlood(e.x * U + dir.x * 0.25, e.y * U + dir.z * 0.25, rank >= 1 ? 0.8 : 0.48, SPLAT_POOL)
            this.addBlood(e.x * U + dir.x * 0.85, e.y * U + dir.z * 0.85, rank >= 1 ? 0.7 : 0.42, SPLAT_SPRAY, dir)
          }
          // 검붉은 피 · 뼛조각이 튀고 바닥에 얼룩 링
          const bone = e.kind === 1
          for (let k = 0; k < 10; k++) {
            const a = Math.random() * Math.PI * 2
            const sp = 0.03 + Math.random() * 0.07
            const col = bone ? (k % 2 === 0 ? 0xd9d1bb : 0x8a8270) : k % 3 === 0 ? 0x2a0808 : k % 3 === 1 ? 0x6a1212 : 0x8a9478
            this.spawnParticle(e.x * U, 0.6, e.y * U, Math.cos(a) * sp, 0.08 + Math.random() * 0.1, Math.sin(a) * sp, 0.9, col, bone ? 0.8 : 0.7)
          }
          // 뼈 괴물만 먼지 고리 (피는 바닥 핏자국이 대신한다 — 붉은 동그라미가 어색했다)
          if (bone) this.spawnRing(e.x * U, e.y * U, 0.2, 1.1, 0.4, 0xd9d1bb)
          break
        }
        case 'swipe':
          this.monsterView.swiped(e.m)
          break
        case 'boom': {
          // 폭발: 붉은 섬광 + 파편 + 링 + 흔들림. 적의 범위 공격은 빨강(초록은 우리 편 좋은 효과 — 2026-09-23)
          const light = this.takeLight(0xff5a2a, 18, e.r * U * 3, 1.5)
          light.position.set(e.x * U, 1, e.y * U)
          this.flashes.push({ light, mesh: null, life: 0.18 })
          for (let k = 0; k < 14; k++) {
            const a = Math.random() * Math.PI * 2
            const sp = 0.05 + Math.random() * 0.1
            const col = k % 3 === 0 ? 0xff8a5a : k % 3 === 1 ? 0x8a4a3a : 0x4a2a1a
            this.spawnParticle(e.x * U, 0.6, e.y * U, Math.cos(a) * sp, 0.1 + Math.random() * 0.12, Math.sin(a) * sp, 0.55, col, 0.9)
          }
          this.spawnImpact(e.x * U, 0.8, e.y * U, 0xff7a4a, e.r * U * 2.4)
          this.spawnRing(e.x * U, e.y * U, 0.4, e.r * U, 0.45, ENEMY_AOE)
          const me = localPlayer >= 0 ? state.players[localPlayer] : null
          if (me && Math.hypot(me.x - e.x, me.y - e.y) < 500) this.shake = Math.max(this.shake, 0.3)
          break
        }
        case 'shotEnd':
          this.spawnImpact(e.x * U, 0.9, e.y * U, 0xff6a3a, 0.8)
          break
        case 'down': {
          const v = this.vis[e.p]
          if (v) {
            v.fall = 0
            v.flash = 0.3
            v.flashColor = 0xff3b30
          }
          this.spawnRing(e.x * U, e.y * U, 0.3, 1.6, 0.5, 0xff5a4a)
          this.hud.notice(`${nm[e.p]} 쓰러짐`, '#ff8a7a')
          if (e.p === localPlayer) this.shake = Math.max(this.shake, 0.35)
          break
        }
        case 'revive': {
          const v = this.vis[e.p]
          if (v) {
            v.fall = 0
            v.sx = 0.4
            v.sy = 1.5
          }
          this.spawnRing(e.x * U, e.y * U, 1.6, 0.2, 0.6, 0x9fe0ff)
          this.texts.push({ x: e.x * U, z: e.y * U, y: 1.9, text: '부활!', life: 1.0, max: 1.0, color: '#9fe0ff', big: true, pop: 1.2 })
          this.hud.notice(`${nm[e.by]} → ${nm[e.p]} 일으킴`, '#9fe0ff')
          break
        }
        case 'death': {
          const v = this.vis[e.p]
          v.deadT = 0
          v.fall = 0
          const c = CHARACTERS[state.players[e.p].char]
          for (let k = 0; k < 16; k++) {
            const a = Math.random() * Math.PI * 2
            const sp = 0.04 + Math.random() * 0.1
            this.spawnParticle(e.x * U, 1.0, e.y * U, Math.cos(a) * sp, 0.12 + Math.random() * 0.1, Math.sin(a) * sp, 1.3, c.bodyColor, 1.2)
          }
          this.spawnRing(e.x * U, e.y * U, 0.3, 2.2, 0.5, 0xffffff)
          if (state.mode === 'arena' && e.by >= 0) {
            if (e.p === localPlayer) this.lastKiller = e.by
            const revenge = localPlayer >= 0 && e.by === localPlayer && e.p === this.lastKiller
            if (revenge) this.lastKiller = -1
            this.hud.notice(`${nm[e.by]} → ${nm[e.p]}${revenge ? ' · 복수!' : ''}`, '#' + CHARACTERS[state.players[e.by].char].bodyColor.toString(16).padStart(6, '0'))
          } else this.hud.notice(e.out ? `${nm[e.p]} 탈락` : `${nm[e.p]} 사망 · 입구에서 다시 일어납니다`, e.out ? '#ff5a4a' : '#ffb0a4')
          this.shake = Math.max(this.shake, e.p === localPlayer ? 0.35 : 0.2)
          break
        }
        case 'respawn': {
          this.spawnRing(e.x * U, e.y * U, 1.6, 0.2, 0.6, 0x9fe0ff)
          const v = this.vis[e.p]
          v.sx = 0.3
          v.sy = 1.5
          v.deadT = -1
          break
        }
        case 'dash': {
          const v = this.vis[e.p]
          v.vsx += 0.35
          v.vsy -= 0.3
          break
        }
        case 'break': {
          this.world.breakSandbag(e.tx, e.ty)
          this.miniCanvas = null
          const cx = (e.tx + 0.5) * 1
          const cz = (e.ty + 0.5) * 1
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2
            const sp = 0.03 + Math.random() * 0.07
            this.spawnParticle(cx, 0.3, cz, Math.cos(a) * sp, 0.06 + Math.random() * 0.07, Math.sin(a) * sp, 0.7, 0xc7ad76, 0.9)
          }
          this.spawnRing(cx, cz, 0.2, 1.2, 0.4, 0xd6bc84)
          break
        }
        case 'drop': {
          this.spawnRing(e.x * U, e.y * U, 0.2, 1.1, 0.5, 0x7ef0a0)
          break
        }
        case 'heal': {
          // 체력은 물약처럼 틱마다 조금씩 차 소수가 남는다 — "가득 채우기" 회복량이 +37.4 처럼 보였다(2026-09-19) → 정수로, 1 미만은 띄우지 않는다
          const healed = Math.round(e.amount)
          if (healed < 1) break
          this.texts.push({ x: e.x * U, z: e.y * U, y: 1.7, text: `+${healed}`, life: 0.9, max: 0.9, color: '#7ef0a0', big: true })
          for (let i = 0; i < 8; i++) {
            const a = Math.random() * Math.PI * 2
            const sp = 0.02 + Math.random() * 0.05
            this.spawnParticle(e.x * U, 0.5, e.y * U, Math.cos(a) * sp, 0.07 + Math.random() * 0.05, Math.sin(a) * sp, 0.7, 0x7ef0a0, 0.7)
          }
          break
        }
        case 'blink': {
          // 그림자: 사라진 자리와 나타난 자리에 보랏빛 연기
          for (const [x, y] of [[e.x0, e.y0], [e.x, e.y]]) {
            for (let i = 0; i < 10; i++) {
              const a = Math.random() * Math.PI * 2
              const sp = 0.02 + Math.random() * 0.05
              this.spawnParticle(x * U, 0.6, y * U, Math.cos(a) * sp, 0.03 + Math.random() * 0.05, Math.sin(a) * sp, 0.6, 0x8a5ac0, 0.8)
            }
          }
          this.spawnRing(e.x * U, e.y * U, 0.2, 1.4, 0.4, 0xd89aff)
          break
        }
        case 'bossRage': {
          // 보스 분노 (체력 절반 · 군주는 2/3 · 1/3): 새로 쓰는 패턴을 알려 준다
          this.spawnRing(e.x * U, e.y * U, 0.5, 6, 1.0, 0xff5a2a)
          this.spawnImpact(e.x * U, 1.4, e.y * U, 0xff6a3a, 6)
          this.shake = Math.max(this.shake, 0.5)
          const id = MONSTER_LIST[e.kind]?.id
          const [t, sub] =
            id === 'butcher' ? ['도살자가 광분한다', '고기 비 — 발밑의 붉은 원에서 비켜라 · 더 빨라진다']
            : id === 'queen' ? ['거미 여왕이 분노한다', '거미줄이 아홉 갈래 · 도약을 두 번 · 새끼가 쏟아진다']
            : id === 'warden' ? ['관리인이 분노한다', '여진 — 퍼지는 고리는 이미 터진 안쪽으로 피하라']
            : e.stage >= 2 ? ['심연의 군주가 마지막 힘을 끌어올린다', '광선이 두 번 · 더 빠르고 더 자주']
            : ['심연의 군주가 분노한다', '그림자가 흘러나온다 · 지옥불 — 가까이가 먼저, 곧 멀리']
          this.hud.banner(t, sub, '#ff7a4a')
          break
        }
        case 'bzone':
          this.onBossBlast(e, state, localPlayer)
          // 즉사기가 터졌다: 크게 흔들린다
          if (e.kill) this.shake = Math.max(this.shake, 0.7)
          break
        case 'bossUlt': {
          // 막 보스 즉사기: 보스가 대사를 외치고(검붉은 큰 말풍선) · 화면 경고 · 흔들림 (경보음은 sfx)
          const pd = BOSS_PATS[e.pat]
          const ms = (e.t / 60) * 1000
          this.monsterSay(e.m, MONSTER_LIST[e.kind].name, pd?.line ?? '…', false, true, ms + 900)
          this.ultWarn = { name: pd?.name ?? '즉사기', hint: pd?.hint ?? '범위 밖으로', t0: performance.now(), until: performance.now() + ms }
          this.shake = Math.max(this.shake, 0.35)
          break
        }
        case 'ultHit':
          this.spawnRing(e.x * U, e.y * U, 0.2, 2.2, 0.6, 0xff2a1a)
          this.spawnImpact(e.x * U, 1, e.y * U, 0xff2a1a, 3)
          if (e.p === localPlayer) this.shake = Math.max(this.shake, 0.9)
          break
        case 'hook': {
          // 도살자 갈고리: 끌려온 길을 따라 핏빛 사슬
          for (let k = 0; k <= 10; k++) {
            const t = k / 10
            this.spawnParticle((e.x + (e.x2 - e.x) * t) * U, 0.9, (e.y + (e.y2 - e.y) * t) * U, 0, 0.01, 0, 0.35, k % 2 ? 0x8a3a2a : 0xc8b8a8, 0.55)
          }
          this.spawnRing(e.x2 * U, e.y2 * U, 0.1, 1, 0.3, ENEMY_AOE)
          break
        }
        case 'mblock': {
          // 방패병이 탄을 막았다: 쇳소리 불꽃
          for (let i = 0; i < 4; i++) {
            const a = Math.random() * Math.PI * 2
            const sp = 0.04 + Math.random() * 0.08
            this.spawnParticle(e.x * U, GUN_H, e.y * U, Math.cos(a) * sp, 0.05 + Math.random() * 0.06, Math.sin(a) * sp, 0.25, 0xffe0a0, 0.6)
          }
          this.spawnImpact(e.x * U, GUN_H, e.y * U, 0xffd080, 0.9)
          break
        }
        case 'block': {
          for (let i = 0; i < 5; i++) {
            const a = Math.random() * Math.PI * 2
            const sp = 0.04 + Math.random() * 0.08
            this.spawnParticle(e.x * U, GUN_H, e.y * U, Math.cos(a) * sp, 0.05 + Math.random() * 0.06, Math.sin(a) * sp, 0.3, 0xbfd8ff, 0.7)
          }
          this.texts.push({ x: e.x * U, z: e.y * U, y: 1.6, text: '막음', life: 0.5, max: 0.5, color: '#9fe0ff', big: false })
          this.spawnImpact(e.x * U, GUN_H, e.y * U, 0x9fe0ff, 1.3)
          break
        }
        case 'over':
          this.hud.showOver()
          break
        default:
          break
      }
    }
  }

  private streakMat(color: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      map: this.streakTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  }

  /** 빛줄기 하나: 바닥과 나란한 판 + 세로 판. 길이는 x, 폭은 y·z 스케일 */
  private makeStreak(): THREE.Group {
    const g = new THREE.Group()
    const flat = new THREE.Mesh(this.streakGeo, this.streakMats.default)
    flat.rotation.x = -Math.PI / 2
    const up = new THREE.Mesh(this.streakGeo, this.streakMats.default)
    g.add(flat, up)
    return g
  }

  /** 명중·벽·막음 섬광: 카메라를 보는 빛무리가 커지면서 사라진다 */
  private spawnImpact(x: number, y: number, z: number, color: number, size: number): void {
    if (this.impacts.length >= IMPACT_MAX) this.endImpact(0)
    let sprite = this.impactPool.pop()
    if (!sprite) sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    const mat = sprite.material
    mat.color.setHex(color)
    mat.opacity = 1
    sprite.position.set(x, y, z)
    sprite.scale.setScalar(size * 0.5)
    this.scene.add(sprite)
    this.impacts.push({ sprite, life: 0.14, max: 0.14, size })
  }

  private spawnFlash(pos: THREE.Vector3, size: number): void {
    const light = this.takeLight(0xffc860, 6 * size, 5, 2)
    light.position.copy(pos)
    // 구 도형 · 재질은 하나를 같이 쓴다 (예전에는 한 발마다 새로 만들고 해제하지 않았다)
    const mesh = this.flashMeshPool.pop() ?? new THREE.Mesh(this.flashGeo, this.flashMat)
    mesh.position.copy(pos)
    mesh.scale.setScalar(size)
    this.scene.add(mesh)
    this.flashes.push({ light, mesh, life: 0.06 })
  }

  /** 순간 빛 하나 (모아 둔 것을 다시 쓴다) */
  private takeLight(color: number, intensity: number, distance: number, decay: number): THREE.PointLight {
    const l = this.lightPool.pop() ?? new THREE.PointLight()
    l.color.setHex(color)
    l.intensity = intensity
    l.distance = distance
    l.decay = decay
    l.visible = true
    this.scene.add(l)
    return l
  }

  private endFlash(i: number): void {
    const f = this.flashes[i]
    this.scene.remove(f.light)
    this.lightPool.push(f.light)
    if (f.mesh) {
      this.scene.remove(f.mesh)
      this.flashMeshPool.push(f.mesh)
    }
    this.flashes.splice(i, 1)
  }

  private endImpact(i: number): void {
    const im = this.impacts[i]
    this.scene.remove(im.sprite)
    this.impactPool.push(im.sprite)
    this.impacts.splice(i, 1)
  }

  private endRing(i: number): void {
    const r = this.rings[i]
    this.scene.remove(r.mesh)
    ;(r.thin ? this.thinPool : this.ringPool).push(r.mesh)
    this.rings.splice(i, 1)
  }

  private spawnParticle(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: number, size: number): void {
    // 넘치면 가장 오래된 것 자리에 (배열 앞쪽이 대체로 오래됐다)
    if (this.particles.length >= PART_MAX) this.particles.shift()
    const c = this.tmpColor.setHex(color)
    this.particles.push({
      x, y, z, rx: Math.random() * 3, rz: Math.random() * 3, size, r: c.r, g: c.g, b: c.b,
      vx, vy, vz, life, max: life, gravity: 0.35, spin: (Math.random() - 0.5) * 8,
    })
  }

  private spawnRing(x: number, z: number, r0: number, r1: number, life: number, color: number, thin = false, peak = 0.9): void {
    if (this.rings.length >= RING_MAX) this.endRing(0)
    // 도형은 하나를 같이 쓰고, 재질(색 · 투명도가 고리마다 다르다)은 고리와 같이 모아 둔다
    const pool = thin ? this.thinPool : this.ringPool
    const mesh = pool.pop() ?? new THREE.Mesh(thin ? this.thinRingGeo : this.ringGeo, new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }))
    const rm = mesh.material as THREE.MeshBasicMaterial
    rm.color.setHex(color)
    rm.opacity = peak
    mesh.scale.setScalar(r0)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.02, z)
    this.scene.add(mesh)
    this.rings.push({ mesh, life, max: life, r0, r1, peak, thin })
  }

  private spawnSlash(x: number, z: number, aim: number, w: WeaponDef): void {
    let geo = this.slashGeo.get(w.id)
    if (!geo) {
      const range = ((w.meleeRange ?? 60) + 12) * U
      const half = ((w.meleeArc ?? 150) / 1024) * Math.PI * 2
      // 휘두르기는 바깥쪽 얇은 호(칼끝이 지나간 자리), 장검은 찌르는 쐐기
      const inner = range * (w.family === 'rapier' ? 0.3 : 0.74)
      geo = new THREE.RingGeometry(inner, range, 20, 1, -half, half * 2)
      geo.rotateX(-Math.PI / 2)
      this.slashGeo.set(w.id, geo)
    }
    const color = w.family === 'violin' ? 0xff7a5a : w.family === 'rapier' ? 0xeaf4ff : 0xffe2a0
    // 재질은 모아 두었다가 다시 쓴다 (2026-09-23): 휘두를 때마다 만들고 0.14초 뒤 해제했더니, 그 셰이더를 쓰는 재질이
    // 하나도 안 남는 순간 three 가 셰이더 프로그램까지 지워 다음 휘두르기에서 다시 컴파일했다(한 번에 100~150ms 멈춤)
    const mesh = this.slashPool.pop() ?? new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }))
    mesh.geometry = geo
    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.color.setHex(color)
    mat.opacity = 0.6
    mesh.scale.setScalar(1)
    mesh.position.set(x, 0.45, z)
    // 링 조각은 +x 가 가운데, 바닥에 눕히면 각이 -z 쪽으로 돈다 → y 축으로 -aim 만큼 돌리면 조준 방향
    mesh.rotation.y = -aim
    this.scene.add(mesh)
    this.slashes.push({ mesh, life: 0.14, max: 0.14 })
  }

  /** 막마다 나오는 괴물 종류 (막 무리 + 그 막 지역의 무리 · 우두머리 · 보스) — 모델 미리 받기용 */
  private static actKinds(act: number): number[] {
    const set = new Set<number>()
    for (const p of ACTS[act]?.packs ?? []) for (const g of p.groups) set.add(g[0])
    for (const a of AREAS) {
      if (a.act !== act) continue
      for (const p of a.packs ?? []) for (const g of p.groups) set.add(g[0])
      if (a.boss !== undefined) set.add(a.boss)
      if (a.unique) set.add(a.unique.kind)
    }
    return [...set]
  }

  // ---------- 프레임 ----------
  draw(prev: GameState, curr: GameState, alpha: number, dt: number, opts: RenderOptions): void {
    this.lastCurr = curr
    // 빛 상한으로 지난 프레임에 끈 빛을 먼저 되살린다 — 그 뒤 각자(등불 · 장판 …)가 제 켜짐을 정하고, padLights 가 다시 잰다
    for (const l of this.capped) l.visible = true
    this.capped.length = 0
    this.ensureRigs(curr)
    // 던전: 새 막에 들어서면 그 막 괴물의 실사 모델을 미리 받아 둔다 (마을에 있는 동안 받는다)
    if (curr.mode === 'dungeon') {
      const me = curr.players[opts.viewer ?? opts.localPlayer]
      const act = me ? areaDef(me.area).act : -1
      if (act >= 0 && act !== this.prefetchedAct) {
        this.prefetchedAct = act
        const kinds = Renderer3D.actKinds(act)
        // 앞 막 괴물의 모델은 내려놓는다 (GPU 메모리 — 되돌아가면 다시 굽는다)
        this.monsterView.release(new Set(kinds))
        this.monsterView.prefetch(kinds)
      }
    }
    // 역경직: 내 치명타 · 처치 · 정예·보스 쓰러짐에 연출(입자 · 괴물 몸짓)을 잠깐 거의 멈춘다 — sim 은 그대로 (그림만)
    const ts = (opts.timeScale ?? 1) * (this.hitStop > 0 ? 0.08 : 1)
    this.hitStop = Math.max(0, this.hitStop - dt)
    this.lastDt = dt
    const viewer = opts.viewer ?? opts.localPlayer
    this.scoped =
      viewer >= 0 &&
      curr.players[viewer].alive &&
      curr.players[viewer].ads &&
      WEAPONS[curr.players[viewer].weapon].scope === true
    this.t += dt
    const sdt = dt * ts
    this.updateEffects(sdt)

    const n = curr.players.length
    const pos: { x: number; z: number }[] = []
    for (let i = 0; i < n; i++) {
      const a = prev.players[i]
      const b = curr.players[i]
      if (!a || !b.alive || b.aliveTicks <= 1) pos.push({ x: b.x * U, z: b.y * U })
      else pos.push({ x: (a.x + (b.x - a.x) * alpha) * U, z: (a.y + (b.y - a.y) * alpha) * U })
    }
    // 화면 위치 스무딩: 순간이동을 없앤다
    if (this.dispPos.length !== n) this.dispPos = pos.map((p) => ({ x: p.x, z: p.z }))
    for (let i = 0; i < n; i++) {
      const p = curr.players[i]
      const d = this.dispPos[i]
      const dx = pos[i].x - d.x
      const dz = pos[i].z - d.z
      const dist = Math.hypot(dx, dz)
      // 리스폰·난입·순간이동은 그대로 붙인다 (2타일 넘게 벌어지면 따라잡을 이유가 없다)
      if (!p.alive || p.aliveTicks <= 2 || dist > 2) {
        d.x = pos[i].x
        d.z = pos[i].z
      } else if (dist > 0.0001) {
        // 캐릭터 최고 속도(약 3.7px/tick ≈ 7타일/초)보다 넉넉히 빠른 상한
        const maxStep = Math.max(0.02, 11 * dt)
        const k = Math.min(1, maxStep / dist)
        d.x += dx * k
        d.z += dz * k
      }
      pos[i] = { x: d.x, z: d.z }
    }
    this.updateSandbags(curr)
    this.updateVision(curr, opts)
    this.announceBoss(curr)
    for (let i = 0; i < n; i++) this.updateRig(i, curr.players[i], pos[i], sdt)
    // 응원 아군 괴물은 괴물과 같은 표에 초록으로 그린다 (sim 에서는 따로 — core/state.ts Ally)
    this.monsterView.update(withAllies(prev), withAllies(curr), alpha, sdt, (m) => this.hiddenM.has(m.id))
    this.updateBullets(prev, curr, alpha)
    this.updateShots(prev, curr, alpha)
    this.updateGlobes(curr)
    this.updateDrops(curr, opts.localPlayer)
    this.updateMarkers(curr, opts.localPlayer)
    this.updatePortals(curr)
    this.updateObjects(curr)
    this.updateZones(curr, opts.localPlayer)
    this.updateThrows(curr)
    this.updateAuras(curr, pos)
    this.updateLanterns(curr, pos)
    this.updateGiantLight(curr)
    this.updateCamera(curr, pos, dt, opts)
    this.world.update(this.t, this.camTarget.x, this.camTarget.z)
    this.padLights()

    this.gl.render(this.scene, this.camera)

    // HUD
    this.hud.begin(dt)
    const st: ScreenText[] = this.texts.map((t) => {
      const p = this.worldToScreen(t.x, t.y + (1 - t.life / t.max) * 0.8, t.z)
      const k = t.life / t.max
      // 막 뜰 때 크게 튀었다가 제 크기로 (덕코프 숫자 느낌). 헤드샷은 더 크게 튄다
      return { x: p.x, y: p.y, text: t.text, k, color: t.color, big: t.big, scale: 1 + (t.pop ?? 0.8) * Math.max(0, (k - 0.72) / 0.28) }
    })
    this.drawMonsterBars(curr)
    this.drawAllyTags(curr)
    this.drawUltWarn()
    this.drawOrphanSays(curr)
    this.drawDropLabels(curr, opts.localPlayer)
    this.drawPlaceLabels(curr, opts.localPlayer)
    this.hud.drawTexts(st)
    this.drawPings()
    this.drawMarkArrows()
    this.drawNameTags(curr, pos, opts)
    this.hud.drawVignette()
    if (this.scoped && opts.cursor) {
      const me = pos[opts.localPlayer]
      this.drawScope(opts.cursor, this.worldToScreen(me.x, 0.6, me.z))
    }
    // 커서가 몬스터의 약점 위에 있는가 (보이는 것만) → 조준선 금색 = 지금 쏘면 치명타
    let cursorOn = false
    if (opts.cursor && opts.localPlayer >= 0 && curr.players[opts.localPlayer]?.alive) {
      const w = this.aimPoint(opts.cursor.x, opts.cursor.y, curr, curr.players[opts.localPlayer])
      for (const m of curr.monsters) {
        if (m.hp <= 0 || this.hiddenM.has(m.id)) continue
        if (Math.hypot(w.x - m.x, w.y - m.y) <= bodyR(m) * HEAD_AIM_FRAC) {
          cursorOn = true
          break
        }
      }
      const me = curr.players[opts.localPlayer]
      if (!cursorOn && curr.mode === 'arena') {
        for (const p of curr.players) {
          if (p.id === me.id || !p.alive || p.left || this.hidden[p.id] || p.team === me.team) continue
          if (Math.hypot(w.x - p.x, w.y - p.y) <= PLAYER_RADIUS * HEAD_AIM_FRAC * headHitScale(p.char)) {
            cursorOn = true
            break
          }
        }
      }
    }
    this.drawDowned(curr, pos, opts)
    this.drawDownedNav(curr, pos, opts)
    this.hud.drawMain(curr, { ...opts, cursorOn })
    if (opts.showHud) this.drawMinimap(curr, opts)
    if (opts.showHud && this.mapOpen && curr.mode === 'dungeon') this.drawFullMap(curr, opts)
  }

  /** 모래주머니가 닳으면 색이 어두워진다 (곧 터진다는 신호) */
  private updateSandbags(curr: GameState): void {
    for (const key in curr.sandbags) {
      const i = Number(key)
      const k = Math.round((curr.sandbags[i] / SANDBAG_HP) * 5) / 5
      if (this.bagShown.get(i) === k) continue
      this.bagShown.set(i, k)
      this.world.setSandbagHealth(i % this.map.w, Math.floor(i / this.map.w), k)
    }
  }

  /** 시야: 나(와 아군)가 보는 곳만 밝히고, 그 밖의 적은 숨긴다. 관전(-1)이나 fog:false 면 전부 보인다 */
  /**
   * 보스 등장 (2026-09-19): 막 보스가 깨어나 처음 눈에 들어오면 이름 배너 · 한 줄 소개 · 화면 흔들림 · 카메라 펀치.
   * 깨어남 이벤트(wake)에는 종류가 없어서, 그리는 쪽이 "깨어 있고 보이는 보스" 를 처음 볼 때 한 번만 알린다.
   */
  private announceBoss(curr: GameState): void {
    if (curr.mode !== 'dungeon') return
    for (const m of curr.monsters) {
      const def = MONSTER_LIST[m.kind]
      if (!def.boss || m.sum !== undefined || m.st === 0 || m.hp <= 0 || this.bossSeen.has(m.id) || this.hiddenM.has(m.id)) continue
      this.bossSeen.add(m.id)
      this.hud.banner(def.name, BOSS_INTRO[def.id] ?? '', '#ff8a5a')
      // 보스 방의 보스는 먼저 맞기 전에는 가만히 있다(v0.61.0) — 처음 온 사람은 모른다 (2026-09-25 사용자 고른 개선 2)
      if (isGiant(m) && m.hitTick < 0) this.hud.notice('보스는 먼저 공격하기 전에는 움직이지 않는다 — 자리를 잡고, 준비되면 공격', '#ffcf6a', 5)
      this.shake = Math.max(this.shake, 0.55)
      this.punch = Math.max(this.punch, 1)
    }
  }

  private updateVision(curr: GameState, opts: RenderOptions): void {
    const lp = opts.viewer ?? opts.localPlayer
    const fog = (opts.fog ?? true) && lp >= 0
    this.vision.setVisible(fog)
    const n = curr.players.length
    if (this.hidden.length !== n) this.hidden = curr.players.map(() => false)
    if (!fog) {
      this.hidden.fill(false)
      this.hiddenM.clear()
      return
    }
    const me = curr.players[lp]
    const viewers: Viewer[] = []
    for (const p of curr.players) {
      if (p.team !== me.team || !p.alive || p.left) continue
      viewers.push({ x: p.x, y: p.y })
    }
    if (viewers.length > 0) this.lastViewer = { x: me.alive ? me.x : viewers[0].x, y: me.alive ? me.y : viewers[0].y }
    else if (this.lastViewer) viewers.push(this.lastViewer) // 죽어 있는 동안은 마지막 자리에서 본다
    // 후원 "암흑" (core/donate.ts): 보는 사람에게 걸려 있으면 코앞만 보인다 — 동료 시야도 같이 좁힌다(함께 보면 암흑이 풀려 버린다)
    const dark = (me.don?.[DON_DARK] ?? 0) > 0
    const radius = dark ? DARK_VIEW_TILES : VIEW_RADIUS_TILES * (this.scoped ? 1.8 : 1)
    this.vision.update(viewers, radius)
    this.vision.draw(this.gl)
    if (this.seenT.length !== n) this.seenT = curr.players.map(() => 0)
    // 몬스터: 시야 안(벽에 가리지 않고 반경 안)일 때만 그린다. 경계에서 깜빡이지 않게 0.22초 남긴다
    const rpx = radius * 32
    const live = new Set<number>()
    for (const m of curr.monsters) {
      live.add(m.id)
      let near = false
      // 거대한 보스는 몸 가장자리 넷도 본다 — 가운데만 보면 결투장 둘레 벽 뒤로 가운데가 숨는 순간 온몸이 사라졌다
      // (2026-09-24 사용자: "도살자가 갑자기 맵에서 없어진다")
      const br = isGiant(m) ? bodyR(m) : 0
      for (const v of viewers) {
        if ((m.x - v.x) ** 2 + (m.y - v.y) ** 2 <= (rpx + 40 + br) ** 2) {
          near = true
          break
        }
      }
      const seeAt = (x: number, y: number) => canSee(this.map, viewers, x, y, rpx + br)
      const vis =
        m.mark > 0 ||
        (near && (seeAt(m.x, m.y) || (br > 0 && (seeAt(m.x + br, m.y) || seeAt(m.x - br, m.y) || seeAt(m.x, m.y + br) || seeAt(m.x, m.y - br)))))
      const t = vis ? 0.22 : Math.max(0, (this.seenM.get(m.id) ?? 0) - this.lastDt)
      this.seenM.set(m.id, t)
      if (t > 0) this.hiddenM.delete(m.id)
      else this.hiddenM.add(m.id)
    }
    for (const id of this.seenM.keys()) {
      if (!live.has(id)) {
        this.seenM.delete(id)
        this.hiddenM.delete(id)
      }
    }
    for (let i = 0; i < n; i++) {
      const p = curr.players[i]
      if (!p.alive || p.left) {
        // 죽어 있는 동안은 '보였다' 는 기억을 지운다.
        // 안 그러면 죽기 직전의 기억(0.22초)이 남아, **리스폰하는 순간 새 자리가 미니맵에 잠깐 드러난다.**
        this.seenT[i] = 0
        this.hidden[i] = true
        continue
      }
      const visible = p.team === me.team || canSee(this.map, viewers, p.x, p.y, radius * 32)
      // 경계에서 깜빡이지 않도록 잠깐 남긴다
      if (visible) this.seenT[i] = 0.22
      else this.seenT[i] = Math.max(0, this.seenT[i] - this.lastDt)
      this.hidden[i] = this.seenT[i] <= 0
    }
  }

  /** 저격 조준경: 커서 둘레만 남기고 어둡게 + 십자선 */
  private drawScope(cur: { x: number; y: number }, self: { x: number; y: number }): void {
    const ctx = this.hud.ctx
    // 구멍은 월드 넓이에 묶인다 — 논리 높이가 커져도 보이는 땅이 같게 VIEW_K 를 곱한다
    const r = 210 * VIEW_K
    // 내 주변에도 구멍을 낸다 — 조준경을 켠 채로도 붙는 적을 볼 수 있게
    const rs = 132 * VIEW_K
    const DARK = 'rgba(4,6,4,0.85)'
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, VIEW_W, VIEW_H)
    ctx.arc(cur.x, cur.y, r, 0, Math.PI * 2, true)
    ctx.moveTo(self.x + rs, self.y)
    ctx.arc(self.x, self.y, rs, 0, Math.PI * 2, true)
    ctx.fillStyle = DARK
    ctx.fill('evenodd')
    ctx.restore()
    for (const [cx, cy, rad, inner] of [
      [cur.x, cur.y, r, 0.6],
      [self.x, self.y, rs, 0.45],
    ] as const) {
      const g = ctx.createRadialGradient(cx, cy, rad * inner, cx, cy, rad)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, DARK)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, rad, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(20,24,18,0.95)'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(cur.x, cur.y, r + 2, 0, Math.PI * 2)
    ctx.stroke()
    // 발사 섬광: 조준경 테두리가 금빛으로 번쩍이고 안쪽이 하얗게 밝아진다 — 쐈다는 걸 눈으로 알게
    if (this.scopeFlash > 0) {
      const f = this.scopeFlash
      ctx.strokeStyle = `rgba(255,214,90,${(0.9 * f).toFixed(3)})`
      ctx.lineWidth = 6 + 10 * f
      ctx.beginPath()
      ctx.arc(cur.x, cur.y, r + 2, 0, Math.PI * 2)
      ctx.stroke()
      const g2 = ctx.createRadialGradient(cur.x, cur.y, 0, cur.x, cur.y, r)
      g2.addColorStop(0, `rgba(255,245,210,${(0.35 * f).toFixed(3)})`)
      g2.addColorStop(1, 'rgba(255,245,210,0)')
      ctx.fillStyle = g2
      ctx.beginPath()
      ctx.arc(cur.x, cur.y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    // 십자선
    ctx.strokeStyle = 'rgba(220,230,210,0.75)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cur.x - r, cur.y)
    ctx.lineTo(cur.x - 16, cur.y)
    ctx.moveTo(cur.x + 16, cur.y)
    ctx.lineTo(cur.x + r, cur.y)
    ctx.moveTo(cur.x, cur.y - r)
    ctx.lineTo(cur.x, cur.y - 16)
    ctx.moveTo(cur.x, cur.y + 16)
    ctx.lineTo(cur.x, cur.y + r)
    ctx.stroke()
    // 눈금
    ctx.strokeStyle = 'rgba(220,230,210,0.55)'
    for (let i = 1; i <= 4; i++) {
      const y = cur.y + i * 26
      const half = 10 - i
      ctx.beginPath()
      ctx.moveTo(cur.x - half, y)
      ctx.lineTo(cur.x + half, y)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(220,230,210,0.9)'
    ctx.beginPath()
    ctx.arc(cur.x, cur.y, 1.6, 0, Math.PI * 2)
    ctx.fill()
  }

  /** 왼쪽 위 미니맵 */
  /**
   * 미니맵 (2026-09-05 재설계): 전체 맵이 아니라 **내 주변만**, 실제 화면과 같은 방향으로 돌린 네모 창.
   * 전에는 맵 전체를 위에서 본 그림이라 "화면에서 위" 와 "미니맵에서 위" 가 45° 어긋나 방향을 한 번 머리로 돌려야 했다.
   * 지금은 월드 방향 → 화면 방향과 같은 회전(카메라 요)을 미니맵에도 걸고, 나를 가운데 둔다.
   * 관전 중이면 보고 있는 사람이 가운데.
   */
  private drawMinimap(curr: GameState, opts: RenderOptions): void {
    const map = this.map
    if (!this.miniCanvas) this.miniCanvas = renderMapTiles(map)
    const ctx = this.hud.ctx
    const S = MINIMAP_SIZE
    // 디아블로 4 처럼 오른쪽 위 (그 아래에 목표 추적이 붙는다)
    const x = VIEW_W - 16 - S
    const y = 16
    const cx = x + S / 2
    const cy = y + S / 2
    const lp = opts.localPlayer
    const viewer = opts.viewer ?? lp
    const center = viewer >= 0 ? curr.players[viewer] : null
    // 가운데: 보는 사람. 없으면(시네마틱) 맵 가운데
    const mx = center ? center.x / TILE : map.w / 2
    const my = center ? center.y / TILE : map.h / 2
    // 화면 방향과 맞추는 회전: 월드 +x 가 화면에서 어느 쪽인지
    const d = worldDirToScreen(1, 0)
    const rot = Math.atan2(d.y, d.x)
    ctx.save()
    // 테두리: 쇠 바탕 + 금선 두 겹 (한 줄짜리 얇은 테는 싸구려로 보인다 — 2026-09-20)
    const frame = ctx.createLinearGradient(0, y - 6, 0, y + S + 6)
    frame.addColorStop(0, 'rgba(30,25,20,0.92)')
    frame.addColorStop(1, 'rgba(10,9,8,0.92)')
    ctx.fillStyle = frame
    roundRect(ctx, x - 7, y - 7, S + 14, S + 14, 10)
    ctx.fill()
    ctx.strokeStyle = 'rgba(201,162,74,0.55)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.strokeStyle = 'rgba(241,213,138,0.22)'
    ctx.lineWidth = 1
    roundRect(ctx, x - 3, y - 3, S + 6, S + 6, 7)
    ctx.stroke()
    // 네 모서리 마름모
    ctx.fillStyle = 'rgba(201,162,74,0.7)'
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const px = x - 7 + dx * (S + 14)
      const py = y - 7 + dy * (S + 14)
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(Math.PI / 4)
      ctx.fillRect(-2.6, -2.6, 5.2, 5.2)
      ctx.restore()
    }
    // 네모 창 안만 그린다
    ctx.beginPath()
    roundRect(ctx, x, y, S, S, 6)
    ctx.clip()
    ctx.fillStyle = '#05070a'
    ctx.fillRect(x, y, S, S)
    ctx.translate(cx, cy)
    ctx.rotate(rot)
    ctx.scale(MINIMAP_PX_PER_TILE, MINIMAP_PX_PER_TILE)
    ctx.translate(-mx, -my)
    ctx.globalAlpha = 0.92
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this.miniCanvas, 0, 0, map.w, map.h)
    // 바닥이 너무 밝아 어두운 던전 화면에서 종이처럼 떴다 → 갈색 어둠을 한 겹 덮는다 (2026-09-20)
    ctx.globalAlpha = 0.42
    ctx.fillStyle = '#140e08'
    ctx.fillRect(0, 0, map.w, map.h)
    ctx.globalAlpha = 1
    const rp = 1 / MINIMAP_PX_PER_TILE // 타일 좌표계에서 1px
    // 보이는 몬스터: 작은 빨간 점 (잠든 것은 어둡게)
    for (const m of curr.monsters) {
      if (m.hp <= 0 || (this.hiddenM.has(m.id) && lp >= 0)) continue
      ctx.fillStyle = m.st === 0 ? '#7a3a34' : '#ff5a4a'
      ctx.fillRect(m.x / TILE - 1.6 * rp, m.y / TILE - 1.6 * rp, 3.2 * rp, 3.2 * rp)
    }
    for (let i = 0; i < curr.players.length; i++) {
      const p = curr.players[i]
      if (!p.alive || p.left) continue
      const mine = i === lp
      const ally = !mine && lp >= 0 && p.team === curr.players[lp].team
      if (!mine && !ally && this.hidden[i] && lp >= 0) continue // 투기장: 안 보이는 적은 미니맵에도 없다
      const px = p.x / TILE
      const py = p.y / TILE
      ctx.fillStyle = p.downed ? '#ff8a7a' : mine ? '#ffd84a' : ally ? '#5aa9ff' : '#ff5a4a'
      ctx.beginPath()
      ctx.arc(px, py, (mine ? 3.6 : 3) * rp, 0, Math.PI * 2)
      ctx.fill()
      if (mine || ally) {
        const r = angleToRad(p.aim)
        ctx.strokeStyle = mine ? '#ffd84a' : '#5aa9ff'
        ctx.lineWidth = 1.6 * rp
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(px + Math.cos(r) * 10 * rp, py + Math.sin(r) * 10 * rp)
        ctx.stroke()
      }
    }
    // 팀 신호(V): 초록 마름모. 미니맵을 주변만 보여 주게 바꾼 뒤로는 창 밖이면 아래 화면 가장자리 화살표가 맡는다 (2026-09-05)
    for (const m of this.marks) {
      const r = 3.2 * rp
      ctx.globalAlpha = Math.min(1, m.life * 2)
      ctx.fillStyle = '#7ee0a0'
      ctx.beginPath()
      ctx.moveTo(m.x, m.z - r)
      ctx.lineTo(m.x + r, m.z)
      ctx.lineTo(m.x, m.z + r)
      ctx.lineTo(m.x - r, m.z)
      ctx.closePath()
      ctx.fill()
    }
    ctx.globalAlpha = 1
    // 회복 구슬: 분홍 점 · 힐팩(투기장): 흰 네모에 빨간 십자
    for (const g of curr.globes) {
      if (g.share) {
        ctx.fillStyle = '#ff7a8a'
        ctx.beginPath()
        ctx.arc(g.x / TILE, g.y / TILE, 2.4 * rp, 0, Math.PI * 2)
        ctx.fill()
      } else {
        const px = g.x / TILE
        const py = g.y / TILE
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(px - 2.4 * rp, py - 2.4 * rp, 4.8 * rp, 4.8 * rp)
        ctx.fillStyle = '#f25c4c'
        ctx.fillRect(px - 0.7 * rp, py - 1.7 * rp, 1.4 * rp, 3.4 * rp)
        ctx.fillRect(px - 1.7 * rp, py - 0.7 * rp, 3.4 * rp, 1.4 * rp)
      }
    }
    // 출구(주황 네모 — 디아블로도 지역 출구는 지도에 보인다) · 웨이포인트(푸른 마름모) · 타운 포털(푸른 원)
    if (curr.mode === 'dungeon' && curr.curArea >= 0) {
      const l = areaLayout(curr.curArea, this.map)
      for (const e of l.exits) {
        ctx.strokeStyle = isTown(e.to) ? '#ffd88a' : '#ff9a5a'
        ctx.lineWidth = 2 * rp
        ctx.strokeRect(e.x / TILE - 3 * rp, e.y / TILE - 3 * rp, 6 * rp, 6 * rp)
      }
      if (l.wp) {
        ctx.fillStyle = '#7ab8ff'
        ctx.beginPath()
        ctx.moveTo(l.wp.x / TILE, l.wp.y / TILE - 3.5 * rp)
        ctx.lineTo(l.wp.x / TILE + 3.5 * rp, l.wp.y / TILE)
        ctx.lineTo(l.wp.x / TILE, l.wp.y / TILE + 3.5 * rp)
        ctx.lineTo(l.wp.x / TILE - 3.5 * rp, l.wp.y / TILE)
        ctx.fill()
      }
      for (const q of curr.portals) {
        const at = isTown(curr.curArea) ? townPortalSpot(l, q.owner) : q.area === curr.curArea ? q : null
        if (!at) continue
        ctx.strokeStyle = '#5a8cff'
        ctx.lineWidth = 2 * rp
        ctx.beginPath()
        ctx.arc(at.x / TILE, at.y / TILE, 3 * rp, 0, Math.PI * 2)
        ctx.stroke()
      }
      // 마을 NPC (2026-09-20 요청): 종류마다 다른 색 점. 촌장은 맡거나 보고할 것이 있으면 노란 테가 깜빡인다
      const meQ = elderMarks(lp >= 0 ? curr.players[lp]?.quests ?? [] : [])
      for (const n of townNpcs(curr.curArea)) {
        const busy = n.id === 'elder' && (meQ.offer || meQ.report)
        const r = (busy ? 4 : 3.2) * rp
        ctx.beginPath()
        ctx.arc(n.x / TILE, n.y / TILE, r, 0, Math.PI * 2)
        ctx.fillStyle = NPC_DOT[n.id] ?? '#e8d6a8'
        ctx.fill()
        // 바닥색에 묻히지 않게 테두리
        ctx.strokeStyle = 'rgba(8,7,6,0.85)'
        ctx.lineWidth = 1.2 * rp
        ctx.stroke()
        if (busy) {
          ctx.strokeStyle = '#ffd84a'
          ctx.lineWidth = 1.4 * rp
          ctx.beginPath()
          ctx.arc(n.x / TILE, n.y / TILE, r + (2 + Math.sin(this.t * 4) * 1.2) * rp, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
    }
    // 단군란 패시브(중계): 시야 밖 총성 위치를 미니맵에도 찍는다(창 안이면). 화면 가장자리 화살표만으로는
    // 방향은 알아도 거리를 모른다 (2026-09-05 요청). 좌표는 이미 타일 단위(x·U)
    for (const g of this.pings) {
      const k = 1 - g.life / g.max
      ctx.globalAlpha = Math.min(1, g.life * 2)
      ctx.strokeStyle = '#ffd84a'
      ctx.lineWidth = 1.5 * rp
      ctx.beginPath()
      ctx.arc(g.x, g.z, (3.5 + k * 6) * rp, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#ff5a4a'
      ctx.beginPath()
      ctx.arc(g.x, g.z, 3 * rp, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.restore()
    // 창 테두리 안쪽 십자 눈금 (가운데가 나라는 표시)
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - 6, cy)
    ctx.lineTo(cx + 6, cy)
    ctx.moveTo(cx, cy - 6)
    ctx.lineTo(cx, cy + 6)
    ctx.stroke()
    ctx.restore()
    this.drawMiniMates(curr, opts, x, y, S, mx, my, rot)
  }

  /**
   * 미니맵의 동료 (2026-09-24 사용자: "미니맵에 동료 이름표 · 미니맵 밖에 있고 같은 맵에 있으면 화살표로 방향 · 쓰러진 동료는 빨간색으로"):
   * 창 안이면 점 위에 이름, 창 밖이면 창 가장자리에 그쪽을 가리키는 화살표 + 이름. 쓰러진 동료는 빨갛게 깜빡인다.
   * 같은 지역만 (다른 지역의 사람은 areaView 에서 left). 회전 · 배율은 drawMinimap 과 같다
   */
  private drawMiniMates(curr: GameState, opts: RenderOptions, x: number, y: number, S: number, mx: number, my: number, rot: number): void {
    const lp = opts.localPlayer
    if (lp < 0 || curr.mode !== 'dungeon') return
    const ctx = this.hud.ctx
    const cx = x + S / 2
    const cy = y + S / 2
    const cr = Math.cos(rot)
    const sr = Math.sin(rot)
    const pulse = 0.55 + 0.45 * Math.sin(this.t * 7)
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.lineWidth = 3
    for (let i = 0; i < curr.players.length; i++) {
      const p = curr.players[i]
      if (i === lp || !p.alive || p.left || p.cameo) continue
      const dx = (p.x / TILE - mx) * MINIMAP_PX_PER_TILE
      const dy = (p.y / TILE - my) * MINIMAP_PX_PER_TILE
      const px = cx + dx * cr - dy * sr
      const py = cy + dx * sr + dy * cr
      const name = opts.names[i] ?? CHARACTERS[p.char].name
      const color = p.downed ? '#ff4a3a' : '#9fd6ff'
      const inside = px > x + 6 && px < x + S - 6 && py > y + 6 && py < y + S - 6
      ctx.font = `700 ${p.downed ? 10 : 9}px "IBM Plex Sans KR", "Malgun Gothic", sans-serif`
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      if (inside) {
        if (p.downed) {
          ctx.globalAlpha = pulse
          ctx.strokeStyle = color
          ctx.lineWidth = 1.6
          ctx.beginPath()
          ctx.arc(px, py, 5 + pulse * 2, 0, Math.PI * 2)
          ctx.stroke()
          ctx.lineWidth = 3
          ctx.strokeStyle = 'rgba(0,0,0,0.85)'
          ctx.globalAlpha = 1
        }
        const label = p.downed ? `${name} 쓰러짐` : name
        const hw = ctx.measureText(label).width / 2 + 3
        const lx = Math.max(x + hw, Math.min(x + S - hw, px))
        const ly = Math.max(y + 12, py - 6)
        ctx.strokeText(label, lx, ly)
        ctx.fillStyle = color
        ctx.fillText(label, lx, ly)
        continue
      }
      // 창 밖: 가장자리에 화살표 (창 안쪽으로 7px)
      const a = Math.atan2(py - cy, px - cx)
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const half = S / 2 - 8
      const t = Math.min(half / Math.max(1e-6, Math.abs(ca)), half / Math.max(1e-6, Math.abs(sa)))
      const ex = cx + ca * t
      const ey = cy + sa * t
      ctx.globalAlpha = p.downed ? pulse : 0.95
      ctx.save()
      ctx.translate(ex, ey)
      ctx.rotate(a)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(7, 0)
      ctx.lineTo(-5, -6)
      ctx.lineTo(-5, 6)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      ctx.globalAlpha = 1
      const label = p.downed ? `${name} 쓰러짐` : name
      // 글이 창 밖으로 나가지 않게 (글 폭만큼 안쪽으로)
      const hw = ctx.measureText(label).width / 2 + 4
      const lx = Math.max(x + hw, Math.min(x + S - hw, ex - ca * 18))
      const ly = Math.max(y + 12, Math.min(y + S - 4, ey - sa * 14 + 3))
      ctx.strokeText(label, lx, ly)
      ctx.fillStyle = color
      ctx.fillText(label, lx, ly)
    }
    ctx.restore()
  }

  /**
   * 쓰러진 동료 길잡이 (2026-09-24 사용자: "down 된 동료는 빨간색으로 구하기 쉽도록 내 맵상에 네비게이션처럼 화살표"):
   * 내 캐릭터 둘레에 그쪽을 가리키는 빨간 화살표 + 거리(칸), 화면 밖이면 화면 가장자리에도 화살표 + 이름.
   * 내가 쓰러져 있거나 관전 중이면 그리지 않는다
   */
  private drawDownedNav(curr: GameState, pos: { x: number; z: number }[], opts: RenderOptions): void {
    const lp = opts.localPlayer
    if (lp < 0 || curr.mode !== 'dungeon') return
    const me = curr.players[lp]
    if (!me || !me.alive || me.downed || !pos[lp]) return
    const ctx = this.hud.ctx
    const pulse = 0.6 + 0.4 * Math.sin(this.t * 7)
    const sMe = this.worldToScreen(pos[lp].x, 0.9, pos[lp].z)
    for (let i = 0; i < curr.players.length; i++) {
      const p = curr.players[i]
      if (i === lp || !p.alive || !p.downed || p.left || !pos[i]) continue
      const s = this.worldToScreen(pos[i].x, 0.5, pos[i].z)
      const name = opts.names[i] ?? CHARACTERS[p.char].name
      const tiles = Math.round(Math.hypot(p.x - me.x, p.y - me.y) / TILE)
      const inside = s.x > 30 && s.x < VIEW_W - 30 && s.y > 30 && s.y < VIEW_H - 30
      if (!inside) {
        ctx.globalAlpha = pulse
        this.edgeArrow(s, '#ff4a3a', `${name} 쓰러짐 · ${tiles}칸`)
        ctx.globalAlpha = 1
      }
      // 내 둘레의 길잡이 화살표 (가까이 붙으면 — 일으킬 거리 — 숨긴다)
      if (tiles <= 2) continue
      const a = Math.atan2(s.y - sMe.y, s.x - sMe.x)
      const r = 62 * VIEW_K
      const ax = sMe.x + Math.cos(a) * r
      const ay = sMe.y + Math.sin(a) * r
      ctx.save()
      ctx.globalAlpha = pulse
      ctx.translate(ax, ay)
      ctx.rotate(a)
      ctx.fillStyle = '#ff4a3a'
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(13, 0)
      ctx.lineTo(-6, -9)
      ctx.lineTo(-1, 0)
      ctx.lineTo(-6, 9)
      ctx.closePath()
      ctx.stroke()
      ctx.fill()
      ctx.restore()
      ctx.save()
      ctx.globalAlpha = pulse
      ctx.font = '800 11px "IBM Plex Sans KR", "Malgun Gothic", sans-serif'
      ctx.textAlign = 'center'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'
      const tx = sMe.x + Math.cos(a) * (r + 22)
      const ty = sMe.y + Math.sin(a) * (r + 22) + 4
      const label = `${tiles}칸`
      ctx.strokeText(label, tx, ty)
      ctx.fillStyle = '#ffb0a0'
      ctx.fillText(label, tx, ty)
      ctx.restore()
    }
  }

  /**
   * **전체 지도** (M — 2026-09-20 "RPG 에 보통 있는데 없는 것" 검토): 미니맵은 내 주변만 보여 주므로
   * 지역이 어떻게 생겼는지 · 아직 안 가 본 쪽이 어디인지 알 수 없었다(디아블로의 지도). 화면 위에 반투명으로 덮는다.
   * 미니맵과 **같은 회전**을 써서 화면에서 보이는 방향과 어긋나지 않게 한다. 몬스터는 찍지 않는다 — 길을 보는 창이다.
   */
  private drawFullMap(curr: GameState, opts: RenderOptions): void {
    const map = this.map
    if (!this.miniCanvas) this.miniCanvas = renderMapTiles(map)
    const ctx = this.hud.ctx
    const lp = opts.viewer ?? opts.localPlayer
    const me = lp >= 0 ? curr.players[lp] : null
    const pad = 40
    const w = VIEW_W - pad * 2
    const h = VIEW_H - pad * 2 - 40
    const x = pad
    const y = pad + 28
    ctx.save()
    ctx.fillStyle = 'rgba(6,8,11,0.82)'
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    // 제목: 지역 이름 · 레벨
    const def = curr.mode === 'dungeon' && curr.curArea >= 0 ? areaDef(curr.curArea) : null
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#f1d58a'
    ctx.font = '800 22px "Nanum Myeongjo", serif'
    ctx.fillText(def ? `${def.name}${def.level ? ` · 지역 레벨 ${def.level}` : ''}` : '지도', VIEW_W / 2, y - 16)
    ctx.beginPath()
    roundRect(ctx, x, y, w, h, 8)
    ctx.clip()
    ctx.fillStyle = '#05070a'
    ctx.fillRect(x, y, w, h)
    // 회전한 맵이 창에 꽉 차도록: 돌린 뒤의 폭·높이로 배율을 잡는다
    const d = worldDirToScreen(1, 0)
    const rot = Math.atan2(d.y, d.x)
    const ca = Math.abs(Math.cos(rot))
    const sa = Math.abs(Math.sin(rot))
    const rw = map.w * ca + map.h * sa
    const rh = map.w * sa + map.h * ca
    const sc = Math.min(w / rw, h / rh) * 0.96
    ctx.translate(x + w / 2, y + h / 2)
    ctx.rotate(rot)
    ctx.scale(sc, sc)
    ctx.translate(-map.w / 2, -map.h / 2)
    ctx.imageSmoothingEnabled = false
    ctx.globalAlpha = 0.95
    ctx.drawImage(this.miniCanvas, 0, 0, map.w, map.h)
    ctx.globalAlpha = 1
    const rp = 1 / sc
    const dot = (px: number, py: number, color: string, r: number) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(px / TILE, py / TILE, r * rp, 0, Math.PI * 2)
      ctx.fill()
    }
    // 이름표는 회전을 풀고 그린다 (글자가 기울면 못 읽는다)
    const labels: { x: number; y: number; t: string; c: string }[] = []
    const place = (wx: number, wy: number, t: string, c: string) => {
      const tx = wx / TILE - map.w / 2
      const ty = wy / TILE - map.h / 2
      labels.push({ x: x + w / 2 + (tx * Math.cos(rot) - ty * Math.sin(rot)) * sc, y: y + h / 2 + (tx * Math.sin(rot) + ty * Math.cos(rot)) * sc, t, c })
    }
    if (curr.mode === 'dungeon' && curr.curArea >= 0) {
      const l = areaLayout(curr.curArea, this.map)
      for (const e of l.exits) {
        ctx.strokeStyle = isTown(e.to) ? '#ffd88a' : '#ff9a5a'
        ctx.lineWidth = 2.5 * rp
        ctx.strokeRect(e.x / TILE - 4 * rp, e.y / TILE - 4 * rp, 8 * rp, 8 * rp)
        place(e.x, e.y - 34, `→ ${AREAS[e.to].name}`, isTown(e.to) ? '#ffd88a' : '#ffb07a')
      }
      if (l.wp) {
        dot(l.wp.x, l.wp.y, '#7ab8ff', 4)
        place(l.wp.x, l.wp.y - 34, '웨이포인트', '#9ac8ff')
      }
      const gdef = areaDef(curr.curArea)
      if (gdef.gate !== undefined && l.special && me && gateOpen(gdef, me)) {
        dot(l.special.x, l.special.y, '#c86aff', 5)
        place(l.special.x, l.special.y - 34, `→ ${AREAS[gdef.gate].name}`, '#e0a8ff')
      }
      for (const q of curr.portals) {
        const at = isTown(curr.curArea) ? townPortalSpot(l, q.owner) : q.area === curr.curArea ? q : null
        if (at) dot(at.x, at.y, '#5a8cff', 4)
      }
      for (const n of townNpcs(curr.curArea)) {
        const c = NPC_DOT[n.id] ?? '#e8d6a8'
        dot(n.x, n.y, c, 4)
        place(n.x, n.y - 30, NPC_NAMES[n.id], c)
      }
    }
    // 사람들 (나는 노랑 · 동료는 파랑). 내 것은 테두리와 바라보는 방향까지 — 넓은 지도에서 점 하나는 잘 안 보인다
    for (let i = 0; i < curr.players.length; i++) {
      const p = curr.players[i]
      if (!p.alive || p.left || p.away) continue
      const mine = i === (opts.localPlayer ?? -1)
      if (mine) {
        ctx.strokeStyle = '#0a0806'
        ctx.lineWidth = 2.5 * rp
        ctx.beginPath()
        ctx.arc(p.x / TILE, p.y / TILE, 6 * rp, 0, Math.PI * 2)
        ctx.stroke()
      }
      dot(p.x, p.y, p.downed ? '#ff8a7a' : mine ? '#ffd84a' : '#5aa9ff', mine ? 6 : 4.5)
      if (mine) {
        const r = angleToRad(p.aim)
        ctx.strokeStyle = '#ffd84a'
        ctx.lineWidth = 2.5 * rp
        ctx.beginPath()
        ctx.moveTo(p.x / TILE, p.y / TILE)
        ctx.lineTo(p.x / TILE + Math.cos(r) * 16 * rp, p.y / TILE + Math.sin(r) * 16 * rp)
        ctx.stroke()
      }
    }
    ctx.restore()
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '700 12px "Nanum Myeongjo", serif'
    for (const t of labels) {
      if (t.x < x || t.x > x + w || t.y < y || t.y > y + h) continue
      const tw = ctx.measureText(t.t).width + 10
      ctx.fillStyle = 'rgba(8,7,6,0.78)'
      ctx.fillRect(t.x - tw / 2, t.y - 9, tw, 18)
      ctx.fillStyle = t.c
      ctx.fillText(t.t, t.x, t.y)
    }
    ctx.fillStyle = '#8d8170'
    ctx.font = '500 12px "IBM Plex Sans KR", sans-serif'
    ctx.fillText('M · Esc 로 닫기', VIEW_W / 2, VIEW_H - 26)
    ctx.restore()
  }

  /** 총성 표시: 화면 안이면 그 자리에 퍼지는 링, 밖이면 화면 가장자리 화살표 */
  private drawPings(): void {
    if (this.pings.length === 0) return
    const ctx = this.hud.ctx
    for (const p of this.pings) {
      const k = 1 - p.life / p.max
      const s = this.worldToScreen(p.x, 0.5, p.z)
      const inside = s.x > 20 && s.x < VIEW_W - 20 && s.y > 20 && s.y < VIEW_H - 20
      ctx.globalAlpha = Math.min(1, p.life * 2)
      if (inside) {
        ctx.strokeStyle = '#ffd84a'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(s.x, s.y, 10 + k * 26, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#ffd84a'
        ctx.beginPath()
        ctx.arc(s.x, s.y, 4, 0, Math.PI * 2)
        ctx.fill()
      } else this.edgeArrow(s, '#ffd84a')
      ctx.font = '600 11px "IBM Plex Sans KR", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = '#ffd84a'
      if (inside) ctx.fillText('총성', s.x, s.y - 16 - k * 26)
    }
    ctx.globalAlpha = 1
  }

  /** 화면 밖의 것을 가리키는 가장자리 화살표 (총성·팀 신호 공용) */
  private edgeArrow(s: { x: number; y: number }, color: string, label?: string): void {
    const ctx = this.hud.ctx
    const cx = VIEW_W / 2
    const cy = VIEW_H / 2
    const a = Math.atan2(s.y - cy, s.x - cx)
    const ex = cx + Math.cos(a) * (VIEW_W / 2 - 40)
    const ey = cy + Math.sin(a) * (VIEW_H / 2 - 40)
    ctx.save()
    ctx.translate(ex, ey)
    ctx.rotate(a)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(14, 0)
    ctx.lineTo(-8, -9)
    ctx.lineTo(-8, 9)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    if (label) {
      ctx.font = '600 11px "IBM Plex Sans KR", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = color
      ctx.fillText(label, ex - Math.cos(a) * 22, ey - Math.sin(a) * 22 + 4)
    }
  }

  /** 팀 신호가 화면 밖이면 가장자리 화살표 + "신호" */
  private drawMarkArrows(): void {
    const ctx = this.hud.ctx
    for (const m of this.marks) {
      const s = this.worldToScreen(m.x, 0.06, m.z)
      const inside = s.x > 20 && s.x < VIEW_W - 20 && s.y > 20 && s.y < VIEW_H - 20
      if (inside) continue
      ctx.globalAlpha = Math.min(1, m.life * 2)
      this.edgeArrow(s, '#7ee0a0', '신호')
    }
    ctx.globalAlpha = 1
  }

  private drawNameTags(curr: GameState, pos: { x: number; z: number }[], opts: RenderOptions): void {
    const ctx = this.hud.ctx
    const lp = opts.localPlayer
    const spectator = lp === -1
    const teams = isTeamMatch(curr)
    for (let i = 0; i < curr.players.length; i++) {
      const p = curr.players[i]
      if (!p.alive || !this.rigs[i]?.root.visible) continue
      const c = CHARACTERS[p.char]
      const s = this.worldToScreen(pos[i].x, this.rigs[i].height + 0.2, pos[i].z)
      const name = opts.names[i] ?? c.name
      const mine = i === lp
      const ally = !spectator && !mine && (curr.mode === 'dungeon' || (teams && p.team === curr.players[lp].team))
      // 상대 정보는 숨긴다. 체력 바는 나·아군·관전, 그리고 상대는 맞은 직후 몇 초만
      const showHp = spectator || mine || ally || this.hitShow[i] > 0
      ctx.font = `600 ${mine ? 13 : 12}px "IBM Plex Sans KR", "Malgun Gothic", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.strokeText(name, s.x, s.y)
      ctx.fillStyle = mine ? '#ffe680' : ally ? '#9fd6ff' : '#ffffff'
      ctx.fillText(name, s.x, s.y)
      // 감정 표현 말풍선 (이름 위). 보이는 사람 것만 — 이 루프가 이미 숨은 사람을 건너뛴다
      const em = this.emotes.get(i)
      if (em) {
        const left = em.until - performance.now()
        if (left <= 0) this.emotes.delete(i)
        else {
          ctx.save()
          ctx.globalAlpha = Math.min(1, left / 350)
          ctx.font = '700 15px "IBM Plex Sans KR", "Malgun Gothic", sans-serif'
          const tw = ctx.measureText(em.text).width + 20
          const by = s.y - 40
          // 우리 편을 부르는 스킬 외침은 초록 (초록 = 우리 편 좋은 효과 — 범위 고리와 같은 색)
          ctx.fillStyle = em.ally ? '#e2ffe9' : '#ffffff'
          roundRect(ctx, s.x - tw / 2, by - 13, tw, 26, 13)
          ctx.fill()
          if (em.ally) {
            ctx.strokeStyle = '#34c26a'
            ctx.lineWidth = 2
            ctx.stroke()
          }
          ctx.beginPath()
          ctx.moveTo(s.x - 5, by + 12)
          ctx.lineTo(s.x + 5, by + 12)
          ctx.lineTo(s.x, by + 19)
          ctx.closePath()
          ctx.fill()
          ctx.fillStyle = em.ally ? '#0e5a2c' : '#1a1f26'
          ctx.textBaseline = 'middle'
          ctx.fillText(em.text, s.x, by + 1)
          ctx.textBaseline = 'alphabetic'
          ctx.restore()
        }
      }
      if (!showHp) continue
      const w = mine ? 48 : 36
      const hpK = Math.max(0, p.hp / p.maxHp)
      const fade = mine || ally || spectator ? 1 : Math.min(1, this.hitShow[i] * 2)
      ctx.globalAlpha = fade
      // 체력: 머리 위 가로 막대
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(s.x - w / 2, s.y + 4, w, mine ? 6 : 5)
      ctx.fillStyle = hpK > 0.5 ? '#6fd66a' : hpK > 0.25 ? '#f2c94c' : '#f25c4c'
      ctx.fillRect(s.x - w / 2 + 1, s.y + 5, (w - 2) * hpK, mine ? 4 : 3)
      // 기력: 캐릭터 오른쪽 세로 막대 (나·아군만)
      if (mine || ally) {
        const bh = 34
        const bx = s.x + w / 2 + 6
        const by = s.y + 30
        const sk = Math.max(0, Math.min(1, p.stamina / p.staminaMax))
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(bx, by - bh, 6, bh)
        ctx.fillStyle = sk > 0.34 ? '#9fe0ff' : '#e08a5a'
        ctx.fillRect(bx + 1, by - 1 - (bh - 2) * sk, 4, (bh - 2) * sk)
      }
      // 재장전 진행: 캐릭터 **왼쪽** 세로 막대, **재장전 중에만** (나·아군). 카드에서 눈을 떼지 않아도 완료 시점을 안다 (2026-09-05 요청)
      const rw = WEAPONS[p.weapon]
      if ((mine || ally) && p.reloadTimer > 0 && rw.reloadTicks > 0) {
        const bh = 34
        const bx = s.x - w / 2 - 12
        const by = s.y + 30
        const rk = 1 - p.reloadTimer / rw.reloadTicks
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(bx, by - bh, 6, bh)
        ctx.fillStyle = '#f2c94c'
        ctx.fillRect(bx + 1, by - 1 - (bh - 2) * rk, 4, (bh - 2) * rk)
      }
      // 탄 부족(탄창 20% 이하): 재장전 막대 자리에 빨간 점 "!" 이 깜빡인다 — 카드를 안 봐도 재장전할 때임을 안다
      if ((mine || ally) && lowAmmo(p, rw)) {
        const bx = s.x - w / 2 - 13
        const by = s.y + 12
        ctx.globalAlpha = fade * (Math.floor(performance.now() / 260) % 2 === 0 ? 1 : 0.45)
        ctx.fillStyle = '#f25c4c'
        ctx.beginPath()
        ctx.arc(bx, by, 7.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.font = '700 12px "IBM Plex Sans KR", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('!', bx, by + 0.5)
        ctx.textBaseline = 'alphabetic'
      }
      ctx.globalAlpha = 1
    }
  }

  private updateRig(i: number, p: PlayerState, pos: { x: number; z: number }, dt: number): void {
    const rig = this.rigs[i]
    if (rig.weapon.id !== p.weapon) rig.setWeapon(WEAPONS[p.weapon])
    const v = this.vis[i]
    const root = rig.root
    root.position.set(pos.x, 0, pos.z)

    if (p.left || this.hidden[i]) {
      root.visible = false
      return
    }

    // 조준 방향 부드럽게
    const target = angleToRad(p.aim)
    let d = target - this.aimSmooth[i]
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.aimSmooth[i] += d * Math.min(1, dt * 22)
    root.rotation.y = Math.PI / 2 - this.aimSmooth[i]

    // 쓰러짐: 옆으로 누워 있고, 몸이 붉게 숨쉬듯 깜빡인다 (일으켜 달라는 신호)
    if (p.alive && p.downed) {
      root.visible = true
      v.fall = Math.min(1, v.fall + dt * 3.2)
      const ease = 1 - Math.pow(1 - v.fall, 3)
      rig.body.rotation.x = -ease * Math.PI * 0.45
      rig.body.rotation.z = ease * 0.25
      rig.body.position.y = ease * 0.3
      rig.setFlash(0.25 + 0.25 * Math.sin(this.t * 5), 0xff3b30)
      root.scale.set(1, 1, 1)
      if (rig.shield) rig.shield.visible = false
      return
    }
    if (!p.alive) {
      if (v.deadT < 0) {
        root.visible = false
        return
      }
      root.visible = v.deadT < 1.3
      // 넘어지기: 달걀이 뒤로 벌렁 넘어지며 살짝 튄다
      v.fall = Math.min(1, v.fall + dt * 3.2)
      const ease = 1 - Math.pow(1 - v.fall, 3)
      rig.body.rotation.x = -ease * Math.PI * 0.45
      rig.body.rotation.z = ease * 0.25
      rig.body.position.y = ease * 0.3 + Math.sin(Math.min(1, v.fall) * Math.PI) * 0.18
      setRigOpacity(rig, Math.max(0, 1 - Math.max(0, v.deadT - 0.8) * 2))
      return
    }
    if (v.deadT >= 0 || rig.body.position.y > 0.2) {
      v.deadT = -1
      rig.body.rotation.x = 0
      rig.body.rotation.z = 0
      rig.body.position.y = 0
      setRigOpacity(rig, 1)
    }
    root.visible = true

    // 말랑 스프링
    const k = 220
    const damp = 14
    v.vsx += (-k * (v.sx - 1) - damp * v.vsx) * dt
    v.vsy += (-k * (v.sy - 1) - damp * v.vsy) * dt
    v.vsx = Math.max(-4, Math.min(4, v.vsx))
    v.vsy = Math.max(-4, Math.min(4, v.vsy))
    v.sx = Math.max(0.62, Math.min(1.5, v.sx + v.vsx * dt))
    v.sy = Math.max(0.62, Math.min(1.5, v.sy + v.vsy * dt))
    v.flash = Math.max(0, v.flash - dt)
    rig.setFlash(v.flash > 0 ? Math.min(1, v.flash * 8) : 0, v.flashColor)

    // 걷기: 다리 스윙 + 달걀 몸 뒤뚱(좌우 기울기) + 통통 튀기
    if (p.moving) v.walk += dt * (p.sprinting ? 17 : 13) // 달리면 다리도 빨리 움직인다
    else v.walk *= 0.8
    // 다리가 길수록 크게 젓는다 — 위에서 봐도 걸음이 눈에 띄도록
    const swing = (p.moving ? Math.sin(v.walk) * 0.55 : Math.sin(v.walk) * 0.2) * rig.stride
    rig.legL.rotation.x = swing
    rig.legR.rotation.x = -swing
    const bob = p.moving ? Math.abs(Math.sin(v.walk)) * 0.05 * rig.stride : 0
    rig.body.position.set(0, bob, 0)
    rig.body.rotation.z = p.moving ? Math.sin(v.walk) * 0.07 : 0
    rig.arms.rotation.x = p.moving ? Math.sin(v.walk * 2) * 0.05 : 0
    // 재장전: 총을 아래로 내렸다가(탄창을 갈아 끼우듯 까딱이고) 다시 올린다 — 왼쪽 아래 카드를 안 봐도
    // 재장전 중인 줄 알 수 있게 (2026-09-05 요청). 처음 18% 에 내리고, 마지막 18% 에 올린다
    if (p.reloadTimer > 0 && rig.weapon.reloadTicks > 0) {
      const k = 1 - p.reloadTimer / rig.weapon.reloadTicks // 0 → 1
      const s01 = (x: number) => {
        const c = Math.max(0, Math.min(1, x))
        return c * c * (3 - 2 * c)
      }
      const down = s01(k / 0.18) * (1 - s01((k - 0.82) / 0.18))
      const tap = down * Math.max(0, Math.sin(k * Math.PI * 4)) * 0.14
      // 위에서 내려다보는 카메라라 총을 내리는 것만으로는 잘 안 보인다 → 총을 몸 앞으로 끌어당기고(팔 y 회전),
      // 몸을 살짝 웅크리며(달걀 눌림), 고개를 숙여 총을 본다
      rig.arms.rotation.x += down * 1.0 + tap
      v.reloadSwing = -down * 0.7
      rig.body.scale.set(1 + down * 0.06, 1 - down * 0.14, 1 + down * 0.06)
      rig.head.rotation.x = down * 0.35
    } else {
      v.reloadSwing = 0
      rig.body.scale.set(1, 1, 1)
      rig.head.rotation.x = 0
    }
    rig.body.rotation.x = 0
    // 대시 = 구르기: 대시 방향으로 한 바퀴 구르며 살짝 뜬다 (몸통 중심을 축으로)
    if (p.dashTimer > 0) {
      const dashMax = p.char === 'juwoojae' ? Math.round(DASH_TICKS * 1.5) : DASH_TICKS
      const k = 1 - p.dashTimer / dashMax
      const world = Math.atan2(p.dashDy, p.dashDx) // sim 좌표 각도 (x→y=z)
      const local = world - this.aimSmooth[i] // root 가 조준 방향으로 돌아 있으므로
      const dx = Math.sin(local)
      const dz = Math.cos(local)
      const axis = new THREE.Vector3(dz, 0, -dx).normalize()
      const q = new THREE.Quaternion().setFromAxisAngle(axis, k * Math.PI * 2)
      rig.body.quaternion.copy(q)
      const c = new THREE.Vector3(0, rig.centerY, 0).applyQuaternion(q)
      const hop = Math.sin(k * Math.PI) * 0.18
      rig.body.position.set(-c.x, rig.centerY - c.y + hop, -c.z)
    }
    // 정조준: 팔을 조금 더 앞으로
    rig.arms.position.z = p.ads ? 0.18 : 0.1
    // 휘두르기: 옆으로 쓸어 친다. (2026-09-20 철면란만 파리채처럼 내려치게 해 봤지만
    // 게임 안에서 보기 나빠 원래대로 되돌렸다 — 사용자 "그냥 원래처럼 옆으로 휘두르도록 해 줘")
    rig.arms.rotation.y = v.swing > 0 ? Math.sin(v.swing * Math.PI) * 1.5 : v.reloadSwing
    rig.arms.position.y = armsBaseY(rig)
    if (p.fx[FX_WHIRL] > 0) root.rotation.y = this.t * 18
    root.scale.set(v.sx, v.sy, v.sx)
    // 무적(스폰 보호 · 우원란이 구른 뒤): **황금 보호막**. 전에는 몸을 반투명하게 깜빡였는데
    // 눈에 띄지 않아 우원란 패시브가 있는지도 몰랐다(2026-09-06 제보). 구르는 동안은 구르기 연출이 이미 말해 준다
    const guarded = p.invuln > 0 && p.dashTimer === 0
    if (guarded && !rig.shield) {
      rig.shield = makeShield(rig.centerY * 1.45)
      rig.shield.position.y = rig.centerY
      rig.root.add(rig.shield)
    }
    if (rig.shield) {
      rig.shield.visible = guarded
      if (guarded) {
        const k = 1 + 0.05 * Math.sin(this.t * 9)
        rig.shield.scale.set(k, k, k)
        ;(rig.shield.material as THREE.MeshBasicMaterial).opacity = 0.28 + 0.1 * Math.sin(this.t * 9)
      }
    }
  }

  /**
   * 지역의 붙박이 표시: **출구**(바닥의 어두운 문턱 + 따뜻한 불빛 — 걸어 들어가면 건너간다)와
   * **웨이포인트**(푸르게 빛나는 돌 원판). 맵이 바뀌면 새로 만든다.
   */
  private updateMarkers(curr: GameState, lp = -1): void {
    // 다음 막 문은 **보스를 잡는 순간** 켜진다 — 맵이 그대로라 표시를 새로 만들지는 않고 보이기만 켠다
    if (this.gate) {
      const me = lp >= 0 ? curr.players[lp] : undefined
      this.gate.visible = !!me && gateOpen(areaDef(curr.curArea), me)
    }
    if (this.markersFor === this.map && this.markers) {
      const k = 1 + Math.sin(this.t * 2.2) * 0.06
      for (const c of this.markers.children) if (c.userData.pulse) c.scale.setScalar(k)
      return
    }
    if (this.markers) {
      this.scene.remove(this.markers)
      this.markers = null
    }
    this.markersFor = this.map
    if (curr.mode !== 'dungeon' || curr.curArea < 0) return
    const g = new THREE.Group()
    const l = areaLayout(curr.curArea, this.map)
    for (const e of l.exits) {
      const town = isTown(e.to)
      const color = town ? 0xffc46a : 0xff8a4a
      const ex = new THREE.Group()
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.95, 28), new THREE.MeshBasicMaterial({ color: 0x010101 }))
      hole.rotation.x = -Math.PI / 2
      hole.position.y = 0.03
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.12, 36), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }))
      rim.rotation.x = -Math.PI / 2
      rim.position.y = 0.04
      rim.userData.pulse = true
      const light = new THREE.PointLight(color, 9, 7, 1.5)
      light.position.y = 1.2
      ex.add(hole, rim, light)
      ex.position.set(e.x * U, 0, e.y * U)
      g.add(ex)
    }
    // 다음 막으로 가는 문 (2026-09-20): 보스가 섰던 자리에 선다. 보스를 잡기 전에는 감춰 둔다 — draw 에서 켠다
    const def = areaDef(curr.curArea)
    this.gate = null
    if (def.gate !== undefined && l.special) {
      const gate = new THREE.Group()
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.13, 10, 40), new THREE.MeshBasicMaterial({ color: 0xc86aff }))
      ring.position.y = 1.25
      const sheet = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32), new THREE.MeshBasicMaterial({ color: 0x6a2aa8, transparent: true, opacity: 0.55, side: THREE.DoubleSide }))
      sheet.position.y = 1.25
      const disc = new THREE.Mesh(new THREE.RingGeometry(0.5, 1.3, 36), new THREE.MeshBasicMaterial({ color: 0xc86aff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }))
      disc.rotation.x = -Math.PI / 2
      disc.position.y = 0.05
      disc.userData.pulse = true
      const light = new THREE.PointLight(0xc86aff, 14, 10, 1.4)
      light.position.y = 1.4
      gate.add(ring, sheet, disc, light)
      gate.position.set(l.special.x * U, 0, l.special.y * U)
      gate.visible = false
      g.add(gate)
      this.gate = gate
    }
    // 마을 사람들: 두건 쓴 사람(망토 색이 저마다) · 보관함은 쇠테 두른 큰 궤짝
    const cloak: Record<string, number> = { merchant: 0x6a4a2a, smith: 0x4a3a30, gambler: 0x4a2a52, elder: 0x5a5a4a, captain: 0x5a2a22 }
    for (const n of townNpcs(curr.curArea)) {
      const f = new THREE.Group()
      if (n.id === 'stash') {
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.7), new THREE.MeshLambertMaterial({ color: 0x4a3420 }))
        box.position.y = 0.35
        box.castShadow = true
        const band = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.08, 0.74), new THREE.MeshLambertMaterial({ color: 0x8a8070 }))
        band.position.y = 0.6
        const lock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.06), new THREE.MeshLambertMaterial({ color: 0xc9a24a }))
        lock.position.set(0, 0.45, 0.37)
        f.add(box, band, lock)
      } else {
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.25, 10), new THREE.MeshLambertMaterial({ color: cloak[n.id] ?? 0x4a4a4a }))
        body.position.y = 0.62
        body.castShadow = true
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), new THREE.MeshLambertMaterial({ color: 0xc8a888 }))
        head.position.y = 1.36
        const hood = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.34, 10), new THREE.MeshLambertMaterial({ color: new THREE.Color(cloak[n.id] ?? 0x4a4a4a).multiplyScalar(0.8) }))
        hood.position.y = 1.58
        f.add(body, head, hood)
      }
      f.position.set(n.x * U, 0, n.y * U)
      f.rotation.y = Math.PI / 4
      g.add(f)
    }
    if (l.wp) {
      const wp = new THREE.Group()
      const stone = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.12, 8), new THREE.MeshLambertMaterial({ color: 0x4a4e5a }))
      stone.position.y = 0.06
      const rune = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 8), new THREE.MeshBasicMaterial({ color: 0x7ab8ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }))
      rune.rotation.x = -Math.PI / 2
      rune.position.y = 0.14
      rune.userData.pulse = true
      const light = new THREE.PointLight(0x6aa8ff, 7, 6, 1.5)
      light.position.y = 1
      wp.add(stone, rune, light)
      wp.position.set(l.wp.x * U, 0, l.wp.y * U)
      g.add(wp)
    }
    this.scene.add(g)
    this.markers = g
  }

  /** 타운 포털: 푸른 타원 문. 들판 쪽은 연 자리, 마을 쪽은 마을의 포털 자리 (주인마다 옆으로) */
  private updatePortals(curr: GameState): void {
    const want = new Map<number, { x: number; y: number }>()
    if (curr.mode === 'dungeon' && curr.curArea >= 0) {
      const town = isTown(curr.curArea)
      const l = town ? areaLayout(curr.curArea, this.map) : null
      for (const q of curr.portals) {
        const at = town ? (l ? townPortalSpot(l, q.owner) : null) : q.area === curr.curArea ? q : null
        if (at) want.set(q.owner, at)
      }
    }
    for (const [owner, g] of this.portalMeshes) {
      if (want.has(owner)) continue
      this.scene.remove(g)
      this.portalMeshes.delete(owner)
    }
    for (const [owner, at] of want) {
      let g = this.portalMeshes.get(owner)
      if (!g) {
        g = new THREE.Group()
        const door = new THREE.Mesh(new THREE.CircleGeometry(0.62, 32), new THREE.MeshBasicMaterial({ color: 0x3a6cff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
        door.scale.set(1, 1.55, 1)
        door.position.y = 1.05
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.05, 6, 32), new THREE.MeshBasicMaterial({ color: 0xaad0ff }))
        rim.scale.set(1, 1.55, 1)
        rim.position.y = 1.05
        const light = new THREE.PointLight(0x5a8cff, 10, 7, 1.4)
        light.position.y = 1.2
        g.add(door, rim, light)
        this.scene.add(g)
        this.portalMeshes.set(owner, g)
      }
      g.position.set(at.x * U, 0, at.y * U)
      // 늘 화면(카메라) 쪽을 보게
      g.rotation.y = Math.PI / 4
      ;((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.2 * Math.sin(this.t * 5 + owner)
    }
  }

  /**
   * 지역 물건: 상자(나무 + 쇠테, 열리면 뚜껑이 젖혀진다) · 금빛 상자 · 항아리(깨지면 사라진다) · 제단(색 빛 — 쓰면 꺼진다)
   */
  private updateObjects(curr: GameState): void {
    const live = new Set<number>()
    for (const o of curr.objects ?? []) {
      if (o.kind === OBJ_URN && o.used) continue
      live.add(o.id)
      let g = this.objMeshes.get(o.id)
      if (!g) {
        g = new THREE.Group()
        if (o.kind === OBJ_CHEST || o.kind === OBJ_GOLDCHEST) {
          const gold = o.kind === OBJ_GOLDCHEST
          const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.46), new THREE.MeshLambertMaterial({ color: gold ? 0xa87a1a : 0x5a3a20 }))
          body.position.y = 0.2
          body.castShadow = true
          const trim = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.06, 0.5), new THREE.MeshLambertMaterial({ color: gold ? 0xffd86a : 0x6a6660 }))
          trim.position.y = 0.3
          const lid = new THREE.Group()
          const lidM = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.7, 10, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: gold ? 0xc8961a : 0x6a4428 }))
          lidM.rotation.z = Math.PI / 2
          lidM.position.z = 0.23
          lid.add(lidM)
          lid.position.set(0, 0.4, -0.23)
          lid.userData.lid = true
          g.add(body, trim, lid)
          if (gold) {
            const glow = new THREE.PointLight(0xffc84a, 4, 3, 1.6)
            glow.position.y = 0.8
            g.add(glow)
          }
        } else if (o.kind === OBJ_URN) {
          const pts = [0, 0.09, 0.14, 0.15, 0.12, 0.07, 0.08, 0.1].map((r, i) => new THREE.Vector2(r, i * 0.06))
          const urn = new THREE.Mesh(new THREE.LatheGeometry(pts, 10), new THREE.MeshLambertMaterial({ color: 0x8a6a4a }))
          urn.castShadow = true
          g.add(urn)
        } else {
          const col = [0xff5a3a, 0x5aa8ff, 0xd8a8ff, 0x7aff9a][o.v] ?? 0xffffff
          const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 1.1, 6), new THREE.MeshLambertMaterial({ color: 0x5a5660 }))
          stone.position.y = 0.55
          stone.castShadow = true
          const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshBasicMaterial({ color: col }))
          orb.position.y = 1.3
          orb.userData.orb = true
          const light = new THREE.PointLight(col, 6, 5, 1.6)
          light.position.y = 1.4
          light.userData.orb = true
          g.add(stone, orb, light)
        }
        g.position.set(o.x * U, 0, o.y * U)
        g.rotation.y = ((o.id * 97) % 628) / 100
        this.scene.add(g)
        this.objMeshes.set(o.id, g)
      }
      if (o.used) {
        for (const c of g.children) {
          if (c.userData.lid) c.rotation.x = Math.max(-1.9, c.rotation.x - 0.12)
          if (c.userData.orb) c.visible = false
        }
      } else if (o.kind === OBJ_SHRINE) {
        for (const c of g.children) if (c.userData.orb && c instanceof THREE.Mesh) c.position.y = 1.3 + Math.sin(this.t * 2 + o.id) * 0.06
      }
    }
    for (const [id, g] of this.objMeshes) {
      if (live.has(id)) continue
      this.scene.remove(g)
      this.objMeshes.delete(id)
    }
  }

  /** 출구·웨이포인트·포털 이름표 (가까운 것만) */
  private drawPlaceLabels(curr: GameState, lp: number): void {
    if (curr.mode !== 'dungeon' || curr.curArea < 0 || lp < 0) return
    const me = curr.players[lp]
    const l = areaLayout(curr.curArea, this.map)
    const ctx = this.hud.ctx
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const label = (x: number, y: number, text: string, color: string) => {
      if (Math.hypot(x - me.x, y - me.y) > 12 * 32) return
      const s = this.worldToScreen(x * U, 1.6, y * U)
      ctx.font = '700 13px "Nanum Myeongjo", serif'
      const w = ctx.measureText(text).width + 14
      ctx.fillStyle = 'rgba(8,7,6,0.72)'
      ctx.fillRect(s.x - w / 2, s.y - 10, w, 20)
      ctx.fillStyle = color
      ctx.fillText(text, s.x, s.y + 0.5)
    }
    // 이름표의 키는 설정을 따른다 (2026-09-23 키 재설정 — 기본 F)
    const F = keyLabel('use')
    for (const e of l.exits) label(e.x, e.y, `→ ${AREAS[e.to].name} · ${F}`, isTown(e.to) ? '#ffd88a' : '#ffb07a')
    // 다음 막 문 (보스를 잡았을 때만 보인다)
    const gdef = areaDef(curr.curArea)
    if (gdef.gate !== undefined && l.special && gateOpen(gdef, me)) {
      label(l.special.x, l.special.y - 40, `→ ${ACTS[gdef.act + 1].name} · ${AREAS[gdef.gate].name} · ${F}`, '#e0a8ff')
    }
    const em = elderMarks(me.quests ?? [])
    for (const n of townNpcs(curr.curArea)) {
      // 촌장 머리 위: 보고할 것이 있으면 ?, 맡을 것이 있으면 ! (디아블로) — 모든 막 공유 · 아직 못 간 막은 빼고
      const mark = n.id === 'elder' ? (em.report ? '? ' : em.offer ? '! ' : '') : ''
      label(n.x, n.y - 44, `${mark}${NPC_NAMES[n.id]} · ${F}`, mark ? '#ffd84a' : '#e8d6a8')
    }
    for (const o of curr.objects ?? []) {
      if (o.used || o.kind === OBJ_URN || Math.hypot(o.x - me.x, o.y - me.y) > 5 * 32) continue
      label(o.x, o.y, o.kind === OBJ_SHRINE ? `${SHRINE_NAMES[o.v]} · ${F}` : o.kind === OBJ_GOLDCHEST ? `금빛 상자 · ${F}` : `상자 · ${F}`, o.kind === OBJ_GOLDCHEST ? '#ffd86a' : o.kind === OBJ_SHRINE ? '#d8c8ff' : '#d8cfbf')
    }
    if (l.wp) label(l.wp.x, l.wp.y, `웨이포인트 · ${F}`, '#9ac8ff')
    if (isTown(curr.curArea)) {
      for (const q of curr.portals) {
        const at = townPortalSpot(l, q.owner)
        if (at) label(at.x, at.y - 40, `타운 포털 → ${AREAS[q.area].name}`, '#9ac8ff')
      }
    } else {
      for (const q of curr.portals) if (q.area === curr.curArea) label(q.x, q.y - 40, `타운 포털 · ${F}`, '#9ac8ff')
    }
    ctx.restore()
  }

  // ---------- 전리품 ----------
  /** 바닥 전리품: 등급 색 빛기둥 + 작은 상자. 내 것·버려진 것만 (디아블로 개인 전리품) */
  private updateDrops(curr: GameState, lp: number): void {
    if (lp !== this.localForDrops) {
      for (const g of this.dropMeshes.values()) this.scene.remove(g)
      this.dropMeshes.clear()
      this.localForDrops = lp
    }
    const live = new Set<number>()
    for (const d of curr.drops) {
      if (d.owner !== lp && d.owner !== -1) continue
      live.add(d.id)
      let g = this.dropMeshes.get(d.id)
      if (!g && !d.item) {
        // 골드 더미(금화 몇 닢) · 물약(붉은 병)
        g = new THREE.Group()
        const R = this.dropRes
        if (d.gold > 0) {
          const n = Math.min(6, 2 + Math.floor(d.gold / 15))
          for (let k = 0; k < n; k++) {
            const coin = new THREE.Mesh(R.coin, R.coinMat)
            coin.position.set(((k * 37) % 7) / 25 - 0.12, 0.02 + (k % 3) * 0.028, ((k * 53) % 5) / 20 - 0.1)
            coin.rotation.z = (k % 2) * 0.3
            g.add(coin)
          }
        } else {
          const flask = new THREE.Mesh(R.flask, R.flaskMat)
          flask.position.y = 0.12
          const neck = new THREE.Mesh(R.neck, R.neckMat)
          neck.position.y = 0.26
          g.add(flask, neck)
        }
        this.scene.add(g)
        this.dropMeshes.set(d.id, g)
      }
      if (!d.item) {
        g!.position.set(d.x * U, 0, d.y * U)
        continue
      }
      if (!g) {
        g = new THREE.Group()
        const r = d.item.rarity
        const R = this.dropRes
        const col = new THREE.Color(RARITY_COLORS[r])
        const h = 0.8 + r * 0.7
        // 등급마다 하나씩 만들어 같이 쓴다 (빛기둥의 깜빡임도 등급마다 같이)
        R.beams[r] ??= new THREE.CylinderGeometry(0.04 + r * 0.02, 0.1 + r * 0.03, h, 8, 1, true)
        R.beamMats[r] ??= new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
        R.boxMats[r] ??= new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.35 })
        const beam = new THREE.Mesh(R.beams[r], R.beamMats[r])
        beam.position.y = h / 2
        const box = new THREE.Mesh(R.box, R.boxMats[r])
        box.position.y = 0.08
        box.castShadow = true
        g.add(beam, box)
        this.scene.add(g)
        this.dropMeshes.set(d.id, g)
      }
      g.position.set(d.x * U, 0, d.y * U)
      ;(g.children[1] as THREE.Mesh).rotation.y = this.t * 1.5 + d.id
    }
    for (let r = 0; r < this.dropRes.beamMats.length; r++) {
      const m = this.dropRes.beamMats[r]
      if (m) m.opacity = 0.35 + 0.15 * Math.sin(this.t * 3 + r * 1.7)
    }
    for (const [id, g] of this.dropMeshes) {
      if (live.has(id)) continue
      this.scene.remove(g)
      this.dropMeshes.delete(id)
    }
  }

  /** 가까운 전리품 이름표 (디아블로 4 처럼 바닥에 이름) */
  private drawDropLabels(curr: GameState, lp: number): void {
    if (lp < 0) return
    const me = curr.players[lp]
    const ctx = this.hud.ctx
    ctx.save()
    ctx.font = '700 12px "IBM Plex Sans KR", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let n = 0
    for (const d of curr.drops) {
      if ((d.owner !== lp && d.owner !== -1) || n > 24 || !d.item) continue
      if (Math.hypot(d.x - me.x, d.y - me.y) > 10 * 32) continue
      const s = this.worldToScreen(d.x * U, 0.35, d.y * U)
      const name = itemName(d.item)
      const w = ctx.measureText(name).width + 12
      ctx.fillStyle = 'rgba(8,7,6,0.78)'
      ctx.fillRect(s.x - w / 2, s.y - 9, w, 18)
      ctx.strokeStyle = RARITY_COLORS[d.item.rarity]
      ctx.globalAlpha = 0.6
      ctx.strokeRect(s.x - w / 2 + 0.5, s.y - 8.5, w - 1, 17)
      ctx.globalAlpha = 1
      ctx.fillStyle = RARITY_COLORS[d.item.rarity]
      ctx.fillText(name, s.x, s.y + 0.5)
      n++
    }
    ctx.restore()
  }

  // ---------- 스킬 연출 ----------
  /** 스킬을 쓴 순간: 시전 고리 + 스킬마다의 튀는 효과 */
  private onSkill(e: Extract<SimEvent, { type: 'skill' }>, state: GameState, localPlayer: number): void {
    // 스킬명을 외친다 (우리 편 범위 스킬이면 모이라는 말까지 — 초록 말풍선)
    const shout = skillShout((e.rid ?? e.id) as SkillId)
    if (shout) this.showShout(e.p, shout.text, shout.ally)
    const x = e.x * U
    const z = e.y * U
    const ult = e.slot === 2
    const color = SKILL_COLOR[e.id] ?? 0xffffff
    this.spawnRing(x, z, ult ? 2.2 : 1.4, 0.3, ult ? 0.5 : 0.35, color)
    if (ult) {
      this.spawnImpact(x, 1.2, z, color, 4)
      const light = this.takeLight(color, 14, 9, 1.5)
      light.position.set(x, 1.5, z)
      this.flashes.push({ light, mesh: null, life: 0.25 })
      if (e.p === localPlayer) this.shake = Math.max(this.shake, 0.25)
      const v = this.vis[e.p]
      if (v) {
        v.vsx -= 0.3
        v.vsy += 0.45
      }
    }
    if (e.id === 'broadcast') this.spawnRing(x, z, 0.5, 18, 0.9, 0xb99cff)
    if (e.id === 'curtain') this.spawnRing(x, z, 0.5, 7, 0.8, 0xd0506a)
    if (e.id === 'pancharge' || e.id === 'catstep' || e.id === 'stunt' || e.id === 'catwalk') {
      for (let k = 0; k < 10; k++) {
        const a = Math.random() * Math.PI * 2
        this.spawnParticle(x, 0.3, z, Math.cos(a) * 0.04, 0.05, Math.sin(a) * 0.04, 0.5, 0xd8c8a8, 0.6)
      }
    }
    void state
  }

  /** 스킬 범위 공격이 터짐: 크기만큼의 고리 + 스킬별 입자 */
  private onAoe(e: Extract<SimEvent, { type: 'aoe' }>): void {
    const x = e.x * U
    const z = e.y * U
    const r = e.r * U
    const color = SKILL_COLOR[e.id] ?? 0xffffff
    this.spawnRing(x, z, 0.3, r, 0.45, color)
    const n = Math.min(40, Math.round(r * 6))
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2
      const d = Math.random() * r
      const sp = 0.03 + Math.random() * 0.06
      const col = e.id === 'flame' ? (k % 2 === 0 ? 0xff8a3a : 0xffd26a) : e.id === 'oil' ? 0xe8d060 : e.id === 'grenade' ? (k % 2 === 0 ? 0xffb050 : 0x3a3530) : color
      this.spawnParticle(x + Math.cos(a) * d, 0.4, z + Math.sin(a) * d, Math.cos(a) * sp, 0.06 + Math.random() * 0.1, Math.sin(a) * sp, 0.5 + Math.random() * 0.3, col, 0.7)
    }
    if (e.id === 'grenade' || e.id === 'roar' || e.id === 'supernova' || e.id === 'trap') {
      this.spawnImpact(x, 0.8, z, color, r * 2.2)
      this.shake = Math.max(this.shake, 0.25)
    }
  }

  /** 스포트라이트 무대: 땅에 밝은 원 + 테두리, 끝나 갈수록 흐려진다 */
  private updateZones(curr: GameState, localPlayer: number): void {
    const live = new Set<number>()
    for (const zn of curr.zones) {
      live.add(zn.id)
      // 보스 패턴 범위 (‰ 피해 · 모양 · 예고만) — 따로 그린다
      if (zn.pm || zn.kill || zn.kind === ZONE_WARN) {
        this.updateBossZone(zn)
        continue
      }
      let g = this.zoneMeshes.get(zn.id)
      const fuse = zn.kind === ZONE_FUSE
      const acid = zn.kind === ZONE_ACID
      const vortex = zn.kind === ZONE_VORTEX
      const trap = zn.kind === ZONE_TRAP
      if (!g) {
        g = new THREE.Group()
        // 색의 뜻 (2026-09-23 사용자: "적의 범위 공격은 빨강, 우리 편 힐 · 좋은 효과는 초록 — 초록 독을 좋은 범위로 착각하지 않게"):
        // 산성 웅덩이(토사꾼)는 초록이었다 → 빨강. 스포트라이트 무대(동료 연사 +30%)는 초록 — 투기장에서 상대가 깐 무대는 빨강
        const me = localPlayer >= 0 ? curr.players[localPlayer] : undefined
        const owner = curr.players[zn.owner]
        const hostileStage = !!me && !!owner && me !== owner && isEnemy(me, owner)
        const stage = hostileStage ? 0xff4a3a : ALLY_GOOD
        const cDisc = acid ? 0xff3a1a : fuse ? 0xff3a1a : vortex ? 0x60c8ff : trap ? 0xa07040 : hostileStage ? 0xff3a1a : 0x7affa0
        const cRim = acid ? 0xff5a3a : fuse ? 0xff5a2a : vortex ? 0xa0e8ff : trap ? 0xd0a060 : stage
        const disc = new THREE.Mesh(this.zoneDisc, new THREE.MeshBasicMaterial({ color: cDisc, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }))
        disc.rotation.x = -Math.PI / 2
        const rim = new THREE.Mesh(this.zoneRim, new THREE.MeshBasicMaterial({ color: cRim, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }))
        rim.rotation.x = -Math.PI / 2
        g.add(disc, rim)
        const beam = new THREE.PointLight(acid ? 0xff4a2a : fuse ? 0xff4a20 : vortex ? 0x80d0ff : trap ? 0xd0a060 : 0xfff0c0, acid || trap ? 3 : fuse ? 6 : 10, zn.r * U * 2.5, 1.4)
        beam.position.y = 3
        g.add(beam)
        this.scene.add(g)
        this.zoneMeshes.set(zn.id, g)
      }
      g.position.set(zn.x * U, 0.04, zn.y * U)
      g.scale.set(zn.r * U, 1, zn.r * U)
      if (vortex) {
        // 태풍: 돌며 안쪽으로 빨려 드는 입자
        g.rotation.y = this.t * 4
        if (Math.random() < 0.6) {
          const a = Math.random() * Math.PI * 2
          const d = zn.r * U * (0.5 + Math.random() * 0.5)
          const px = zn.x * U + Math.cos(a) * d
          const pz = zn.y * U + Math.sin(a) * d
          this.spawnParticle(px, 0.3 + Math.random() * 0.8, pz, -Math.cos(a) * 0.06 - Math.sin(a) * 0.05, 0.02, -Math.sin(a) * 0.06 + Math.cos(a) * 0.05, 0.5, 0xc0f0ff, 0.5)
        }
        continue
      }
      if (trap) continue
      if (acid) {
        // 산성 웅덩이: 부글거리며, 끝나 갈수록 옅어진다
        const fade = Math.min(1, zn.t / 40)
        ;((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (0.3 + 0.08 * Math.sin(this.t * 9 + zn.id)) * fade
        ;((g.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.7 * fade
        if (Math.random() < 0.15) {
          const a = Math.random() * Math.PI * 2
          const d = Math.random() * zn.r * U * 0.8
          this.spawnParticle(zn.x * U + Math.cos(a) * d, 0.05, zn.y * U + Math.sin(a) * d, 0, 0.03 + Math.random() * 0.03, 0, 0.5, 0xff7a4a, 0.5)
        }
        continue
      }
      if (fuse) {
        // 폭발 예고: 안쪽 원이 바깥 테두리까지 차오르면 터진다
        const k = 1 - zn.t / zn.max
        ;(g.children[0] as THREE.Mesh).scale.setScalar(Math.max(0.05, k))
        ;((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.35 * k
        ;((g.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.4 * Math.sin(this.t * 18)
        continue
      }
      const fade = Math.min(1, zn.t / 60)
      ;((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.16 * fade + 0.04 * Math.sin(this.t * 4)
      ;((g.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.8 * fade
    }
    for (const [id, g] of this.zoneMeshes) {
      if (live.has(id)) continue
      this.scene.remove(g)
      // 보스 고리 · 부채는 범위마다 도형을 만들었다 → 도형만 버린다 (같이 쓰는 도형 · 재질은 그대로 — 재질을 버리면 셰이더까지 지워진다)
      g.traverse((o) => {
        const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
        if (geo && geo !== this.zoneDisc && geo !== this.zoneRim && geo !== this.zoneLine && geo !== this.zoneLineEdge) geo.dispose()
      })
      // 재질은 해제하지 않는다 (GPU 자원이 없는 작은 재질이라 버리면 저절로 치워진다). 해제하면 그 셰이더를 쓰는 재질이
      // 하나도 안 남는 순간 셰이더 프로그램까지 지워져, 다음 장판에서 다시 컴파일하느라 화면이 멈췄다 (2026-09-23 과부하 시험)
      this.zoneMeshes.delete(id)
    }
  }

  /**
   * 보스 패턴 범위 (2026-09-23): 원 · 고리 · 줄 · 부채. 빨간 모양 안이 차오르면 터진다(줄은 길이 쪽으로, 원 · 부채는 가운데서 밖으로).
   * 이어지는 둘째 범위(wait)는 기다리는 동안 숨긴다. 빛은 달지 않는다 — 광선 여럿에 점광원을 달면 빛 수가 바뀌어 셰이더를 다시 짠다
   */
  private updateBossZone(zn: Zone): void {
    let g = this.zoneMeshes.get(zn.id)
    const shape = zn.shape ?? ZS_CIRCLE
    const warn = zn.kind === ZONE_WARN
    // 즉사기: 검붉게 덮는다(더하기가 아니라 덮기 — 바닥이 어두워진다) · 테두리는 새빨갛게 · 고리의 안쪽(안전한 곳) 테두리는 금빛
    const kill = !!zn.kill
    if (!g) {
      g = new THREE.Group()
      const fillMat = kill
        ? new THREE.MeshBasicMaterial({ color: 0x5a0008, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
        : new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      const rimMat = new THREE.MeshBasicMaterial({ color: kill ? 0xff1a0a : 0xff5a2a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
      const safeMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
      let fill: THREE.Object3D
      let rim: THREE.Object3D
      if (shape === ZS_LINE) {
        fill = new THREE.Mesh(this.zoneLine, fillMat)
        rim = new THREE.LineSegments(this.zoneLineEdge, new THREE.LineBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.9, depthWrite: false }))
      } else if (shape === ZS_RING) {
        const k = Math.max(0.02, Math.min(0.98, (zn.r2 ?? 0) / zn.r))
        fill = new THREE.Mesh(new THREE.RingGeometry(k, 1, 64), fillMat)
        const rims = new THREE.Group()
        rims.add(new THREE.Mesh(this.zoneRim, rimMat), new THREE.Mesh(new THREE.RingGeometry(k, k + (kill ? Math.max(0.004, 0.08 * k) : 0.025), 64), kill ? safeMat : rimMat))
        rim = rims
      } else if (shape === ZS_CONE) {
        const arc = ((zn.arc ?? 0) / 1024) * Math.PI * 2
        fill = new THREE.Mesh(new THREE.CircleGeometry(1, 28, -arc, arc * 2), fillMat)
        rim = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 28, 1, -arc, arc * 2), rimMat)
      } else {
        fill = new THREE.Mesh(this.zoneDisc, fillMat)
        rim = new THREE.Mesh(this.zoneRim, rimMat)
      }
      fill.rotation.x = -Math.PI / 2
      rim.rotation.x = -Math.PI / 2
      fill.userData.fill = true
      g.add(fill, rim)
      this.scene.add(g)
      this.zoneMeshes.set(zn.id, g)
    }
    g.visible = !zn.wait
    if (zn.wait) return
    g.position.set(zn.x * U, 0.05, zn.y * U)
    g.rotation.y = -((zn.a ?? 0) / 1024) * Math.PI * 2
    if (shape === ZS_LINE) g.scale.set((zn.len ?? 0) * U, 1, zn.r * 2 * U)
    else g.scale.set(zn.r * U, 1, zn.r * U)
    const k = 1 - zn.t / Math.max(1, zn.max)
    const fill = g.children[0] as THREE.Mesh
    const mat = fill.material as THREE.MeshBasicMaterial
    // 차오르기: 줄은 길이 쪽으로, 원 · 부채는 가운데서 밖으로, 고리는 진해지기만 (예고만인 것은 옅게)
    if (shape === ZS_LINE) fill.scale.set(Math.max(0.02, k), 1, 1)
    else if (shape !== ZS_RING) fill.scale.setScalar(Math.max(0.05, k))
    mat.opacity = kill ? 0.3 + 0.4 * k : warn ? 0.12 + 0.18 * k : 0.18 + 0.32 * k
    const blink = zn.t < 14 ? 0.55 + 0.45 * Math.sin(this.t * 40) : 0.75 + 0.25 * Math.sin(this.t * 12)
    g.children[1].traverse((o) => {
      const mm = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined
      if (mm) mm.opacity = blink
    })
  }

  /** 보스 범위가 터졌다: 모양대로 번쩍 + 파편 + 흔들림 */
  private onBossBlast(e: Extract<SimEvent, { type: 'bzone' }>, state: GameState, localPlayer: number): void {
    const x = e.x * U
    const z = e.y * U
    const light = this.takeLight(0xff5a2a, 14, Math.max(4, e.r * U * 2.4), 1.5)
    light.position.set(x, 1, z)
    this.flashes.push({ light, mesh: null, life: 0.16 })
    const burst = (px: number, pz: number, size: number, n: number) => {
      this.spawnImpact(px, 0.7, pz, 0xff7a4a, size)
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2
        const sp = 0.04 + Math.random() * 0.08
        this.spawnParticle(px, 0.5, pz, Math.cos(a) * sp, 0.08 + Math.random() * 0.1, Math.sin(a) * sp, 0.5, k % 2 === 0 ? 0xff8a5a : 0x6a2a1a, 0.8)
      }
    }
    if (e.shape === ZS_LINE) {
      const a = (e.a / 1024) * Math.PI * 2
      const n = Math.max(2, Math.round(e.len / 70))
      for (let i = 0; i <= n; i++) {
        const d = (e.len * i) / n
        burst(x + Math.cos(a) * d * U, z + Math.sin(a) * d * U, e.r * U * 3, 3)
      }
    } else if (e.shape === ZS_CONE) {
      const a0 = (e.a / 1024) * Math.PI * 2
      const arc = (e.arc / 1024) * Math.PI * 2
      for (let i = 0; i < 7; i++) {
        const a = a0 - arc + (arc * 2 * i) / 6
        burst(x + Math.cos(a) * e.r * U * 0.65, z + Math.sin(a) * e.r * U * 0.65, e.r * U * 0.9, 3)
      }
    } else if (e.shape === ZS_RING) {
      this.spawnRing(x, z, e.r2 * U, e.r * U, 0.45, ENEMY_AOE)
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2
        const d = ((e.r2 + e.r) / 2) * U
        burst(x + Math.cos(a) * d, z + Math.sin(a) * d, (e.r - e.r2) * U * 0.9, 2)
      }
    } else {
      this.spawnRing(x, z, 0.3, e.r * U, 0.45, ENEMY_AOE)
      burst(x, z, e.r * U * 2.2, 14)
    }
    const me = localPlayer >= 0 ? state.players[localPlayer] : null
    if (me && Math.hypot(me.x - e.x, me.y - e.y) < 600) this.shake = Math.max(this.shake, 0.3)
  }

  /** 수류탄: 던진 곳에서 목표로 포물선 */
  private updateThrows(curr: GameState): void {
    const live = new Set<number>()
    for (const t of curr.throws) {
      live.add(t.id)
      let m = this.throwMeshes.get(t.id)
      if (!m) {
        m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshLambertMaterial({ color: 0x3d4a33 }))
        m.castShadow = true
        this.scene.add(m)
        this.throwMeshes.set(t.id, m)
      }
      const k = 1 - t.t / t.max
      m.position.set((t.x0 + (t.x - t.x0) * k) * U, 0.5 + Math.sin(k * Math.PI) * 2.2, (t.y0 + (t.y - t.y0) * k) * U)
    }
    for (const [id, m] of this.throwMeshes) {
      if (live.has(id)) continue
      this.scene.remove(m)
      this.throwMeshes.delete(id)
    }
  }

  /** 버프 고리: 발밑에 버프 색 고리가 돈다 (철벽 금 · 포효 붉은 금 · 연사 주황 · 침착 노랑 · 회전 빨강 · 저격 파랑) */
  private updateAuras(curr: GameState, pos: { x: number; z: number }[]): void {
    let n = 0
    for (let i = 0; i < curr.players.length; i++) {
      const p = curr.players[i]
      if (!p.alive || p.left || p.downed || this.hidden[i]) continue
      const f = p.fx
      const col = f[FX_WHIRL] > 0 ? 0xff5a3a : f[FX_GUARD] > 0 ? 0xe0a060 : f[FX_CRIT] > 0 ? 0xffd86a : f[FX_SNIPE] > 0 ? 0x7fb8ff : f[FX_PARTYDR] > 0 ? 0xff9a50 : f[FX_RATE] > 0 ? 0xffb04a : -1
      if (col < 0) continue
      let m = this.auras[n]
      if (!m) {
        m = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 32, 1, 0, Math.PI * 1.6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }))
        m.rotation.x = -Math.PI / 2
        this.auras[n] = m
        this.scene.add(m)
      }
      m.visible = true
      ;(m.material as THREE.MeshBasicMaterial).color.setHex(col)
      m.position.set(pos[i].x, 0.05, pos[i].z)
      m.rotation.z = this.t * (f[FX_WHIRL] > 0 ? 14 : 3)
      const k = f[FX_WHIRL] > 0 ? 2.4 : 1
      m.scale.setScalar(k)
      n++
    }
    for (let i = n; i < this.auras.length; i++) this.auras[i].visible = false
  }

  /** 회복 구슬: 붉게 빛나는 구가 떠서 맥박치듯 흔들린다 — 디아블로의 체력 구슬 */
  private updateGlobes(curr: GameState): void {
    const live = new Set<number>()
    for (const g0 of curr.globes) {
      live.add(g0.id)
      let g = this.globeMeshes.get(g0.id)
      if (!g) {
        g = new THREE.Group()
        if (g0.share) {
          const core = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff3a4a }))
          const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff4a5a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
          halo.scale.setScalar(0.9)
          g.add(core, halo)
        } else {
          const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.42), new THREE.MeshLambertMaterial({ color: 0xf2f4f0 }))
          box.castShadow = true
          const crossMat = new THREE.MeshBasicMaterial({ color: 0xe4483a })
          const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.09), crossMat)
          const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.26), crossMat)
          bar1.position.y = 0.15
          bar2.position.y = 0.15
          g.add(box, bar1, bar2)
        }
        this.scene.add(g)
        this.globeMeshes.set(g0.id, g)
      }
      // 사라지기 3초 전부터 깜빡인다
      g.visible = !(g0.ttl < 180 && Math.floor(g0.ttl / 8) % 2 === 0)
      const k = 1 + Math.sin(this.t * 6 + g0.id) * 0.08
      g.scale.setScalar(k)
      g.position.set(g0.x * U, 0.35 + Math.sin(this.t * 3 + g0.id) * 0.06, g0.y * U)
    }
    for (const [id, g] of this.globeMeshes) {
      if (live.has(id)) continue
      this.scene.remove(g)
      this.globeMeshes.delete(id)
    }
  }

  /** 몬스터 투사체: 붉은 빛 구슬 (느리다 — 보고 피하라고) */
  private updateShots(prev: GameState, curr: GameState, alpha: number): void {
    const prevById = new Map<number, { x: number; y: number }>()
    for (const s0 of prev.mshots) prevById.set(s0.id, s0)
    let n = 0
    for (const s0 of curr.mshots) {
      let sp = this.shotPool[n]
      if (!sp) {
        sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff5a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
        this.shotPool[n] = sp
        this.scene.add(sp)
      }
      const p = prevById.get(s0.id) ?? s0
      sp.material.color.setHex(MONSTER_LIST[s0.kind]?.shotColor ?? 0xff5a2a)
      sp.visible = true
      sp.position.set((p.x + (s0.x - p.x) * alpha) * U, 0.9, (p.y + (s0.y - p.y) * alpha) * U)
      sp.scale.setScalar(0.55 + Math.sin(this.t * 20 + s0.id) * 0.06)
      n++
    }
    for (let i = n; i < this.shotPool.length; i++) this.shotPool[i].visible = false
  }

  /** 거대한 막 보스 빛: 보이는 가장 가까운 거대한 보스의 앞(카메라 쪽) 위에서 비춘다 (어두운 곳만) */
  private updateGiantLight(curr: GameState): void {
    const dark = this.map.theme.dark
    let best: { x: number; z: number; top: number } | null = null
    let bd = 30 * 30
    for (const m of curr.monsters) {
      if (m.hp <= 0 || !isGiant(m) || this.hiddenM.has(m.id)) continue
      const at = this.monsterView.shown.get(m.id)
      if (!at) continue
      const d = (at.x - this.camTarget.x) ** 2 + (at.z - this.camTarget.z) ** 2
      if (d < bd) {
        bd = d
        best = { x: at.x, z: at.z, top: monsterTop(m) }
      }
    }
    const l = this.giantLight
    if (!dark || !best) {
      l.visible = false
      return
    }
    l.visible = true
    l.intensity = dark.lantern * 9 * (1 + Math.sin(this.t * 2.1) * 0.05)
    l.distance = 12 + best.top * 1.6
    l.position.set(best.x + Math.sin(YAW) * best.top * 0.45, best.top * 0.6, best.z + Math.cos(YAW) * best.top * 0.45)
  }

  /** 등불: 살아 있는 플레이어마다 따뜻한 빛. 쓰러지면 꺼져 간다 (던전만) */
  private updateLanterns(curr: GameState, pos: { x: number; z: number }[]): void {
    const dark = this.map.theme.dark
    for (let i = 0; i < this.lanterns.length; i++) {
      const l = this.lanterns[i]
      const p = curr.players[i]
      if (!dark || !p || !p.alive || p.left) {
        l.visible = false
        continue
      }
      l.visible = true
      const flicker = 1 + Math.sin(this.t * 13 + i * 2) * 0.04 + Math.sin(this.t * 7.3 + i) * 0.03
      l.intensity = dark.lantern * 5 * flicker * (p.downed ? 0.45 : 1)
      l.position.set(pos[i].x, 1.7, pos[i].z)
    }
  }

  /** 땅 위 원 (예고): 월드 중심 (x, z) · 반지름 r (타일 단위) 을 화면에 점선으로 */
  private groundCircle(ctx: CanvasRenderingContext2D, x: number, z: number, r: number, color: string, alpha: number): void {
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = Math.min(1, alpha)
    ctx.lineWidth = 2
    ctx.setLineDash([7, 5])
    ctx.beginPath()
    for (let k = 0; k <= 36; k++) {
      const a = (k / 36) * Math.PI * 2
      const q = this.worldToScreen(x + Math.cos(a) * r, 0.05, z + Math.sin(a) * r)
      if (k === 0) ctx.moveTo(q.x, q.y)
      else ctx.lineTo(q.x, q.y)
    }
    ctx.stroke()
    ctx.restore()
  }

  /**
   * 몬스터 머리 위 체력 바 (최근 3초 안에 맞은 것만) + 궁수 조준선(예고 동안 붉은 선 — 피할 때라는 신호)
   */
  private drawMonsterBars(curr: GameState): void {
    const ctx = this.hud.ctx
    for (const m of curr.monsters) {
      if (m.hp <= 0 || this.hiddenM.has(m.id)) continue
      const at = this.monsterView.shown.get(m.id)
      if (!at) continue
      const def = MONSTER_LIST[m.kind]
      if (m.st === MS_WINDUP && def.attack === 'lob' && m.mode === 0) {
        // 산성·불덩이 예고: 떨어질 자리
        this.groundCircle(ctx, m.ax * U, m.ay * U, (def.blast ?? ACID.r) * U, ENEMY_AOE_CSS, 0.3 + 0.5 * (1 - m.t / def.windup))
      }
      if (m.st === MS_WINDUP && def.special === 'blink' && m.mode === 2) {
        // 그림자 순간이동 예고: 나타날 자리
        this.groundCircle(ctx, m.ax * U, m.ay * U, 0.6, '#d89aff', 0.4 + 0.5 * (1 - m.t / 22))
      }
      if (m.st === MS_WINDUP && m.pat === PAT.nova) {
        // 불꽃 고리 예고: 사방으로 짧은 선
        const n = m.stage >= 2 ? LORD.novaRage : LORD.nova
        const a0 = (m.aim / 1024) * Math.PI * 2
        const k = 1 - m.t / (m.wmax || 40)
        ctx.save()
        ctx.strokeStyle = ENEMY_AOE_CSS
        ctx.globalAlpha = 0.3 + 0.5 * k
        ctx.setLineDash([5, 5])
        for (let i = 0; i < n; i++) {
          const a = a0 + (i / n) * Math.PI * 2
          const f = this.worldToScreen(at.x + Math.cos(a) * 1.2, 0.9, at.z + Math.sin(a) * 1.2)
          const t = this.worldToScreen(at.x + Math.cos(a) * (3 + k * 3), 0.9, at.z + Math.sin(a) * (3 + k * 3))
          ctx.beginPath()
          ctx.moveTo(f.x, f.y)
          ctx.lineTo(t.x, t.y)
          ctx.stroke()
        }
        ctx.restore()
      }
      if (m.st === MS_WINDUP && m.pat === PAT.fan) {
        // 거미줄 부채 예고: 일곱 갈래 (분노하면 아홉)
        const a0 = Math.atan2(m.ay - m.y, m.ax - m.x)
        const n = m.stage >= 1 ? QUEEN.fanRage : QUEEN.fan
        const h = (n - 1) / 2
        ctx.save()
        ctx.strokeStyle = '#e8f0d8'
        ctx.globalAlpha = 0.5
        ctx.setLineDash([6, 6])
        const from = this.worldToScreen(at.x, 0.9, at.z)
        for (let k = 0; k < n; k++) {
          const a = a0 + ((k - h) / h) * ((QUEEN.spread * Math.PI) / 180)
          const to = this.worldToScreen(at.x + Math.cos(a) * 9, 0.9, at.z + Math.sin(a) * 9)
          ctx.beginPath()
          ctx.moveTo(from.x, from.y)
          ctx.lineTo(to.x, to.y)
          ctx.stroke()
        }
        ctx.restore()
      }
      if (m.st === MS_WINDUP && ((def.attack === 'ranged' && m.mode === 0) || m.mode === 1)) {
        const k = 1 - m.t / def.windup
        const a = this.worldToScreen(at.x, 0.9, at.z)
        const b = this.worldToScreen(m.ax * U, 0.9, m.ay * U)
        ctx.save()
        ctx.globalAlpha = 0.25 + k * 0.6
        ctx.strokeStyle = '#ff4a3a'
        ctx.lineWidth = 1 + k * 2
        ctx.setLineDash([8, 6])
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(a.x + (b.x - a.x) * 1.4, a.y + (b.y - a.y) * 1.4)
        ctx.stroke()
        ctx.restore()
      }
      this.drawSay(ctx, m, at, def)
      // 정예는 늘, 나머지는 맞은 뒤 3초만. 보스 · 우두머리는 화면 위 큰 막대와 따로 머리 위에 큰 이름표
      const goblin = def.attack === 'flee'
      if (isBossLike(m)) {
        this.drawBossPlate(ctx, curr, m, at, def)
        continue
      }
      if (!m.elite && !goblin && curr.tick - m.hitTick > 180) continue
      const s0 = this.worldToScreen(at.x, MONSTER_TOP[m.kind] * (def.r / 13) + 0.15, at.z)
      const w = 30
      const k = Math.max(0, m.hp / m.maxHp)
      ctx.globalAlpha = m.elite ? 1 : Math.min(1, (180 - (curr.tick - m.hitTick)) / 30)
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(s0.x - w / 2, s0.y, w, 4)
      ctx.fillStyle = m.elite || goblin ? '#ffb84a' : '#e04a3a'
      ctx.fillRect(s0.x - w / 2 + 1, s0.y + 1, (w - 2) * k, 2)
      if (goblin) {
        ctx.font = '700 10px "Nanum Myeongjo", serif'
        ctx.textAlign = 'center'
        ctx.fillStyle = '#ffd86a'
        ctx.fillText('보물 고블린', s0.x, s0.y - 4)
      }
      if (m.elite) {
        ctx.font = '700 10px "Nanum Myeongjo", serif'
        ctx.textAlign = 'center'
        ctx.fillStyle = '#ffd86a'
        ctx.fillText(`정예 ${def.name}`, s0.x, s0.y - 4)
        const af = affixNames(m.elite)
        if (af) {
          ctx.font = '600 9px system-ui, sans-serif'
          ctx.fillStyle = '#e8b0ff'
          ctx.fillText(af, s0.x, s0.y - 15)
        }
      }
      ctx.globalAlpha = 1
    }
  }

  /**
   * 보스 · 우두머리 머리 위 큰 이름표 (2026-09-23 사용자: "중간보스 · 막 보스는 화면 위 가운데에만 이름과 체력이 떠서
   * 누가 보스인지 안 보인다 — 보스 위에 이름표를 크게"). 표 · 이름 · 체력 막대 — 높이 BOSS_PLATE_H 만큼(말풍선은 그 위로).
   */
  private drawBossPlate(ctx: CanvasRenderingContext2D, curr: GameState, m: Monster, at: { x: number; z: number }, def: MonsterDef): void {
    const unique = !def.boss
    const p = this.bossPlateAt(m, at, def)
    const name = (unique && curr.curArea >= 0 ? areaDef(curr.curArea).unique?.name : undefined) ?? def.name
    const col = unique ? '#ffb46a' : '#ff6a4a'
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.font = '800 22px "Nanum Myeongjo", serif'
    const w = Math.max(104, ctx.measureText(name).width + 30)
    const by = p.y - 10
    // 체력 막대 (금 테)
    const k = Math.max(0, Math.min(1, m.hp / m.maxHp))
    ctx.fillStyle = 'rgba(0,0,0,0.72)'
    ctx.fillRect(p.x - w / 2, by, w, 7)
    const g = ctx.createLinearGradient(p.x - w / 2, 0, p.x + w / 2, 0)
    g.addColorStop(0, '#6a0a0a')
    g.addColorStop(1, '#e0402a')
    ctx.fillStyle = g
    ctx.fillRect(p.x - w / 2 + 1, by + 1, (w - 2) * k, 5)
    ctx.strokeStyle = 'rgba(201,162,74,0.85)'
    ctx.lineWidth = 1
    ctx.strokeRect(p.x - w / 2 - 0.5, by - 0.5, w + 1, 8)
    // 이름
    ctx.lineJoin = 'round'
    ctx.lineWidth = 5
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.strokeText(name, p.x, by - 6)
    ctx.shadowColor = unique ? 'rgba(255,160,80,0.55)' : 'rgba(255,70,40,0.6)'
    ctx.shadowBlur = 10
    ctx.fillStyle = col
    ctx.fillText(name, p.x, by - 6)
    ctx.shadowBlur = 0
    // 표: ── 보스 ── / ── 우두머리 ──
    const tag = unique ? '우두머리' : '보스'
    const ty = by - 32
    ctx.font = '800 11px "IBM Plex Sans KR", sans-serif'
    const tw = ctx.measureText(tag).width
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'
    ctx.strokeText(tag, p.x, ty)
    ctx.fillStyle = '#f1d58a'
    ctx.fillText(tag, p.x, ty)
    ctx.strokeStyle = 'rgba(241,213,138,0.7)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(p.x - tw / 2 - 30, ty - 4)
    ctx.lineTo(p.x - tw / 2 - 6, ty - 4)
    ctx.moveTo(p.x + tw / 2 + 6, ty - 4)
    ctx.lineTo(p.x + tw / 2 + 30, ty - 4)
    ctx.stroke()
    // 보스 패턴 이름 (예고 동안 — 몇 번 보면 이름과 모양을 외운다)
    const pat = (m.pat ?? -1) >= 0 ? BOSS_PATS[m.pat!] : undefined
    if (pat && m.st === MS_WINDUP) {
      ctx.font = '800 15px "IBM Plex Sans KR", sans-serif'
      ctx.lineWidth = 4
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.strokeText(`${pat.name}!`, p.x, by + 24)
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(this.t * 14)
      ctx.fillStyle = '#ff6a4a'
      ctx.fillText(`${pat.name}!`, p.x, by + 24)
      ctx.globalAlpha = 1
    }
    // 우두머리의 정예 능력 (막대 아래 작게)
    const af = affixNames(m.elite)
    if (af) {
      ctx.font = '600 10px system-ui, sans-serif'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'
      ctx.strokeText(af, p.x, by + 19)
      ctx.fillStyle = '#e8b0ff'
      ctx.fillText(af, p.x, by + 19)
    }
    ctx.restore()
  }

  /**
   * 보스 이름표 자리: 모델 키 바로 위 (실사 모델은 키 = MONSTER_TOP × 크기 — 예전 1.4 배는 머리 위로 한참 떴다).
   * 거대한 보스는 머리가 화면 위로 나가기도 한다 → 화면 안(위에서 90px)에 붙잡아 둔다
   */
  private bossPlateAt(m: Monster, at: { x: number; z: number }, _def: MonsterDef): { x: number; y: number } {
    const p = this.worldToScreen(at.x, monsterTop(m) + 0.3, at.z)
    if (isGiant(m)) p.y = Math.max(p.y, 90)
    return p
  }

  /**
   * 조준점 (sim px): 보통은 커서 아래 바닥. 커서가 **거대한 보스의 몸** 위면 그 보스를 겨눈다 (2026-09-24 — 보스가 네 배로 커져
   * 몸 위쪽을 누르면 바닥 자리가 보스 한참 뒤였다). 머리 쪽(위 30%)이면 가운데 — 약점(치명타), 아니면 몸 앞쪽(치명타 아님)
   */
  aimPoint(sx: number, sy: number, state?: GameState, me?: { x: number; y: number }): { x: number; y: number } {
    const w = this.screenToWorld(sx, sy)
    state ??= this.lastCurr ?? undefined
    if (!state) return w
    let best: { x: number; y: number } | null = null
    let bestD = Infinity
    for (const m of state.monsters) {
      if (m.hp <= 0 || !isGiant(m) || this.hiddenM.has(m.id)) continue
      const at = this.monsterView.shown.get(m.id)
      if (!at) continue
      const foot = this.worldToScreen(at.x, 0, at.z)
      const top = this.worldToScreen(at.x, monsterTop(m), at.z)
      const h = foot.y - top.y
      if (h <= 0) continue
      const half = h * (isQuadruped(m.kind) ? 0.62 : 0.3)
      if (sy < top.y || sy > foot.y + h * 0.08 || Math.abs(sx - foot.x) > half) continue
      const d = Math.abs(sx - foot.x)
      if (d >= bestD) continue
      bestD = d
      const head = sy < top.y + h * 0.3
      if (head || !me) best = { x: m.x, y: m.y }
      else {
        // 몸 앞쪽: 가운데에서 나를 향해 몸 반지름의 0.7 (약점 반경 0.5 밖)
        const dx = me.x - m.x
        const dy = me.y - m.y
        const dd = Math.hypot(dx, dy) || 1
        const k = Math.min(bodyR(m) * 0.7, dd * 0.5)
        best = { x: m.x + (dx / dd) * k, y: m.y + (dy / dd) * k }
      }
    }
    return best ?? w
  }

  /** 괴물 머리 위: 후원 소환 이름표("○○님의 도살자") · 말풍선(방송 채팅 · 후원 글). 말풍선 자리를 기억해 둔다 */
  private drawSay(ctx: CanvasRenderingContext2D, m: Monster, at: { x: number; z: number }, def: MonsterDef): void {
    const top = isGiant(m) ? monsterTop(m) : MONSTER_TOP[m.kind] * (def.r / 13) * ((m.elite & EA_UNIQUE) || def.boss ? 1.4 : 1)
    let head = this.worldToScreen(at.x, top + 0.35, at.z)
    // 보스 · 우두머리는 큰 이름표(drawBossPlate) 위로
    if (isBossLike(m)) {
      const p = this.bossPlateAt(m, at, def)
      head = { x: p.x, y: p.y - BOSS_PLATE_H }
    }
    if (m.sum !== undefined) {
      const who = this.summonLabel?.(m.sumBy ?? -1, m.sum - 1)
      if (who) {
        ctx.save()
        ctx.font = `800 12px ${SAY_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(0,0,0,0.75)'
        const label = `${who} ${def.name}`
        ctx.strokeText(label, head.x, head.y - 14)
        ctx.fillStyle = '#7dffc4'
        ctx.fillText(label, head.x, head.y - 14)
        ctx.restore()
        head = { x: head.x, y: head.y - 16 }
      }
    }
    const say = this.says.get(m.id)
    if (!say) return
    say.x = at.x
    say.z = at.z
    say.top = top
    this.drawBubble(ctx, head, say)
  }

  /**
   * 응원 아군 괴물 머리 위 (초록): 졸개는 "아군 · 남은 초" 만 (넷이 붙어 서면 긴 이름표가 겹쳤다 — 보낸 사람은 배너 · 채팅 줄에),
   * 보스 모습은 "○○님의 아군 · 남은 초"
   */
  private drawAllyTags(curr: GameState): void {
    if (!curr.allies?.length) return
    const ctx = this.hud.ctx
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'
    for (const a of curr.allies) {
      const at = this.monsterView.shown.get(a.id)
      if (!at) continue
      const def = MONSTER_LIST[a.kind]
      const p = this.worldToScreen(at.x, MONSTER_TOP[a.kind] * (def.r / 13) + 0.3, at.z)
      const who = def.boss ? this.summonLabel?.(a.by, a.seq) : undefined
      const label = `${who ? `${who}님의 아군` : '아군'} · ${Math.ceil(a.t / 60)}`
      ctx.font = `800 ${def.boss ? 14 : 11}px ${SAY_FONT}`
      ctx.strokeText(label, p.x, p.y)
      ctx.fillStyle = ALLY_TAG
      ctx.fillText(label, p.x, p.y)
    }
    ctx.restore()
  }

  /** 괴물이 쓰러졌거나 사라진 말풍선: 마지막으로 그린 자리(시체 위, 조금 낮게)에 제 시간까지 */
  private drawOrphanSays(curr: GameState): void {
    if (this.says.size === 0) return
    const alive = new Set<number>()
    for (const m of curr.monsters) if (m.hp > 0) alive.add(m.id)
    const ctx = this.hud.ctx
    for (const [id, say] of this.says) {
      if (alive.has(id)) continue
      if (say.x === undefined || say.z === undefined || say.until <= performance.now()) {
        if (say.until <= performance.now()) this.says.delete(id)
        continue
      }
      this.drawBubble(ctx, this.worldToScreen(say.x, (say.top ?? 1) * 0.5 + 0.35, say.z), say)
    }
  }

  private drawBubble(ctx: CanvasRenderingContext2D, head: { x: number; y: number }, say: { nick: string; text: string; until: number; gold: boolean; warn?: boolean }): void {
    const left = say.until - performance.now()
    if (left <= 0) return
    ctx.save()
    ctx.globalAlpha = Math.min(1, left / 350)
    // 보스 즉사기 대사(warn): 크고 검붉게 — 무엇이 오는지 한눈에
    const warn = !!say.warn
    ctx.font = warn ? `800 19px ${SAY_FONT}` : `700 14px ${SAY_FONT}`
    const tw = ctx.measureText(say.text).width
    ctx.font = `800 ${warn ? 13 : 11}px ${SAY_FONT}`
    const nw = ctx.measureText(say.nick).width
    const w = Math.max(tw, nw) + (warn ? 30 : 22)
    const h = warn ? 52 : 40
    const bx = head.x - w / 2
    const by = head.y - 26 - h
    ctx.fillStyle = warn ? '#2a0406' : say.gold ? '#fff4d0' : '#ffffff'
    roundRect(ctx, bx, by, w, h, 10)
    ctx.fill()
    if (say.gold || warn) {
      ctx.strokeStyle = warn ? `rgba(255,60,40,${0.6 + 0.4 * Math.sin(performance.now() / 70)})` : '#d8a83a'
      ctx.lineWidth = warn ? 3 : 2
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(head.x - 6, by + h - 1)
    ctx.lineTo(head.x + 6, by + h - 1)
    ctx.lineTo(head.x, by + h + 8)
    ctx.closePath()
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `800 ${warn ? 13 : 11}px ${SAY_FONT}`
    ctx.fillStyle = warn ? '#ff8a6a' : say.gold ? '#9a6a10' : '#12a86a'
    ctx.fillText(say.nick, head.x, by + (warn ? 15 : 12))
    ctx.font = warn ? `800 19px ${SAY_FONT}` : `700 14px ${SAY_FONT}`
    ctx.fillStyle = warn ? '#ffffff' : '#1a1f26'
    ctx.fillText(say.text, head.x, by + (warn ? 36 : 28))
    ctx.restore()
  }

  /**
   * 막 보스 즉사기 경고 (2026-09-24 사용자: "화면에서도 주의하라는 게 잘 보이도록"): 예고 동안 화면 가장자리가 붉게 맥박치고,
   * 가운데 위에 "⚠ 즉사기 — 이름" 과 피하는 법 한 줄 · 남은 시간 막대. 끝나 갈수록 빨리 깜빡인다
   */
  private drawUltWarn(): void {
    const w = this.ultWarn
    if (!w) return
    const now = performance.now()
    if (now > w.until + 400) {
      this.ultWarn = null
      return
    }
    const left = Math.max(0, (w.until - now) / Math.max(1, w.until - w.t0))
    const fade = Math.min(1, (now - w.t0) / 200) * Math.min(1, (w.until + 400 - now) / 400)
    const pulse = 0.5 + 0.5 * Math.sin((now - w.t0) / (left < 0.3 ? 45 : 110))
    const ctx = this.hud.ctx
    ctx.save()
    const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.32, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.62)
    g.addColorStop(0, 'rgba(160,0,0,0)')
    g.addColorStop(1, `rgba(170,0,0,${(0.3 + 0.35 * pulse) * fade})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    ctx.globalAlpha = fade
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    const y = VIEW_H * 0.3
    ctx.font = `900 ${Math.round(38 * VIEW_K)}px ${SAY_FONT}`
    ctx.lineWidth = 6
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    const title = `⚠ 즉사기 — ${w.name}`
    ctx.strokeText(title, VIEW_W / 2, y)
    ctx.fillStyle = `rgb(255,${Math.round(70 + 90 * pulse)},${Math.round(50 + 40 * pulse)})`
    ctx.fillText(title, VIEW_W / 2, y)
    ctx.font = `800 ${Math.round(20 * VIEW_K)}px ${SAY_FONT}`
    ctx.lineWidth = 4
    ctx.strokeText(w.hint, VIEW_W / 2, y + 34 * VIEW_K)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(w.hint, VIEW_W / 2, y + 34 * VIEW_K)
    // 남은 시간 막대
    const bw = 360 * VIEW_K
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(VIEW_W / 2 - bw / 2, y + 48 * VIEW_K, bw, 6 * VIEW_K)
    ctx.fillStyle = '#ff3a2a'
    ctx.fillRect(VIEW_W / 2 - bw / 2, y + 48 * VIEW_K, bw * left, 6 * VIEW_K)
    ctx.restore()
  }

  /** 쓰러진 동료: 머리 위에 남은 시간 · 일으키는 진행 고리, 가까이 가면 "F 길게" 안내 */
  private drawDowned(curr: GameState, pos: { x: number; z: number }[], opts: RenderOptions): void {
    const ctx = this.hud.ctx
    const me = opts.localPlayer >= 0 ? curr.players[opts.localPlayer] : null
    for (let i = 0; i < curr.players.length; i++) {
      const p = curr.players[i]
      if (!p.alive || !p.downed || p.left) continue
      const s0 = this.worldToScreen(pos[i].x, 1.2, pos[i].z)
      const r = 17
      ctx.save()
      ctx.fillStyle = 'rgba(13,17,23,0.75)'
      ctx.beginPath()
      ctx.arc(s0.x, s0.y, r + 4, 0, Math.PI * 2)
      ctx.fill()
      // 남은 시간 (빨강) · 일으키는 진행 (파랑)
      ctx.lineWidth = 4
      ctx.strokeStyle = '#ff5a4a'
      ctx.beginPath()
      ctx.arc(s0.x, s0.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p.downTimer / (60 * 12)))
      ctx.stroke()
      if (p.revive > 0) {
        ctx.strokeStyle = '#9fe0ff'
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.arc(s0.x, s0.y, r - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (p.revive / REVIVE_TICKS))
        ctx.stroke()
      }
      ctx.font = '700 13px "IBM Plex Sans KR", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ffffff'
      ctx.fillText(`${Math.ceil(p.downTimer / 60)}`, s0.x, s0.y + 1)
      if (me && me.id !== i && me.alive && !me.downed && Math.hypot(me.x - p.x, me.y - p.y) < 90) {
        ctx.font = '600 13px "IBM Plex Sans KR", sans-serif'
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'
        ctx.strokeText('F 누르고 있기: 일으키기', s0.x, s0.y - 32)
        ctx.fillStyle = '#9fe0ff'
        ctx.fillText('F 누르고 있기: 일으키기', s0.x, s0.y - 32)
      }
      ctx.restore()
    }
  }

  private updateBullets(prev: GameState, curr: GameState, alpha: number): void {
    const prevById = new Map<number, { x: number; y: number }>()
    for (const b of prev.bullets) prevById.set(b.id, { x: b.x, y: b.y })
    let n = 0
    for (const b of curr.bullets) {
      const pb = prevById.get(b.id) ?? { x: b.px, y: b.py }
      const x = (pb.x + (b.x - pb.x) * alpha) * U
      const z = (pb.y + (b.y - pb.y) * alpha) * U
      let streak = this.bulletPool[n]
      if (!streak) {
        streak = this.makeStreak()
        this.bulletPool[n] = streak
        this.scene.add(streak)
      }
      streak.visible = true
      const speed = Math.hypot(b.vx, b.vy)
      const dx = speed > 0 ? b.vx / speed : 1
      const dz = speed > 0 ? b.vy / speed : 0
      // 무기마다 줄기 길이·색이 다르다: 저격은 길고 하얗게, 산탄은 짧고 주황
      const w = WEAPONS[b.weapon]
      const sn = w.family === 'sniper'
      const mat = sn ? this.streakMats.sniper : w.pellets > 1 ? this.streakMats.shotgun : this.streakMats.default
      for (const child of streak.children) (child as THREE.Mesh).material = mat
      const len = speed * U * (sn ? 3.4 : w.pellets > 1 ? 1.3 : 2.1)
      const wid = sn ? 0.14 : w.boom ? 0.2 : 0.1
      // 머리(밝은 끝)가 탄 위치, 꼬리는 뒤로
      streak.position.set(x - dx * len * 0.5, GUN_H, z - dz * len * 0.5)
      streak.rotation.y = -Math.atan2(dz, dx)
      streak.scale.set(len, wid, wid)
      n++
    }
    for (let i = n; i < this.bulletPool.length; i++) this.bulletPool[i].visible = false
  }

  private updateEffects(dt: number): void {
    // 파편: 산 것만 앞으로 모으며(순서 유지 — 넘칠 때 앞의 오래된 것을 버린다) 인스턴스 하나에 적는다
    let live = 0
    const pm = this.partMesh
    const pc = pm.instanceColor!
    const d = this.partDummy
    const k = dt * 60
    for (let i = 0; i < this.particles.length; i++) {
      const q = this.particles[i]
      q.life -= dt
      if (q.life <= 0) continue
      q.x += q.vx * k
      q.y += q.vy * k
      q.z += q.vz * k
      q.vy -= q.gravity * dt
      if (q.y < 0.05) {
        q.y = 0.05
        q.vy = -q.vy * 0.3
        q.vx *= 0.7
        q.vz *= 0.7
      }
      q.rx += q.spin * dt
      q.rz += q.spin * dt
      d.position.set(q.x, q.y, q.z)
      d.rotation.set(q.rx, 0, q.rz)
      d.scale.setScalar(q.size)
      d.updateMatrix()
      pm.setMatrixAt(live, d.matrix)
      pc.setXYZ(live, q.r, q.g, q.b)
      this.particles[live++] = q
    }
    this.particles.length = live
    pm.count = live
    pm.instanceMatrix.needsUpdate = true
    pc.needsUpdate = true
    for (let i = this.texts.length - 1; i >= 0; i--) {
      this.texts[i].life -= dt
      if (this.texts[i].life <= 0) this.texts.splice(i, 1)
    }
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const im = this.impacts[i]
      im.life -= dt
      if (im.life <= 0) {
        this.endImpact(i)
        continue
      }
      const k = 1 - im.life / im.max
      im.sprite.scale.setScalar(im.size * (0.5 + k * 1.1))
      ;(im.sprite.material as THREE.SpriteMaterial).opacity = 1 - k
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]
      f.life -= dt
      if (f.life <= 0) this.endFlash(i)
    }
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const sl = this.slashes[i]
      sl.life -= dt
      if (sl.life <= 0) {
        this.scene.remove(sl.mesh)
        this.slashPool.push(sl.mesh)
        this.slashes.splice(i, 1)
        continue
      }
      const k = 1 - sl.life / sl.max
      sl.mesh.scale.setScalar(0.85 + 0.25 * k)
      ;(sl.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k)
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.life -= dt
      if (r.life <= 0) {
        this.endRing(i)
        continue
      }
      const k = 1 - r.life / r.max
      const rad = r.r0 + (r.r1 - r.r0) * k
      r.mesh.scale.setScalar(rad)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * r.peak
    }
    for (let i = this.pings.length - 1; i >= 0; i--) {
      this.pings[i].life -= dt
      if (this.pings[i].life <= 0) this.pings.splice(i, 1)
    }
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i]
      m.life -= dt
      if (m.life <= 0) {
        this.scene.remove(m.mesh)
        this.marks.splice(i, 1)
        continue
      }
      // 콩콩 뛰듯 크기를 흔들어 눈에 띄게
      const k = 1 + Math.sin(this.t * 6) * 0.12
      m.mesh.scale.setScalar(k)
      ;(m.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, m.life / 1.2) * 0.95
    }
    for (const v of this.vis) if (v.deadT >= 0) v.deadT += dt
    for (let i = 0; i < this.hitShow.length; i++) this.hitShow[i] = Math.max(0, this.hitShow[i] - dt)
    for (const v of this.vis) {
      if (v.hitCd > 0) v.hitCd -= dt
      if (v.swing > 0) v.swing = Math.max(0, v.swing - dt * 4)
    }
    this.shake = Math.max(0, this.shake - dt * 1.4)
    this.kick = Math.max(0, this.kick - dt * 5)
    this.punch = Math.max(0, this.punch - dt * 4.5)
    this.blood?.update(dt)
    this.scopeFlash = Math.max(0, this.scopeFlash - dt * 3.2)
  }

  private updateCamera(curr: GameState, pos: { x: number; z: number }[], dt: number, opts: RenderOptions): void {
    const lp = opts.viewer ?? opts.localPlayer
    let tx: number
    let tz: number
    let dist = FOLLOW_DIST
    if (opts.cameraMode === 'both' || lp === -1) {
      // 살아있는 모두가 보이도록
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      let count = 0
      for (let i = 0; i < curr.players.length; i++) {
        const p = curr.players[i]
        if (!p.alive || p.left) continue
        minX = Math.min(minX, pos[i].x)
        maxX = Math.max(maxX, pos[i].x)
        minZ = Math.min(minZ, pos[i].z)
        maxZ = Math.max(maxZ, pos[i].z)
        count++
      }
      if (count === 0) {
        tx = this.camTarget.x
        tz = this.camTarget.z
      } else {
        tx = (minX + maxX) / 2
        tz = (minZ + maxZ) / 2
        const ext = Math.max(maxX - minX, (maxZ - minZ) * 1.5)
        dist = Math.max(11, Math.min(26, 8 + ext * 0.95))
        if (count === 1) dist = 12
        if (curr.players.length === 2 && count === 2 && ext > 20) {
          // 둘이 아주 멀면 P1 추적
          const k = Math.min(1, (ext - 20) / 12)
          tx = tx * (1 - k) + pos[0].x * k
          tz = tz * (1 - k) + pos[0].z * k
          dist = 14
        }
      }
    } else {
      const me = curr.players[lp]
      tx = pos[lp].x
      tz = pos[lp].z
      // 정조준이면 조준 쪽을 더 보여 준다. 단 후원 "손 떨림" 중에는 하지 않는다 — 조준이 좌우로 흔들려
      // 카메라가 따라 흔들리면 화면 전체가 정신없이 떨렸다 (2026-09-23 사용자: "화면 흔들림은 없도록"). 조준만 흔들린다
      if (me.alive && me.ads && !((me.don?.[DON_SHAKE] ?? 0) > 0)) {
        const r = angleToRad(me.aim)
        // 조준경은 앞을 더 보여 주되, 너무 멀리 밀면 조준선이 화면에서 빨리 움직여 맞히기 어렵다
        const reach = this.scoped ? 5 : 3
        tx += Math.cos(r) * reach
        tz += Math.sin(r) * reach
      }
      dist = FOLLOW_DIST * (this.scoped ? 1.45 : 1)
    }
    // 저격 반동: 조준 반대쪽으로 밀렸다가 돌아온다
    if (this.kick > 0) {
      tx -= Math.cos(this.kickDir) * this.kick
      tz -= Math.sin(this.kickDir) * this.kick
    }
    // 맵 밖이 덜 보이도록 클램프 (요 45° 라 두 축 같은 여유)
    const margin = dist * 0.3
    tx = Math.max(margin - 2, Math.min(this.map.w - margin + 2, tx))
    tz = Math.max(margin - 2, Math.min(this.map.h - margin + 2, tz))
    if (!this.camInit) {
      this.camTarget.set(tx, 0, tz)
      this.camDist = dist
      this.camInit = true
    } else {
      // 조준경일 때는 더 천천히 따라가서 손떨림이 화면을 흔들지 않게 한다
      const s = 1 - Math.pow(this.scoped ? 0.06 : 0.002, Math.max(0, dt))
      this.camTarget.x += (tx - this.camTarget.x) * s
      this.camTarget.z += (tz - this.camTarget.z) * s
      this.camDist += (dist - this.camDist) * s * 0.7
    }
    const shx = (Math.random() - 0.5) * this.shake
    const shz = (Math.random() - 0.5) * this.shake
    const cx = this.camTarget.x + shx
    const cz = this.camTarget.z + shz
    // 카메라 펀치: 잠깐 당겨졌다 돌아온다 (최대 7%)
    const cd = this.camDist * this.debugZoom * (1 - Math.min(1, this.punch) * 0.07)
    const flat = Math.cos(PITCH) * cd
    this.camera.position.set(cx + Math.sin(YAW) * flat, Math.sin(PITCH) * cd, cz + Math.cos(YAW) * flat)
    this.camera.lookAt(cx, 0.6, cz)
    // 그림자 카메라가 시점을 따라오도록
    this.world.sun.position.set(this.camTarget.x + 8, 18, this.camTarget.z + 10)
    this.world.sun.target.position.set(this.camTarget.x, 0, this.camTarget.z)
  }

  /** 쏜 방향 (쏜 사람 → 맞은 자리, 그림 좌표의 단위 벡터). 쏜 사람을 모르면 (0, 0) */
  private shotDir(state: GameState, by: number, x: number, y: number): { x: number; z: number } {
    const sh = by >= 0 ? state.players[by] : undefined
    if (!sh) return { x: 0, z: 0 }
    const dx = x - sh.x
    const dy = y - sh.y
    const d = Math.hypot(dx, dy)
    return d < 1 ? { x: 0, z: 0 } : { x: dx / d, z: dy / d }
  }

  /** 바닥 핏자국 하나 (처음 쓸 때 만든다). dir = 튄 방향(월드 x · z) — 튄 자국 모양을 그쪽으로 눕힌다 */
  private addBlood(x: number, z: number, size: number, kinds: number[], dir?: { x: number; z: number }): void {
    if (!this.blood) {
      this.blood = new BloodDecals()
      this.scene.add(this.blood.mesh)
    }
    this.blood.add(x, z, size, kinds, dir && (dir.x !== 0 || dir.z !== 0) ? Math.atan2(dir.z, dir.x) : undefined)
  }

  /** 관전 시트용: 캐릭터를 특정 위치·회전으로 직접 배치하고 렌더 */
  renderRaw(): void {
    this.gl.render(this.scene, this.camera)
  }

  setSun(x: number, y: number, z: number): void {
    this.world.sun.position.set(x, y, z)
    this.world.sun.target.position.set(this.camera.position.x, 0, this.camera.position.z + 6)
  }

  get threeScene(): THREE.Scene {
    return this.scene
  }
  get threeCamera(): THREE.PerspectiveCamera {
    return this.camera
  }

  dispose(): void {
    this.monsterView.dispose()
    void this.lastKiller
    this.vision.dispose()
    this.world.dispose()
    for (const p of this.prebuilt.values()) this.dropPrebuilt(p)
    this.prebuilt.clear()
    this.prebuilding.clear()
    this.prepJobs = []
    this.gl.dispose()
    this.canvas.remove()
    this.hud.canvas.remove()
  }
}

function newVis(): DuckVis {
  return { sx: 1, sy: 1, vsx: 0, vsy: 0, walk: 0, flash: 0, flashColor: 0xffffff, deadT: -1, fall: 0, hitCd: 0, swing: 0, reloadSwing: 0 }
}

export { hex, PLAYER_RADIUS }

/**
 * 범위의 색이 뜻을 가진다 (2026-09-23 사용자: "적의 범위 공격은 빨강, 우리 편 힐 · 좋은 효과는 초록").
 * 빨강 = 적의 범위 공격(장판 · 예고 원 · 폭발) · 초록 = 동료를 고치거나 지켜 주는 범위 · 보라 = 적이 세지는 것(괴물 치유 등).
 * 초록을 다른 뜻에 쓰지 말 것 — 예전 산성 웅덩이가 초록이라 좋은 범위로 착각했다.
 */
/** 응원 아군 이름표 색 */
const ALLY_TAG = '#8dffb0'

/** 아군을 괴물 모습으로 (monsterView 는 괴물만 그린다 — 보간 스냅샷은 id · x · y 만 있다) */
function allyLook(a: Ally): Monster {
  return { id: a.id, kind: a.kind, x: a.x, y: a.y, aim: a.aim, hp: 1, maxHp: 1, st: MS_CHASE, t: 0, moving: a.moving, elite: 0, ally: 1 } as unknown as Monster
}

function withAllies(s: GameState): GameState {
  return s.allies?.length ? { ...s, monsters: s.monsters.concat(s.allies.map(allyLook)) } : s
}

/** 보스 이름표 높이 (말풍선 · 소환 이름표를 그 위로 올린다) */
const BOSS_PLATE_H = 50
const ENEMY_AOE = 0xff4a3a
const ENEMY_AOE_CSS = '#ff4a3a'
const ALLY_GOOD = 0x5aff8a
const ENEMY_BUFF = 0xc070ff

/** 스킬 색 (고리·입자). skillIcons 의 색과 맞춘다 */
const SKILL_COLOR: Record<string, number> = {
  ironwall: 0xe0a060, barrage: 0xffb04a, roar: 0xff7a40,
  pierce: 0x7fd6d0, grenade: 0xffa040, composure: 0xffd86a,
  broadcast: 0xb99cff, fanfire: 0xb99cff, spotlight: 0xfff0b0,
  firstaid: 0x7ee0a0, flame: 0xff8a3a, surgery: 0xb0ffcc,
  pancharge: 0xffb070, oil: 0xe8d060, kitchen: 0xff5a3a,
  catstep: 0x9cc8ff, railshot: 0x9cc8ff, ninelives: 0xffd86a,
  flash: 0xfff4a0, mirror: 0xc8f0ff, supernova: 0xffe070,
  stunt: 0xe8c070, curtain: 0xd0506a, redcarpet: 0xff4a5a,
  overdrive: 0xff9a3a, shout: 0xffb050, kingrage: 0xffd040,
  advice: 0xffd06a, cluck: 0xffb84a, kenwang: 0xff9a3a, bladewind: 0xa0f0e0,
  snack: 0xffc070, trap: 0xc09060, angelshot: 0xfff0c0,
  catwalk: 0xf0a0d0, flashbulb: 0xffffff, encore: 0xffd0f0,
}

/** 빛줄기 텍스처: 머리(u=1)는 밝고 꼬리(u=0)로 갈수록 사라진다. 위아래 가장자리도 부드럽게 */
function makeStreakTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 16
  const g = c.getContext('2d')!
  const h = g.createLinearGradient(0, 0, 128, 0)
  h.addColorStop(0, 'rgba(255,255,255,0)')
  h.addColorStop(0.5, 'rgba(255,255,255,0.3)')
  h.addColorStop(0.88, 'rgba(255,255,255,1)')
  h.addColorStop(1, 'rgba(255,255,255,0.85)')
  g.fillStyle = h
  g.fillRect(0, 0, 128, 16)
  const v = g.createLinearGradient(0, 0, 0, 16)
  v.addColorStop(0, 'rgba(0,0,0,1)')
  v.addColorStop(0.45, 'rgba(0,0,0,0)')
  v.addColorStop(0.55, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,1)')
  g.globalCompositeOperation = 'destination-out'
  g.fillStyle = v
  g.fillRect(0, 0, 128, 16)
  const t = new THREE.CanvasTexture(c)
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  return t
}

/** 빛무리 텍스처: 가운데가 밝고 가장자리로 사라지는 원 (명중·벽 섬광) */
function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')!
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, 'rgba(255,255,255,1)')
  r.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  return t
}
