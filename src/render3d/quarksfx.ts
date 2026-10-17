// three.quarks 이펙트 손맛 (2026-10-17 그래픽 개편 E — docs/철면수심-그래픽-개편-계획.md 7장 · 사용자 결정: ☀ 🌙 둘 다, 색만 분위기에 맞춘다).
// 기존 효과(spawnImpact · 고리 · 빛 알갱이 · 파편 · skillfx)는 그대로 두고, 그 자리에서 quarks 프리셋을 덧붙인다 — 끄고 켜기 · 되돌리기가 쉽게.
// 프리셋마다 ParticleSystem 하나를 계속 켜 두고(방출량 0), 터질 자리에 입자만 뿌린다(burst).
// BatchedRenderer 가 같은 재질 · 그리기 방식끼리 묶어 그리기 호출은 묶음 수(4)뿐 · 입자는 화면 전체 2,500 개 상한.
// 판정과 무관(화면만) · 시계는 렌더러가 받는 프레임 dt (소개 영상의 가상 시계와 맞는다).

import * as THREE from 'three'
import {
  ApplyForce,
  BatchedRenderer,
  Bezier,
  ColorOverLife,
  ConeEmitter,
  ConstantColor,
  ConstantValue,
  Gradient,
  IntervalValue,
  ParticleSystem,
  PiecewiseBezier,

  RandomColor,
  RenderMode,
  RotationOverLife,
  SizeOverLife,
  SphereEmitter,
  Vector3 as QV3,
  Vector4,
} from 'three.quarks'
import type { EmitterShape, FunctionValueGenerator, ValueGenerator } from 'three.quarks'

/** 아틀라스 칸 (4 × 2 · 128px) */
const TILE = { glow: 0, star: 1, confetti: 2, sparkle: 3, heart: 4, smoke: 5, drop: 6, note: 7 } as const

/** 흰 모양을 그린 아틀라스 한 장 (색은 입자 색이 입힌다) */
function atlas(): THREE.CanvasTexture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = S * 4
  c.height = S * 2
  const g = c.getContext('2d')!
  const cell = (i: number, f: (cx: number, cy: number) => void) => {
    g.save()
    g.translate((i % 4) * S, Math.floor(i / 4) * S)
    f(S / 2, S / 2)
    g.restore()
  }
  const radial = (cx: number, cy: number, r: number, stops: [number, number][]) => {
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r)
    for (const [o, a] of stops) grd.addColorStop(o, `rgba(255,255,255,${a})`)
    g.fillStyle = grd
    g.fillRect(cx - r, cy - r, r * 2, r * 2)
  }
  g.fillStyle = '#fff'
  cell(TILE.glow, (cx, cy) => radial(cx, cy, 62, [[0, 1], [0.25, 0.8], [1, 0]]))
  cell(TILE.star, (cx, cy) => {
    g.beginPath()
    for (let k = 0; k <= 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5
      const r = k % 2 === 0 ? 56 : 24
      if (k === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      else g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    }
    g.fill()
  })
  cell(TILE.confetti, (cx, cy) => {
    g.beginPath()
    g.roundRect(cx - 40, cy - 22, 80, 44, 10)
    g.fill()
  })
  cell(TILE.sparkle, (cx, cy) => {
    radial(cx, cy, 30, [[0, 1], [1, 0]])
    g.fillStyle = '#fff'
    g.beginPath()
    g.moveTo(cx, cy - 60)
    g.quadraticCurveTo(cx, cy, cx + 60, cy)
    g.quadraticCurveTo(cx, cy, cx, cy + 60)
    g.quadraticCurveTo(cx, cy, cx - 60, cy)
    g.quadraticCurveTo(cx, cy, cx, cy - 60)
    g.fill()
  })
  cell(TILE.heart, (cx, cy) => {
    g.beginPath()
    g.moveTo(cx, cy + 46)
    g.bezierCurveTo(cx - 70, cy - 4, cx - 34, cy - 62, cx, cy - 20)
    g.bezierCurveTo(cx + 34, cy - 62, cx + 70, cy - 4, cx, cy + 46)
    g.fill()
  })
  cell(TILE.smoke, (cx, cy) => {
    for (const [dx, dy, r] of [[0, 0, 44], [-22, 10, 30], [24, 8, 32], [6, -18, 30]]) radial(cx + dx, cy + dy, r, [[0, 0.55], [0.6, 0.3], [1, 0]])
  })
  cell(TILE.drop, (cx, cy) => {
    g.beginPath()
    g.ellipse(cx, cy, 40, 30, 0, 0, Math.PI * 2)
    g.fill()
    g.beginPath()
    g.ellipse(cx + 34, cy + 22, 12, 10, 0, 0, Math.PI * 2)
    g.fill()
  })
  cell(TILE.note, (cx, cy) => {
    g.beginPath()
    g.ellipse(cx - 14, cy + 30, 22, 16, -0.4, 0, Math.PI * 2)
    g.fill()
    g.fillRect(cx + 4, cy - 50, 8, 82)
    g.fillRect(cx + 4, cy - 50, 34, 10)
  })
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const lin = (hex: number, a = 1) => {
  const c = new THREE.Color(hex)
  return new Vector4(c.r, c.g, c.b, a)
}
/** 0 → 1 곡선 (크기 · 속도 배율) */
const curve = (a: number, b: number, c: number, d: number) => new PiecewiseBezier([[new Bezier(a, b, c, d), 0]])
/** 끝으로 갈수록 옅어진다 (색은 그대로) */
const fadeOut = (hold = 0.6) => new ColorOverLife(new Gradient([[new QV3(1, 1, 1), 0], [new QV3(1, 1, 1), 1]], [[1, 0], [1, hold], [0, 1]]))

export type QuarksName = 'hit' | 'hitBig' | 'pop' | 'popBig' | 'chunks' | 'smoke' | 'muzzle' | 'trail' | 'coin' | 'notes' | 'blast' | 'cast' | 'ember'

interface PresetDef {
  tile: number
  blend: 'add' | 'norm'
  mode: RenderMode
  shape: EmitterShape
  life: [number, number]
  speed: [number, number]
  size: [number, number]
  /** 색 둘 사이에서 무작위 (분위기마다 다른 묶음) */
  colors: [number, number]
  /** 있으면 색 하나씩 나눠 뿌린다 (색종이처럼 섞이지 않은 장난감 색 — 둘 사이 무작위는 보라 · 회색으로 섞였다) */
  palette?: number[]
  gravity?: number
  spin?: number
  sizeCurve?: FunctionValueGenerator
  fade?: number
  /** 원뿔 · 반구를 위로(+y) 세운다 (아니면 조준 방향으로 눕힌다) */
  up?: boolean
  stretch?: number
}

/** ☀ 장난감 색 (진하게 — 파스텔 바닥 위에서 보이게) */
const TOY = [0xff5f9e, 0x3fc8ff, 0xffc21f, 0x46d6a0, 0xa77bff, 0xff8a3d]

/**
 * 분위기별 프리셋 — ☀ 색종이 · 별 · 사탕빛 / 🌙 핏방울 · 불티 · 어두운 연기 (모양 · 움직임은 같다).
 * ☀ 은 밝은 바닥 위라 더하기 혼합(빛)이 하얗게 묻힌다 → 반짝임 · 불티도 일반 혼합 + 진한 색. 🌙 은 어두워 더하기 혼합이 빛난다.
 * 크기는 타일 단위 (카메라에서 한 칸 ≈ 40 ~ 60px)
 */
function presets(bright: boolean): Record<QuarksName, PresetDef> {
  const sphere = (r: number) => new SphereEmitter({ radius: r, thickness: 1 })
  const cone = (angle: number) => new ConeEmitter({ radius: 0.05, angle, thickness: 1 })
  const glowBlend = bright ? 'norm' : 'add'
  return {
    // 명중: 맞은 자리에서 작은 조각이 튄다
    hit: { tile: bright ? TILE.confetti : TILE.drop, blend: 'norm', mode: RenderMode.BillBoard, shape: sphere(0.15), life: [0.35, 0.6], speed: [2, 3.6], size: [0.22, 0.34], colors: bright ? [0xff5f9e, 0x3fc8ff] : [0x7a0e0e, 0xb01818], palette: bright ? TOY : undefined, gravity: 9, spin: 8, fade: 0.5 },
    // 치명타 · 내 명중: 반짝 별
    hitBig: { tile: TILE.sparkle, blend: glowBlend, mode: RenderMode.BillBoard, shape: sphere(0.2), life: [0.25, 0.45], speed: [0.8, 1.8], size: [0.55, 0.85], colors: bright ? [0xffc21f, 0xffe066] : [0xffd27a, 0xffa040], sizeCurve: curve(0.4, 1.2, 1, 0), spin: 3 },
    // 처치 "퐁!": 별(☀) / 핏덩이(🌙) 가 위로 터져 떨어진다
    pop: { tile: bright ? TILE.star : TILE.drop, blend: 'norm', mode: RenderMode.BillBoard, shape: new ConeEmitter({ radius: 0.2, angle: 0.9, thickness: 1 }), up: true, life: [0.65, 1.0], speed: [3.4, 5.8], size: [0.45, 0.7], colors: bright ? [0xffc21f, 0xff5f9e] : [0x5a0a0a, 0x8a1414], palette: bright ? [0xffc21f, 0xff5f9e, 0x3fc8ff] : undefined, gravity: 14, spin: 7, fade: 0.65 },
    // 정예 · 보스 처치: 더 크게 · 반짝임
    popBig: { tile: TILE.sparkle, blend: glowBlend, mode: RenderMode.BillBoard, shape: sphere(0.4), life: [0.5, 0.9], speed: [2.4, 5], size: [0.7, 1.1], colors: bright ? [0xffc21f, 0xff8ac0] : [0xffc070, 0xff7030], sizeCurve: curve(0.3, 1.1, 0.9, 0), spin: 4 },
    // 처치 색종이(☀) · 핏방울(🌙) 비
    chunks: { tile: bright ? TILE.confetti : TILE.drop, blend: 'norm', mode: RenderMode.BillBoard, shape: new ConeEmitter({ radius: 0.25, angle: 1.1, thickness: 1 }), up: true, life: [0.9, 1.4], speed: [2.6, 4.8], size: [0.22, 0.34], colors: bright ? [0x46d6a0, 0xa77bff] : [0x3a0606, 0x6a1010], palette: bright ? TOY : undefined, gravity: 8, spin: 10, fade: 0.7 },
    // 연기: ☀ 하얀 솜 / 🌙 어두운 연기
    smoke: { tile: TILE.smoke, blend: 'norm', mode: RenderMode.BillBoard, shape: sphere(0.3), life: [0.6, 1.0], speed: [0.3, 0.9], size: [1.3, 1.9], colors: bright ? [0xffffff, 0xfff4fa] : [0x2a2224, 0x3a3034], sizeCurve: curve(0.5, 0.9, 1.1, 1.3), spin: 1.2, fade: 0.25 },
    // 총구 불티: 조준 방향으로 늘어나며 튄다
    muzzle: { tile: TILE.glow, blend: glowBlend, mode: RenderMode.StretchedBillBoard, shape: cone(0.35), life: [0.08, 0.16], speed: [8, 14], size: [0.13, 0.2], colors: bright ? [0xffb21f, 0xff6f9e] : [0xffd080, 0xff8030], stretch: 0.07 },
    // 괴물 탄 궤적: 탄이 지나간 자리에 빛점이 남아 작아지며 사라진다 (렌더러가 탄마다 프레임마다 하나 — 색 = 탄 색)
    trail: { tile: TILE.glow, blend: glowBlend, mode: RenderMode.BillBoard, shape: sphere(0.02), life: [0.18, 0.26], speed: [0, 0.15], size: [0.34, 0.42], colors: bright ? [0xff5f9e, 0xff5f9e] : [0xff7a3a, 0xff7a3a], sizeCurve: curve(1, 0.75, 0.45, 0), fade: 0.6 },
    // 금화 · 줍기 반짝
    coin: { tile: TILE.sparkle, blend: glowBlend, mode: RenderMode.BillBoard, shape: new ConeEmitter({ radius: 0.2, angle: 0.5, thickness: 1 }), up: true, life: [0.45, 0.75], speed: [1.4, 2.6], size: [0.4, 0.55], colors: bright ? [0xffc21f, 0xffd84a] : [0xffe680, 0xfff8d0], sizeCurve: curve(0.5, 1.2, 0.8, 0), gravity: 2 },
    // 스킬 범위 터짐: 사방으로 늘어나며 튀는 불티 (색 = 스킬 색 · 퍼짐 = 범위만큼 — burst 의 speed)
    blast: { tile: TILE.glow, blend: glowBlend, mode: RenderMode.StretchedBillBoard, shape: sphere(0.3), life: [0.3, 0.5], speed: [3, 6], size: [0.2, 0.3], colors: bright ? [0xffc21f, 0xff5f9e] : [0xffb060, 0xff5020], gravity: 3, stretch: 0.07 },
    // 스킬 시전: 시전자 둘레에서 솟는 반짝임
    cast: { tile: TILE.sparkle, blend: glowBlend, mode: RenderMode.BillBoard, shape: new ConeEmitter({ radius: 0.7, angle: 0.15, thickness: 0.2 }), up: true, life: [0.5, 0.8], speed: [1.6, 3], size: [0.32, 0.48], colors: bright ? [0xffc21f, 0xffffff] : [0xffe0a0, 0xffffff], sizeCurve: curve(0.4, 1.1, 0.9, 0) },
    // 보스 즉사기 · 패턴 예고: 범위 안에서 솟는 불티 (빨강 = 적의 범위 — GUIDE 11장 범위의 색)
    ember: { tile: TILE.glow, blend: glowBlend, mode: RenderMode.BillBoard, shape: new ConeEmitter({ radius: 0.05, angle: 0.25, thickness: 1 }), up: true, life: [0.7, 1.1], speed: [0.8, 1.8], size: [0.2, 0.3], colors: bright ? [0xd8102e, 0xff4a3a] : [0xff5a1a, 0xffa040], sizeCurve: curve(0.6, 1, 0.8, 0), fade: 0.4 },
    // 격정 연주(바이올린) 음표
    notes: { tile: TILE.note, blend: 'norm', mode: RenderMode.BillBoard, shape: new ConeEmitter({ radius: 0.3, angle: 0.6, thickness: 1 }), up: true, life: [0.6, 0.9], speed: [1.2, 2], size: [0.4, 0.55], colors: [0xff5f9e, 0xffb21f], spin: 1.5, fade: 0.5 },
  }
}

/** 화면 전체 입자 상한 (모든 프리셋 합) — 넘치면 새 터짐을 줄인다 */
const BUDGET = 2500

export class QuarksFx {
  /** 장면에 넣는다 (묶음 그리기 + 프리셋 방출기) */
  readonly group = new THREE.Group()
  private readonly batch = new BatchedRenderer()
  private readonly systems = new Map<QuarksName, ParticleSystem>()
  private readonly defs: Record<QuarksName, PresetDef>
  private readonly tex: THREE.CanvasTexture
  private readonly mats: THREE.Material[]
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly one = new THREE.Vector3(1, 1, 1)
  private readonly at = new THREE.Vector3()
  /** 자동 화질이 낮으면 터짐마다 입자 수를 줄인다 (0 ~ 1) */
  quality = 1

  constructor(bright: boolean) {
    this.tex = atlas()
    const mat = (blending: THREE.Blending) => new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, blending, depthWrite: false })
    const add = mat(THREE.AdditiveBlending)
    const norm = mat(THREE.NormalBlending)
    this.mats = [add, norm]
    this.defs = presets(bright)
    this.group.add(this.batch)
    for (const [name, d] of Object.entries(this.defs) as [QuarksName, PresetDef][]) {
      const behaviors = []
      if (d.gravity) behaviors.push(new ApplyForce(new QV3(0, -1, 0), new ConstantValue(d.gravity)))
      if (d.spin) behaviors.push(new RotationOverLife(new IntervalValue(-d.spin, d.spin)))
      behaviors.push(new SizeOverLife(d.sizeCurve ?? curve(1, 1, 0.85, 0.3)))
      behaviors.push(fadeOut(d.fade ?? 0.4))
      const sys = new ParticleSystem({
        looping: true,
        duration: 1,
        worldSpace: true,
        shape: d.shape,
        startLife: new IntervalValue(d.life[0], d.life[1]),
        startSpeed: new IntervalValue(d.speed[0], d.speed[1]),
        startSize: new IntervalValue(d.size[0], d.size[1]),
        startRotation: new IntervalValue(0, Math.PI * 2),
        startColor: new RandomColor(lin(d.colors[0]), lin(d.colors[1])),
        emissionOverTime: new ConstantValue(0),
        material: d.blend === 'add' ? add : norm,
        renderMode: d.mode,
        rendererEmitterSettings: d.mode === RenderMode.StretchedBillBoard ? { speedFactor: d.stretch ?? 0.05, lengthFactor: 1 } : undefined,
        uTileCount: 4,
        vTileCount: 2,
        startTileIndex: new ConstantValue(d.tile),
        behaviors,
      })
      this.batch.addSystem(sys)
      this.group.add(sys.emitter)
      this.systems.set(name, sys)
    }
  }

  /** 지금 살아 있는 입자 수 (모든 프리셋) */
  get live(): number {
    let n = 0
    for (const s of this.systems.values()) n += s.particleNum
    return n
  }

  /**
   * (x, y, z) 에서 한 번 터뜨린다. dir = 조준 각(라디안, 바닥에서 x 축 기준 — 원뿔 프리셋이 그쪽으로) ·
   * color = 이번만 색 하나로 (등급 · 무기 색) · count = 입자 수
   */
  burst(name: QuarksName, x: number, y: number, z: number, count: number, opts: { dir?: number; color?: number; speed?: number } = {}): void {
    const sys = this.systems.get(name)
    if (!sys) return
    const room = BUDGET - this.live
    const n = Math.min(room, Math.max(1, Math.round(count * this.quality)))
    if (n <= 0) return
    const d = this.defs[name]
    // 원뿔은 +z 로 뿜는다 → 위로 세우거나(-90° x) 조준 방향으로 눕힌다(y 축 회전)
    if (d.up) this.e.set(-Math.PI / 2, 0, 0)
    else this.e.set(0, Math.PI / 2 - (opts.dir ?? 0), 0)
    this.q.setFromEuler(this.e)
    this.m.compose(this.at.set(x, y, z), this.q, this.one)
    const prev = sys.startColor
    const prevSpeed = sys.startSpeed
    if (opts.speed !== undefined && opts.speed !== 1) sys.startSpeed = this.speedOf(d, opts.speed)
    // shortcut: quarks 0.17.1 의 내부 spawn 을 직접 부른다(공개 API 는 방출기 하나 = 한 자리) — 판을 올리면 이 두 줄부터 확인
    const s = sys as unknown as { normalMatrix: { getNormalMatrix(m: THREE.Matrix4): void }; spawn(n: number, st: unknown, m: THREE.Matrix4): void }
    s.normalMatrix.getNormalMatrix(this.m)
    const pal = opts.color !== undefined ? [opts.color] : d.palette
    if (pal) {
      // 색마다 나눠 뿌린다 (나머지는 앞 색부터)
      for (let i = 0; i < pal.length; i++) {
        const k = Math.floor(n / pal.length) + (i < n % pal.length ? 1 : 0)
        if (k <= 0) continue
        sys.startColor = this.colorOf(pal[i])
        s.spawn(k, sys.emissionState, this.m)
      }
    } else s.spawn(n, sys.emissionState, this.m)
    sys.startColor = prev
    sys.startSpeed = prevSpeed
  }

  private readonly speeds = new Map<string, IntervalValue>()
  /** 퍼짐 배율 k 의 속도 (0.1 단위로 모아 다시 쓴다) */
  private speedOf(d: PresetDef, k: number): IntervalValue {
    const kk = Math.round(k * 10) / 10
    const key = `${d.speed[0]}:${d.speed[1]}:${kk}`
    let v = this.speeds.get(key)
    if (!v) this.speeds.set(key, (v = new IntervalValue(d.speed[0] * kk, d.speed[1] * kk)))
    return v
  }

  private readonly colors = new Map<number, ConstantColor>()
  /** 색 하나짜리 생성기 (색마다 하나를 모아 두고 다시 쓴다) */
  private colorOf(hex: number): ConstantColor {
    let c = this.colors.get(hex)
    if (!c) this.colors.set(hex, (c = new ConstantColor(lin(hex))))
    return c
  }

  /** 매 프레임 (렌더러가 받는 dt — 초) */
  update(dt: number): void {
    this.batch.update(Math.min(dt, 0.1))
  }

  /** 시작 준비: 묶음 셰이더를 미리 컴파일하도록 프리셋마다 하나씩 띄워 둔다(곧 사라진다) */
  primeForCompile(): void {
    for (const name of this.systems.keys()) this.burst(name, 0, -50, 0, 1)
  }

  dispose(): void {
    for (const s of this.systems.values()) s.dispose()
    this.systems.clear()
    for (const m of this.mats) m.dispose()
    this.tex.dispose()
  }
}

export type { ValueGenerator }
