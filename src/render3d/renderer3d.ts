// Three.js 렌더러. sim 상태(prev, curr)를 보간해 그린다. sim 을 절대 바꾸지 않는다.
// 카메라: 고정 피치 55°, 요 45° 고정(camera.ts). HUD 는 2D 캔버스 오버레이. 인원 2~4명.

import * as THREE from 'three'
import { CHARACTERS, headHitScale } from '../core/characters'
import { angleToRad } from '../core/fixedmath'
import { GameMap, SANDBAG_HP, TILE } from '../core/map'
import { DASH_TICKS, GameState, MS_WINDUP, OBJ_CHEST, OBJ_GOLDCHEST, OBJ_SHRINE, OBJ_URN, SHRINE_NAMES, PLAYER_RADIUS, PlayerState, REVIVE_TICKS, SimEvent, ZONE_ACID, ZONE_FUSE, isTeamMatch } from '../core/state'
import { FX_CRIT, FX_GUARD, FX_PARTYDR, FX_RATE, FX_SNIPE, FX_WHIRL } from '../core/skills'
import { ACID, LORD, MONSTER_LIST, WARDEN, affixNames, isBossLike } from '../core/monsters'
import { ACTS, AREAS, NPC_NAMES, QUESTS, areaDef, areaLayout, isTown, townNpcs } from '../core/world'
import { townPortalSpot } from '../core/sim'
import { HEAD_AIM_FRAC, PART_HEAD, WEAPONS } from '../core/weapons'
import { BASE_H, BASE_W, Hud, RenderOptions, ScreenText, VIEW_H, VIEW_W, hex, lowAmmo, roundRect } from '../render/hud'
import { renderMapTiles } from '../render/minimap'
import { PITCH, YAW, worldDirToScreen } from './camera'
import { CharacterRig, buildCharacter, setRigOpacity, makeShield } from './character3d'
import { VIEW_RADIUS_TILES, Viewer, Vision, canSee } from './vision'
import { U, World3D, buildWorld } from './world3d'
import { MONSTER_TOP, MonsterView } from './monsters3d'
import { RARITY_COLORS, itemName } from '../core/items'

export { VIEW_W, VIEW_H }
export type { RenderOptions }

export { YAW }
const FOLLOW_DIST = 15.5
/** 기준 세로 시야각. 화면이 넓어지면 resize() 가 이 값을 줄여 보이는 면적을 유지한다 */
const BASE_FOV = 40
const GUN_H = 0.95
/**
 * 미니맵 창 한 변(px)과 타일당 px. 회전돼 있어 대각선으로는 더 멀리 보인다.
 * 처음 170/11(한 변 ≈ 15칸)은 "보여 주는 게 너무 적다"(2026-09-05) → 190/7 로 넓혔다 (한 변 ≈ 27칸, 대각선 ≈ 38칸).
 */
const MINIMAP_SIZE = 190
const MINIMAP_PX_PER_TILE = 7

interface Particle {
  mesh: THREE.Mesh
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
  mesh: THREE.Mesh
  life: number
}

interface Ring {
  mesh: THREE.Mesh
  life: number
  max: number
  r0: number
  r1: number
}

/** 빠른 감정 표현 (키 1·2·3, 폰은 버튼). 글은 여기 한 곳에서 정한다 */
export const EMOTES: Record<number, string> = { 1: 'ㅋㅋㅋ', 2: '굿 👍', 3: '미안 🙏' }

/** 총성 위치 표시 (단군덕 패시브): 안 보이는 상대가 쏘면 그 자리를 잠깐 알려 준다 */
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
  /** 시야 밖이라 숨긴 몬스터 id · 경계에서 깜빡이지 않게 남은 시간 */
  private hiddenM = new Set<number>()
  private seenM = new Map<number, number>()
  /** 몬스터 투사체 (빛나는 구슬) */
  private shotPool: THREE.Sprite[] = []
  /** 던전: 플레이어마다 드는 등불 — 디아블로의 빛 반경. 어둠과 시야 제한이 겹쳐 분위기를 만든다 */
  private lanterns: THREE.PointLight[] = []
  /** 스킬 연출: 땅의 무대(스포트라이트) · 던진 수류탄 · 버프 고리 */
  private zoneMeshes = new Map<number, THREE.Group>()
  private throwMeshes = new Map<number, THREE.Mesh>()
  private auras: THREE.Mesh[] = []
  /** 투기장: 나를 마지막으로 죽인 사람 (복수 알림) */
  private lastKiller = -1
  /** 계단 (층마다) */
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
  private particlePool: THREE.Mesh[] = []
  private texts: WorldText[] = []
  private flashes: Flash[] = []
  private rings: Ring[] = []
  private pings: Ping[] = []
  /** 팀 신호 (같은 편이 찍은 "여기"). 지면 마커 + 화면 밖이면 가장자리 화살표 */
  private marks: { x: number; z: number; life: number; max: number; mesh: THREE.Mesh }[] = []
  /** 빠른 감정 표현 말풍선 (플레이어 번호 → 글·끝나는 시각) */
  private emotes = new Map<number, { text: string; until: number }>()
  private shake = 0
  /** 저격 반동: 카메라가 조준 반대쪽으로 밀렸다가 돌아온다 (월드 단위) */
  private kick = 0
  private kickDir = 0
  /** 저격 조준경 섬광 (0~1). 스코프 안에서는 총구 화염이 안 보여 쐈는지도 몰랐다(제보) */
  private scopeFlash = 0
  private camTarget = new THREE.Vector3()
  private camDist = FOLLOW_DIST
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
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffcf9a, 0, 10, 1.4)
      l.visible = false
      this.lanterns.push(l)
      this.scene.add(l)
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

  /** 화면 위쪽 큰 배너 (지역 이름) */
  banner(title: string, sub: string, color?: string): void {
    this.hud.banner(title, sub, color)
  }

  /** 새 판(새 맵)으로 교체 */
  setMap(map: GameMap): void {
    this.emotes.clear()
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
    this.world = buildWorld(map)
    this.scene.add(this.world.group)
    this.vision = new Vision(map)
    this.scene.add(this.vision.group)
    this.scene.background = new THREE.Color(map.theme.outside)
    this.scene.fog = new THREE.Fog(map.theme.fog, 34, 70)
    this.miniCanvas = null
    this.bagShown.clear()
    for (const g of this.globeMeshes.values()) this.scene.remove(g)
    this.globeMeshes.clear()
    this.camInit = false
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
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
      this.rigs = chars.map((c) => buildCharacter(CHARACTERS[c]))
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
      this.scene.add(rig.root)
      this.rigs[i] = rig
      this.rigChars[i] = chars[i]
      this.vis[i] = newVis()
    }
  }

  // ---------- 이벤트 → 이펙트 ----------
  onEvents(events: SimEvent[], state: GameState, localPlayer: number, names?: string[]): void {
    this.ensureRigs(state)
    const nm = names ?? state.players.map((p) => CHARACTERS[p.char].name)
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
            // 후라이팬: 휘두르는 모션
            v.swing = 1
            break
          }
          // 단군덕 패시브(중계, 투기장): 시야 밖 적의 총성 위치를 1.2초 표시
          if (state.mode === 'arena' && localPlayer >= 0 && state.players[localPlayer].char === 'dangun' && this.hidden[e.p] && state.players[e.p].team !== state.players[localPlayer].team) {
            this.pings.push({ x: e.x * U, z: e.y * U, life: 1.2, max: 1.2 })
          }
          const tip = new THREE.Vector3()
          rig.gunTip.getWorldPosition(tip)
          this.spawnFlash(tip, w.scope ? 2.6 : w.pellets > 1 ? 1.6 : 1)
          v.vsx -= w.scope ? 0.3 : 0.12
          v.vsy += w.scope ? 0.2 : 0.08
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
        case 'pickup': {
          if (e.p !== localPlayer) break
          const it = state.players[e.p].bag.find((b) => b.uid === e.uid)
          if (it) this.hud.notice(`${['', '마법 ', '희귀 ', '전설 '][it.rarity]}${itemName(it)} 획득`, RARITY_COLORS[it.rarity])
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
          this.spawnRing(e.x * U, e.y * U, 0.3, e.r * U, 0.8, 0x7aff9a)
          break
        case 'summon':
          this.spawnRing(e.x * U, e.y * U, 0.3, 2.4, 0.7, 0xd8c8ff)
          break
        case 'questDone':
          this.hud.banner(`퀘스트 이룸 — ${QUESTS[e.q].name}`, '마을의 촌장 카인에게 보고하라', '#ffd86a')
          break
        case 'questReward':
          if (e.p === localPlayer) this.hud.notice(`보상: ${QUESTS[e.q].reward}`, '#ffd86a')
          break
        case 'gold':
          if (e.p === localPlayer) this.texts.push({ x: e.x * U, z: e.y * U, y: 0.9, text: `+${e.n} 골드`, life: 0.9, max: 0.9, color: '#ffd86a', big: false, pop: 0.4 })
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
            this.hud.notice(`웨이포인트 — ${areaDef(e.area).name}`, '#7ab8ff')
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
          this.texts.push({ x: e.x * U, z: e.y * U, y: 1.9, text: `-${e.dmg}`, life: 0.8, max: 0.8, color: '#ff8a7a', big: false, pop: 0.6 })
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
          this.monsterView.hit(e.m, head)
          const hidden = this.hiddenM.has(e.m)
          // 숫자는 **내가 맞힌 것만** 띄운다 — 동료·폭발 숫자까지 띄우면 무리 싸움에서 화면이 숫자로 덮였다(2026-09-18 확인)
          const mine = e.by === localPlayer
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
            const n = head ? 12 : mine ? 5 : 2
            for (let k = 0; k < n; k++) {
              const a = Math.random() * Math.PI * 2
              const sp = (head ? 0.09 : 0.06) + Math.random() * 0.1
              const col = head ? (k % 3 === 0 ? 0xfff3c0 : 0xffd84a) : k % 2 === 0 ? 0x7a1010 : 0x3a0a0a
              this.spawnParticle(e.x * U, 0.8, e.y * U, Math.cos(a) * sp, 0.05 + Math.random() * 0.1, Math.sin(a) * sp, 0.3 + Math.random() * 0.15, col, head ? 0.45 : 0.4)
            }
            this.spawnImpact(e.x * U, 0.8, e.y * U, head ? 0xffd84a : 0xff5a4a, head ? 2.2 : 1.1)
            if (head) this.spawnRing(e.x * U, e.y * U, 0.3, 1.4, 0.35, 0xffd84a)
          }
          if (e.by === localPlayer) this.hud.hitMark(head)
          break
        }
        case 'mdeath': {
          this.monsterView.died(e)
          if (this.hiddenM.has(e.m)) break
          // 검붉은 피 · 뼛조각이 튀고 바닥에 얼룩 링
          const bone = e.kind === 1
          for (let k = 0; k < 10; k++) {
            const a = Math.random() * Math.PI * 2
            const sp = 0.03 + Math.random() * 0.07
            const col = bone ? (k % 2 === 0 ? 0xd9d1bb : 0x8a8270) : k % 3 === 0 ? 0x2a0808 : k % 3 === 1 ? 0x6a1212 : 0x8a9478
            this.spawnParticle(e.x * U, 0.6, e.y * U, Math.cos(a) * sp, 0.08 + Math.random() * 0.1, Math.sin(a) * sp, 0.9, col, bone ? 0.8 : 0.7)
          }
          this.spawnRing(e.x * U, e.y * U, 0.2, 1.1, 0.4, bone ? 0xd9d1bb : 0x7a1414)
          break
        }
        case 'swipe':
          this.monsterView.swiped(e.m)
          break
        case 'boom': {
          // 폭발: 초록빛 섬광 + 고름 파편 + 링 + 흔들림
          const light = new THREE.PointLight(0xb8ff5a, 18, e.r * U * 3, 1.5)
          light.position.set(e.x * U, 1, e.y * U)
          this.scene.add(light)
          this.flashes.push({ light, mesh: new THREE.Mesh(), life: 0.18 })
          for (let k = 0; k < 14; k++) {
            const a = Math.random() * Math.PI * 2
            const sp = 0.05 + Math.random() * 0.1
            const col = k % 3 === 0 ? 0xd8ff6a : k % 3 === 1 ? 0x8a9a4a : 0x4a3a1a
            this.spawnParticle(e.x * U, 0.6, e.y * U, Math.cos(a) * sp, 0.1 + Math.random() * 0.12, Math.sin(a) * sp, 0.55, col, 0.9)
          }
          this.spawnImpact(e.x * U, 0.8, e.y * U, 0xd8ff6a, e.r * U * 2.4)
          this.spawnRing(e.x * U, e.y * U, 0.4, e.r * U, 0.45, 0xb8e05a)
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
          this.texts.push({ x: e.x * U, z: e.y * U, y: 1.7, text: `+${e.amount}`, life: 0.9, max: 0.9, color: '#7ef0a0', big: true })
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
        case 'lordRage': {
          this.spawnRing(e.x * U, e.y * U, 0.5, 6, 1.0, 0xff5a2a)
          this.spawnImpact(e.x * U, 1.4, e.y * U, 0xff6a3a, 6)
          this.shake = Math.max(this.shake, 0.5)
          this.hud.banner('심연의 군주가 분노한다', e.stage >= 2 ? '마지막 힘을 끌어올린다 — 더 빠르고 더 자주' : '그림자가 옥좌에서 흘러나온다', '#ff7a4a')
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
    const mat = new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    const sprite = new THREE.Sprite(mat)
    sprite.position.set(x, y, z)
    sprite.scale.setScalar(size * 0.5)
    this.scene.add(sprite)
    this.impacts.push({ sprite, life: 0.14, max: 0.14, size })
  }

  private spawnFlash(pos: THREE.Vector3, size: number): void {
    const light = new THREE.PointLight(0xffc860, 6 * size, 5, 2)
    light.position.copy(pos)
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12 * size, 6, 4), new THREE.MeshBasicMaterial({ color: 0xfff0b0 }))
    mesh.position.copy(pos)
    this.scene.add(light, mesh)
    this.flashes.push({ light, mesh, life: 0.06 })
  }

  private spawnParticle(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: number, size: number): void {
    let mesh = this.particlePool.pop()
    if (!mesh) mesh = new THREE.Mesh(this.particleGeo, new THREE.MeshBasicMaterial({ color }))
    else (mesh.material as THREE.MeshBasicMaterial).color.setHex(color)
    mesh.position.set(x, y, z)
    mesh.scale.setScalar(size)
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0)
    this.scene.add(mesh)
    this.particles.push({ mesh, vx, vy, vz, life, max: life, gravity: 0.35, spin: (Math.random() - 0.5) * 8 })
  }

  private spawnRing(x: number, z: number, r0: number, r1: number, life: number, color: number): void {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }))
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.02, z)
    this.scene.add(mesh)
    this.rings.push({ mesh, life, max: life, r0, r1 })
  }

  // ---------- 프레임 ----------
  draw(prev: GameState, curr: GameState, alpha: number, dt: number, opts: RenderOptions): void {
    this.ensureRigs(curr)
    const ts = opts.timeScale ?? 1
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
    for (let i = 0; i < n; i++) this.updateRig(i, curr.players[i], pos[i], sdt)
    this.monsterView.update(prev, curr, alpha, sdt, (m) => this.hiddenM.has(m.id))
    this.updateBullets(prev, curr, alpha)
    this.updateShots(prev, curr, alpha)
    this.updateGlobes(curr)
    this.updateDrops(curr, opts.localPlayer)
    this.updateMarkers(curr)
    this.updatePortals(curr)
    this.updateObjects(curr)
    this.updateZones(curr)
    this.updateThrows(curr)
    this.updateAuras(curr, pos)
    this.updateLanterns(curr, pos)
    this.updateCamera(curr, pos, dt, opts)
    this.world.update(this.t, this.camTarget.x, this.camTarget.z)

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
      const w = this.screenToWorld(opts.cursor.x, opts.cursor.y)
      for (const m of curr.monsters) {
        if (m.hp <= 0 || this.hiddenM.has(m.id)) continue
        if (Math.hypot(w.x - m.x, w.y - m.y) <= MONSTER_LIST[m.kind].r * HEAD_AIM_FRAC) {
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
    this.hud.drawMain(curr, { ...opts, cursorOn })
    if (opts.showHud) this.drawMinimap(curr, opts)
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
    const radius = VIEW_RADIUS_TILES * (this.scoped ? 1.8 : 1)
    this.vision.update(viewers, radius)
    if (this.seenT.length !== n) this.seenT = curr.players.map(() => 0)
    // 몬스터: 시야 안(벽에 가리지 않고 반경 안)일 때만 그린다. 경계에서 깜빡이지 않게 0.22초 남긴다
    const rpx = radius * 32
    const live = new Set<number>()
    for (const m of curr.monsters) {
      live.add(m.id)
      let near = false
      for (const v of viewers) {
        if ((m.x - v.x) ** 2 + (m.y - v.y) ** 2 <= (rpx + 40) ** 2) {
          near = true
          break
        }
      }
      const vis = m.mark > 0 || (near && canSee(this.map, viewers, m.x, m.y, rpx))
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
    const r = 210
    // 내 주변에도 구멍을 낸다 — 조준경을 켠 채로도 붙는 적을 볼 수 있게
    const rs = 132
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
    ctx.fillStyle = 'rgba(13,17,23,0.82)'
    roundRect(ctx, x - 6, y - 6, S + 12, S + 12, 10)
    ctx.fill()
    ctx.strokeStyle = 'rgba(227,179,65,0.35)'
    ctx.lineWidth = 1
    ctx.stroke()
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
    }
    // 단군덕 패시브(중계): 시야 밖 총성 위치를 미니맵에도 찍는다(창 안이면). 화면 가장자리 화살표만으로는
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
          ctx.fillStyle = '#ffffff'
          roundRect(ctx, s.x - tw / 2, by - 13, tw, 26, 13)
          ctx.fill()
          ctx.beginPath()
          ctx.moveTo(s.x - 5, by + 12)
          ctx.lineTo(s.x + 5, by + 12)
          ctx.lineTo(s.x, by + 19)
          ctx.closePath()
          ctx.fill()
          ctx.fillStyle = '#1a1f26'
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
    // 후라이팬 휘두르기 · 회전 공격(주방 대참사)이면 몸째 빙글빙글
    rig.arms.rotation.y = v.swing > 0 ? Math.sin(v.swing * Math.PI) * 1.5 : v.reloadSwing
    if (p.fx[FX_WHIRL] > 0) root.rotation.y = this.t * 18
    root.scale.set(v.sx, v.sy, v.sx)
    // 무적(스폰 보호 · 우원덕이 구른 뒤): **황금 보호막**. 전에는 몸을 반투명하게 깜빡였는데
    // 눈에 띄지 않아 우원덕 패시브가 있는지도 몰랐다(2026-09-06 제보). 구르는 동안은 구르기 연출이 이미 말해 준다
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
  private updateMarkers(curr: GameState): void {
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
    for (const e of l.exits) label(e.x, e.y, `→ ${AREAS[e.to].name}`, isTown(e.to) ? '#ffd88a' : '#ffb07a')
    for (const n of townNpcs(curr.curArea)) {
      // 촌장 머리 위: 보고할 것이 있으면 ?, 맡을 것이 있으면 ! (디아블로)
      const q = me.quests ?? []
      const mark = n.id === 'elder' ? (q.some((v) => v === 2) ? '? ' : q.some((v) => v === 0) ? '! ' : '') : ''
      label(n.x, n.y - 44, `${mark}${NPC_NAMES[n.id]} · F`, mark ? '#ffd84a' : '#e8d6a8')
    }
    for (const o of curr.objects ?? []) {
      if (o.used || o.kind === OBJ_URN || Math.hypot(o.x - me.x, o.y - me.y) > 5 * 32) continue
      label(o.x, o.y, o.kind === OBJ_SHRINE ? `${SHRINE_NAMES[o.v]} · F` : o.kind === OBJ_GOLDCHEST ? '금빛 상자 · F' : '상자 · F', o.kind === OBJ_GOLDCHEST ? '#ffd86a' : o.kind === OBJ_SHRINE ? '#d8c8ff' : '#d8cfbf')
    }
    if (l.wp) label(l.wp.x, l.wp.y, '웨이포인트 · F', '#9ac8ff')
    if (isTown(curr.curArea)) {
      for (const q of curr.portals) {
        const at = townPortalSpot(l, q.owner)
        if (at) label(at.x, at.y - 40, `타운 포털 → ${AREAS[q.area].name}`, '#9ac8ff')
      }
    } else {
      for (const q of curr.portals) if (q.area === curr.curArea) label(q.x, q.y - 40, '타운 포털 · F', '#9ac8ff')
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
        if (d.gold > 0) {
          const n = Math.min(6, 2 + Math.floor(d.gold / 15))
          for (let k = 0; k < n; k++) {
            const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.025, 10), new THREE.MeshLambertMaterial({ color: 0xffc84a, emissive: 0x6a4a0a, emissiveIntensity: 0.6 }))
            coin.position.set(((k * 37) % 7) / 25 - 0.12, 0.02 + (k % 3) * 0.028, ((k * 53) % 5) / 20 - 0.1)
            coin.rotation.z = (k % 2) * 0.3
            g.add(coin)
          }
        } else {
          const flask = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshLambertMaterial({ color: 0xc81e28, emissive: 0x5a0a0a, emissiveIntensity: 0.8 }))
          flask.position.y = 0.12
          const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.12, 6), new THREE.MeshLambertMaterial({ color: 0xd8c8a8 }))
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
        const col = new THREE.Color(RARITY_COLORS[d.item.rarity])
        const h = 0.8 + d.item.rarity * 0.7
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.04 + d.item.rarity * 0.02, 0.1 + d.item.rarity * 0.03, h, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
        beam.position.y = h / 2
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.3), new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.35 }))
        box.position.y = 0.08
        box.castShadow = true
        g.add(beam, box)
        this.scene.add(g)
        this.dropMeshes.set(d.id, g)
      }
      g.position.set(d.x * U, 0, d.y * U)
      ;(g.children[1] as THREE.Mesh).rotation.y = this.t * 1.5 + d.id
      ;((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.15 * Math.sin(this.t * 3 + d.id)
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
    const x = e.x * U
    const z = e.y * U
    const ult = e.slot === 2
    const color = SKILL_COLOR[e.id] ?? 0xffffff
    this.spawnRing(x, z, ult ? 2.2 : 1.4, 0.3, ult ? 0.5 : 0.35, color)
    if (ult) {
      this.spawnImpact(x, 1.2, z, color, 4)
      const light = new THREE.PointLight(color, 14, 9, 1.5)
      light.position.set(x, 1.5, z)
      this.scene.add(light)
      this.flashes.push({ light, mesh: new THREE.Mesh(), life: 0.25 })
      if (e.p === localPlayer) this.shake = Math.max(this.shake, 0.25)
      const v = this.vis[e.p]
      if (v) {
        v.vsx -= 0.3
        v.vsy += 0.45
      }
    }
    if (e.id === 'broadcast') this.spawnRing(x, z, 0.5, 18, 0.9, 0xb99cff)
    if (e.id === 'pancharge' || e.id === 'catstep') {
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
    if (e.id === 'grenade' || e.id === 'roar') {
      this.spawnImpact(x, 0.8, z, color, r * 2.2)
      this.shake = Math.max(this.shake, 0.25)
    }
  }

  /** 스포트라이트 무대: 땅에 밝은 원 + 테두리, 끝나 갈수록 흐려진다 */
  private updateZones(curr: GameState): void {
    const live = new Set<number>()
    for (const zn of curr.zones) {
      live.add(zn.id)
      let g = this.zoneMeshes.get(zn.id)
      const fuse = zn.kind === ZONE_FUSE
      const acid = zn.kind === ZONE_ACID
      if (!g) {
        g = new THREE.Group()
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: acid ? 0x6aff2a : fuse ? 0xff3a1a : 0xfff0b0, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }))
        disc.rotation.x = -Math.PI / 2
        const rim = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), new THREE.MeshBasicMaterial({ color: acid ? 0x9aff3a : fuse ? 0xff5a2a : 0xffe07a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }))
        rim.rotation.x = -Math.PI / 2
        g.add(disc, rim)
        const beam = new THREE.PointLight(acid ? 0x8aff4a : fuse ? 0xff4a20 : 0xfff0c0, acid ? 3 : fuse ? 6 : 10, zn.r * U * 2.5, 1.4)
        beam.position.y = 3
        g.add(beam)
        this.scene.add(g)
        this.zoneMeshes.set(zn.id, g)
      }
      g.position.set(zn.x * U, 0.04, zn.y * U)
      g.scale.set(zn.r * U, 1, zn.r * U)
      if (acid) {
        // 산성 웅덩이: 부글거리며, 끝나 갈수록 옅어진다
        const fade = Math.min(1, zn.t / 40)
        ;((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (0.3 + 0.08 * Math.sin(this.t * 9 + zn.id)) * fade
        ;((g.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.7 * fade
        if (Math.random() < 0.15) {
          const a = Math.random() * Math.PI * 2
          const d = Math.random() * zn.r * U * 0.8
          this.spawnParticle(zn.x * U + Math.cos(a) * d, 0.05, zn.y * U + Math.sin(a) * d, 0, 0.03 + Math.random() * 0.03, 0, 0.5, 0x9aff3a, 0.5)
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
      this.zoneMeshes.delete(id)
    }
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
      if (m.st === MS_WINDUP && def.special === 'warden' && m.mode === 2) {
        // 관리인 내려찍기 예고: 둘레 원이 차오른다
        this.groundCircle(ctx, at.x, at.z, WARDEN.slamR * U, '#ff8a4a', 0.35 + 0.5 * (1 - m.t / WARDEN.slamWindup))
      }
      if (m.st === MS_WINDUP && def.attack === 'lob' && m.mode === 0) {
        // 산성·불덩이 예고: 떨어질 자리
        this.groundCircle(ctx, m.ax * U, m.ay * U, (def.blast ?? ACID.r) * U, def.blast ? '#ff8a4a' : '#9aff3a', 0.3 + 0.5 * (1 - m.t / def.windup))
      }
      if (m.st === MS_WINDUP && def.special === 'blink' && m.mode === 2) {
        // 그림자 순간이동 예고: 나타날 자리
        this.groundCircle(ctx, m.ax * U, m.ay * U, 0.6, '#d89aff', 0.4 + 0.5 * (1 - m.t / 22))
      }
      if (m.st === MS_WINDUP && def.special === 'lord' && m.mode === 2) {
        // 불꽃 고리 예고: 사방으로 짧은 선
        const n = m.stage >= 2 ? LORD.novaRage : LORD.nova
        const a0 = (m.aim / 1024) * Math.PI * 2
        const k = 1 - m.t / LORD.novaWindup
        ctx.save()
        ctx.strokeStyle = '#ff7a3a'
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
      if (m.st === MS_WINDUP && def.special === 'queen' && m.mode === 2) {
        // 거미줄 부채 예고: 일곱 갈래
        const a0 = Math.atan2(m.ay - m.y, m.ax - m.x)
        ctx.save()
        ctx.strokeStyle = '#e8f0d8'
        ctx.globalAlpha = 0.5
        ctx.setLineDash([6, 6])
        const from = this.worldToScreen(at.x, 0.9, at.z)
        for (let k = 0; k < 7; k++) {
          const a = a0 + ((k - 3) / 3) * ((36 * Math.PI) / 180)
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
      // 정예는 늘, 나머지는 맞은 뒤 3초만 (보스는 화면 위 큰 막대가 따로 있다)
      const goblin = def.attack === 'flee'
      if (isBossLike(m) || (!m.elite && !goblin && curr.tick - m.hitTick > 180)) continue
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
      const mat = w.scope ? this.streakMats.sniper : w.pellets > 1 ? this.streakMats.shotgun : this.streakMats.default
      for (const child of streak.children) (child as THREE.Mesh).material = mat
      const len = speed * U * (w.scope ? 3.4 : w.pellets > 1 ? 1.3 : 2.1)
      const wid = w.scope ? 0.14 : 0.1
      // 머리(밝은 끝)가 탄 위치, 꼬리는 뒤로
      streak.position.set(x - dx * len * 0.5, GUN_H, z - dz * len * 0.5)
      streak.rotation.y = -Math.atan2(dz, dx)
      streak.scale.set(len, wid, wid)
      n++
    }
    for (let i = n; i < this.bulletPool.length; i++) this.bulletPool[i].visible = false
  }

  private updateEffects(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i]
      q.life -= dt
      if (q.life <= 0) {
        this.scene.remove(q.mesh)
        this.particlePool.push(q.mesh)
        this.particles[i] = this.particles[this.particles.length - 1]
        this.particles.pop()
        continue
      }
      const k = dt * 60
      q.mesh.position.x += q.vx * k
      q.mesh.position.y += q.vy * k
      q.mesh.position.z += q.vz * k
      q.vy -= q.gravity * dt
      if (q.mesh.position.y < 0.05) {
        q.mesh.position.y = 0.05
        q.vy = -q.vy * 0.3
        q.vx *= 0.7
        q.vz *= 0.7
      }
      q.mesh.rotation.x += q.spin * dt
      q.mesh.rotation.z += q.spin * dt
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      this.texts[i].life -= dt
      if (this.texts[i].life <= 0) this.texts.splice(i, 1)
    }
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const im = this.impacts[i]
      im.life -= dt
      if (im.life <= 0) {
        this.scene.remove(im.sprite)
        ;(im.sprite.material as THREE.SpriteMaterial).dispose()
        this.impacts.splice(i, 1)
        continue
      }
      const k = 1 - im.life / im.max
      im.sprite.scale.setScalar(im.size * (0.5 + k * 1.1))
      ;(im.sprite.material as THREE.SpriteMaterial).opacity = 1 - k
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]
      f.life -= dt
      if (f.life <= 0) {
        this.scene.remove(f.light, f.mesh)
        f.light.dispose()
        this.flashes.splice(i, 1)
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.life -= dt
      if (r.life <= 0) {
        this.scene.remove(r.mesh)
        this.rings.splice(i, 1)
        continue
      }
      const k = 1 - r.life / r.max
      const rad = r.r0 + (r.r1 - r.r0) * k
      r.mesh.scale.setScalar(rad)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9
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
      if (me.alive && me.ads) {
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
      const s = 1 - Math.pow(this.scoped ? 0.06 : 0.002, dt)
      this.camTarget.x += (tx - this.camTarget.x) * s
      this.camTarget.z += (tz - this.camTarget.z) * s
      this.camDist += (dist - this.camDist) * s * 0.7
    }
    const shx = (Math.random() - 0.5) * this.shake
    const shz = (Math.random() - 0.5) * this.shake
    const cx = this.camTarget.x + shx
    const cz = this.camTarget.z + shz
    const flat = Math.cos(PITCH) * this.camDist
    this.camera.position.set(cx + Math.sin(YAW) * flat, Math.sin(PITCH) * this.camDist, cz + Math.cos(YAW) * flat)
    this.camera.lookAt(cx, 0.6, cz)
    // 그림자 카메라가 시점을 따라오도록
    this.world.sun.position.set(this.camTarget.x + 8, 18, this.camTarget.z + 10)
    this.world.sun.target.position.set(this.camTarget.x, 0, this.camTarget.z)
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
    this.gl.dispose()
    this.canvas.remove()
    this.hud.canvas.remove()
  }
}

function newVis(): DuckVis {
  return { sx: 1, sy: 1, vsx: 0, vsy: 0, walk: 0, flash: 0, flashColor: 0xffffff, deadT: -1, fall: 0, hitCd: 0, swing: 0, reloadSwing: 0 }
}

export { hex, PLAYER_RADIUS }

/** 스킬 색 (고리·입자). skillIcons 의 색과 맞춘다 */
const SKILL_COLOR: Record<string, number> = {
  ironwall: 0xe0a060, barrage: 0xffb04a, roar: 0xff7a40,
  pierce: 0x7fd6d0, grenade: 0xffa040, composure: 0xffd86a,
  broadcast: 0xb99cff, fanfire: 0xb99cff, spotlight: 0xfff0b0,
  firstaid: 0x7ee0a0, flame: 0xff8a3a, surgery: 0xb0ffcc,
  pancharge: 0xffb070, oil: 0xe8d060, kitchen: 0xff5a3a,
  catstep: 0x9cc8ff, railshot: 0x9cc8ff, ninelives: 0xffd86a,
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
