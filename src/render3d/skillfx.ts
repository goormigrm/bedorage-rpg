// 스킬마다 고유 연출 (2026-10-08 퀄리티 2차 2.5단계 — 사용자: "스킬은 단순하게 원으로 범위를 표시하던데, 범위는 표시 안 해도 되지만
// 이펙트를 넣는 게 더 좋겠다"). 전에는 거의 모든 스킬이 "시전 고리 + 범위만큼의 원 + 색 입힌 알갱이"였다.
// 도구: 충격파(부드러운 띠 고리) · 빛기둥 · 부채꼴 · 광선 · 기호(♪ ✚ ★ …) — 모두 더하기 빛이라 빛 번짐(post.ts)과 어울린다.
// 메시는 종류마다 모아 두고 다시 쓴다(풀). 알갱이 · 연기 · 섬광 · 빛 · 흔들림은 렌더러의 것을 빌려 쓴다(FxHost).

import * as THREE from 'three'

export interface FxHost {
  glow(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: number, size: number): void
  puff(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: number, size: number, alpha?: number): void
  impact(x: number, y: number, z: number, color: number, size: number): void
  light(x: number, y: number, z: number, color: number, intensity: number, dist: number, life: number): void
  shake(k: number): void
}

/** 시전 · 터짐 한 번의 자리 (월드 단위) — aim = 조준 방향(라디안, 월드 x · z) */
export interface FxAt {
  x: number
  z: number
  aim: number
  tx: number
  tz: number
  /** 범위 (월드 단위 · aoe 만) */
  r: number
  ult: boolean
}

type Kind = 'wave' | 'pillar' | 'fan' | 'beam' | 'glyph'

interface Live {
  kind: Kind
  obj: THREE.Object3D
  mat: THREE.MeshBasicMaterial | THREE.SpriteMaterial
  life: number
  max: number
  /** 크기 처음 · 끝 (종류마다 뜻이 다르다) */
  s0: number
  s1: number
  peak: number
  vy: number
}

const canvas = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** 픽셀마다 알파를 정하는 흰 그림 */
const alphaTex = (w: number, h: number, a: (u: number, v: number) => number) =>
  canvas(w, h, (g) => {
    const img = g.createImageData(w, h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
        img.data[i + 3] = Math.round(Math.max(0, Math.min(1, a((x + 0.5) / w, (y + 0.5) / h))) * 255)
      }
    g.putImageData(img, 0, 0)
  })

const ss = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export class SkillFx {
  private readonly live: Live[] = []
  private readonly pools = new Map<string, THREE.Object3D[]>()
  private readonly tex: Record<'ring' | 'fan' | 'beam' | 'pillar', THREE.Texture>
  private readonly glyphTex = new Map<string, THREE.Texture>()
  private readonly geo: { wave: THREE.BufferGeometry; pillar: THREE.BufferGeometry; beamFlat: THREE.BufferGeometry; beamUp: THREE.BufferGeometry; fans: Map<number, THREE.BufferGeometry> }

  constructor(
    private readonly scene: THREE.Scene,
    private readonly host: FxHost,
  ) {
    this.tex = {
      // 충격파: 가장자리 쪽 밝은 띠 + 안쪽 옅은 채움
      ring: alphaTex(128, 128, (u, v) => {
        const r = Math.hypot(u - 0.5, v - 0.5) * 2
        return ss(0.55, 0.9, r) * (1 - ss(0.9, 1, r)) + 0.06 * (1 - r)
      }),
      // 부채꼴: 가운데(시전자)에서 밝고 끝으로 사그라든다
      fan: alphaTex(128, 128, (u, v) => {
        const r = Math.hypot(u - 0.5, v - 0.5) * 2
        return Math.pow(Math.max(0, 1 - r), 0.7) * (0.35 + 0.65 * ss(0.0, 0.25, r))
      }),
      // 광선: 가운데 줄이 밝다
      beam: alphaTex(8, 64, (_u, v) => Math.pow(Math.max(0, 1 - Math.abs(v - 0.5) * 2), 2.2)),
      // 빛기둥: 바닥이 밝고 위로 사라진다
      pillar: alphaTex(8, 64, (_u, v) => Math.pow(v, 1.4) * ss(0, 0.08, 1 - v)),
    }
    for (const t of Object.values(this.tex)) {
      t.wrapS = THREE.ClampToEdgeWrapping
      t.colorSpace = THREE.NoColorSpace
    }
    this.geo = {
      wave: new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      pillar: new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0),
      beamFlat: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0),
      beamUp: new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0),
      fans: new Map(),
    }
  }

  private glyph(ch: string): THREE.Texture {
    let t = this.glyphTex.get(ch)
    if (!t) {
      t = canvas(64, 64, (g) => {
        g.fillStyle = '#fff'
        g.shadowColor = 'rgba(255,255,255,0.8)'
        g.shadowBlur = 6
        if (ch === '✚') {
          // 십자는 직접 그린다 (글꼴마다 있고 없고가 달라 네모가 나올 수 있다)
          g.beginPath()
          g.roundRect(24, 8, 16, 48, 4)
          g.roundRect(8, 24, 48, 16, 4)
          g.fill()
          return
        }
        g.font = '900 48px "Malgun Gothic", "Segoe UI Symbol", "Apple Symbols", sans-serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.shadowColor = 'rgba(255,255,255,0.8)'
        g.shadowBlur = 6
        g.fillText(ch, 32, 34)
      })
      this.glyphTex.set(ch, t)
    }
    return t
  }

  private mat(map: THREE.Texture, color: number, k: number): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    m.color.setHex(color).multiplyScalar(k)
    return m
  }

  private take(key: string, make: () => THREE.Object3D): THREE.Object3D {
    const pool = this.pools.get(key)
    const o = pool?.pop() ?? make()
    o.userData.pool = key
    this.scene.add(o)
    return o
  }

  private push(kind: Kind, obj: THREE.Object3D, mat: Live['mat'], life: number, s0: number, s1: number, peak: number, vy = 0): void {
    // 너무 많으면 가장 오래된 것을 끝낸다
    if (this.live.length > 160) this.end(0)
    this.live.push({ kind, obj, mat, life, max: life, s0, s1, peak, vy })
  }

  // ---------------------------------------------------------------- 도구

  /** 땅 위 충격파: r0 → r1 로 퍼지며 사라진다 */
  wave(x: number, z: number, color: number, r1: number, life = 0.5, r0 = 0.2, bright = 1.6): void {
    const m = this.take('wave', () => new THREE.Mesh(this.geo.wave, this.mat(this.tex.ring, 0xffffff, 1))) as THREE.Mesh
    const mat = m.material as THREE.MeshBasicMaterial
    mat.color.setHex(color).multiplyScalar(bright)
    m.position.set(x, 0.06, z)
    m.scale.setScalar(r0)
    this.push('wave', m, mat, life, r0, r1, 1)
  }

  /** 빛기둥: 바닥에서 솟아 h 높이로 자라며 사라진다 */
  pillar(x: number, z: number, color: number, r = 0.8, h = 3.2, life = 0.9, bright = 1.8): void {
    const m = this.take('pillar', () => new THREE.Mesh(this.geo.pillar, this.mat(this.tex.pillar, 0xffffff, 1))) as THREE.Mesh
    const mat = m.material as THREE.MeshBasicMaterial
    mat.color.setHex(color).multiplyScalar(bright)
    m.position.set(x, 0.02, z)
    m.scale.set(r, 0.2, r)
    this.push('pillar', m, mat, life, r, h, 1)
  }

  /** 땅 위 부채꼴 (반각 half) — 시전자에서 range 까지 뻗었다 사라진다 */
  fan(x: number, z: number, aim: number, half: number, range: number, color: number, life = 0.35, bright = 1.7): void {
    const key = Math.round(half * 100)
    let g = this.geo.fans.get(key)
    if (!g) {
      g = new THREE.CircleGeometry(1, 24, -half, half * 2).rotateX(-Math.PI / 2)
      this.geo.fans.set(key, g)
    }
    const m = this.take(`fan${key}`, () => new THREE.Mesh(g, this.mat(this.tex.fan, 0xffffff, 1))) as THREE.Mesh
    const mat = m.material as THREE.MeshBasicMaterial
    mat.color.setHex(color).multiplyScalar(bright)
    m.position.set(x, 0.07, z)
    m.rotation.y = -aim
    m.scale.setScalar(range * 0.3)
    this.push('fan', m, mat, life, range * 0.3, range, 1)
  }

  /** 광선: 조준 방향으로 len 만큼 (땅 + 세운 판 두 장) */
  beam(x: number, z: number, aim: number, len: number, color: number, width = 0.6, life = 0.45, y = 0.9, bright = 2.2): void {
    const grp = this.take('beam', () => {
      const gg = new THREE.Group()
      const mm = this.mat(this.tex.beam, 0xffffff, 1)
      gg.add(new THREE.Mesh(this.geo.beamFlat, mm), new THREE.Mesh(this.geo.beamUp, mm))
      gg.userData.mat = mm
      return gg
    })
    const mat = grp.userData.mat as THREE.MeshBasicMaterial
    mat.color.setHex(color).multiplyScalar(bright)
    grp.position.set(x, y, z)
    grp.rotation.y = -aim
    grp.scale.set(len, width, width)
    this.push('beam', grp, mat, life, width, width * 0.15, 1)
  }

  /** 떠오르는 기호 n 개 (♪ ✚ ★ …) */
  glyphs(x: number, z: number, ch: string, color: number, n: number, spread = 0.8, life = 1.1, size = 0.5): void {
    for (let i = 0; i < n; i++) {
      const s = this.take(`g${ch}`, () => new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glyph(ch), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))) as THREE.Sprite
      const mat = s.material
      mat.color.setHex(color).multiplyScalar(1.6)
      const a = Math.random() * Math.PI * 2
      const d = Math.random() * spread
      s.position.set(x + Math.cos(a) * d, 0.8 + Math.random() * 0.8, z + Math.sin(a) * d)
      s.scale.setScalar(size)
      this.push('glyph', s, mat, life * (0.8 + Math.random() * 0.4), size, size * 1.15, 1, 0.9 + Math.random() * 0.6)
    }
  }

  /** 사방으로 튀는 빛 알갱이 */
  sparks(x: number, y: number, z: number, color: number, n: number, speed = 0.1, life = 0.5, size = 0.8, up = 0.08): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2
      const sp = speed * (0.4 + Math.random() * 0.8)
      this.host.glow(x, y, z, Math.cos(a) * sp, up * (0.5 + Math.random()), Math.sin(a) * sp, life * (0.7 + Math.random() * 0.6), color, size)
    }
  }

  /** 둘레에 연기 · 먼지 */
  smoke(x: number, z: number, color: number, n: number, r = 1, size = 0.5, alpha = 0.45): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2
      const d = Math.random() * r
      this.host.puff(x + Math.cos(a) * d, 0.3, z + Math.sin(a) * d, Math.cos(a) * 0.012, 0.01 + Math.random() * 0.01, Math.sin(a) * 0.012, 0.9 + Math.random() * 0.6, color, size, alpha)
    }
  }

  /** 몸 둘레를 돌며 솟는 알갱이 (버프) */
  spiral(x: number, z: number, color: number, n = 18, r = 0.6, size = 0.7): void {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 4
      const rr = r * (0.8 + Math.random() * 0.4)
      this.host.glow(x + Math.cos(a) * rr, 0.1 + (k / n) * 0.6, z + Math.sin(a) * rr, -Math.sin(a) * 0.025, 0.06 + Math.random() * 0.04, Math.cos(a) * 0.025, 0.8 + Math.random() * 0.4, color, size)
    }
  }

  // ---------------------------------------------------------------- 스킬마다 (기본 스킬 id — 트리 스킬은 base 를 쓴다)

  /** 시전 (sim 'skill' 이벤트). 고유 연출이 있으면 true */
  cast(id: string, c: FxAt): boolean {
    const h = this.host
    const { x, z, aim } = c
    const dx = Math.cos(aim)
    const dz = Math.sin(aim)
    switch (id) {
      case 'ironwall': // 쇳빛 방벽: 솟는 기둥 + 단단한 고리 + 쇳불티
        this.pillar(x, z, 0x9ac8ff, 0.9, 2.6, 0.7)
        this.wave(x, z, 0x9ac8ff, 2.2, 0.4)
        this.sparks(x, 1, z, 0xd8ecff, 14, 0.09)
        return true
      case 'barrage': // 격정 연주: 음표가 쏟아진다
        this.glyphs(x, z, '♪', 0xff7aa8, 7, 1.0)
        this.glyphs(x, z, '♫', 0xffc46a, 4, 1.0)
        this.sparks(x, 1, z, 0xff9ac8, 10, 0.07)
        return true
      case 'roar': // 포효: 시전 땐 짧은 섬광 (충격은 aoe 에서)
        h.impact(x, 1.2, z, 0xffa04a, 3)
        return true
      case 'pierce': // 관통탄: 총구 둘레로 금빛 탄이 장전된다
        this.spiral(x, z, 0xffd86a, 12, 0.45, 0.6)
        this.beam(x, z, aim, 3, 0xffd86a, 0.25, 0.25)
        return true
      case 'grenade': // 던지는 손 (터짐은 aoe)
        this.sparks(x + dx * 0.5, 1, z + dz * 0.5, 0xffc070, 5, 0.05, 0.3, 0.5)
        return true
      case 'composure': // 침착: 푸른 고요 — 몸 둘레 나선 + 조준선 고리
        this.spiral(x, z, 0x7ac8ff, 20, 0.55)
        this.wave(x, z, 0x7ac8ff, 1.6, 0.6, 1.4, 1.2)
        return true
      case 'broadcast': // 생중계: 퍼지는 전파 셋
        for (let i = 0; i < 3; i++) setTimeout(() => this.wave(x, z, 0xb99cff, 9, 0.9, 0.4, 1.3), i * 180)
        this.glyphs(x, z, '●', 0xff5a5a, 1, 0, 1.2, 0.5)
        return true
      case 'fanfire': // 난사: 부채꼴 총구 불
        this.fan(x, z, aim, 0.3, 4, 0xffc070, 0.22, 2.2)
        this.sparks(x + dx * 0.7, 0.9, z + dz * 0.7, 0xffe0a0, 12, 0.14, 0.3, 0.6, 0.03)
        return true
      case 'spotlight': // 무대 조명: 하늘에서 내리꽂는 빛기둥
        this.pillar(c.tx, c.tz, 0xfff0b0, 1.6, 6, 1.1, 1.6)
        this.wave(c.tx, c.tz, 0xfff0b0, 2.4, 0.6)
        return true
      case 'firstaid': // 응급 처치: 초록 빛기둥 + 십자
        this.pillar(x, z, 0x7ef0a0, 1.1, 3, 1.0)
        this.glyphs(x, z, '✚', 0x7ef0a0, 6, 1.4)
        this.wave(x, z, 0x7ef0a0, 4, 0.7)
        return true
      case 'flame': // 소독 화염: 불꽃 부채(던전은 둘레) — 터짐은 aoe
        return true
      case 'surgery': // 대수술: 크게 솟는 초록 기둥 · 십자 비
        this.pillar(x, z, 0x9affb8, 1.6, 5, 1.3, 2)
        this.glyphs(x, z, '✚', 0xb8ffc8, 12, 3, 1.4, 0.6)
        this.wave(x, z, 0x9affb8, 7, 0.9)
        h.light(x, 1.5, z, 0x9affb8, 16, 10, 0.4)
        return true
      case 'pancharge': // 달군 후라이팬: 열기 고리 + 불티
        this.wave(x, z, 0xff8a3a, 3, 0.45)
        this.spiral(x, z, 0xffa040, 16, 0.5)
        this.smoke(x, z, 0x6a5a50, 4, 0.6, 0.35, 0.3)
        return true
      case 'oil': // 기름: 터짐은 aoe
        return true
      case 'kitchen': // 주방 대참사: 돌아가는 칼바람
        for (let k = 0; k < 3; k++) setTimeout(() => this.fan(x, z, aim + (k * Math.PI * 2) / 3, 0.5, 2.6, 0xffe0c0, 0.3, 1.6), k * 90)
        this.sparks(x, 0.8, z, 0xffffff, 12, 0.12)
        return true
      case 'catstep': // 고양이 걸음: 사뿐한 빛 · 발자국
        this.glyphs(x, z, '✦', 0xbfe8ff, 3, 0.8, 0.9, 0.45)
        this.spiral(x, z, 0xbfe8ff, 14, 0.45, 0.55)
        return true
      case 'railshot': // 관통 저격: 길고 굵은 광선
        this.beam(x, z, aim, 22, 0x9ae8ff, 0.7, 0.5, 0.9, 2.6)
        h.impact(x + dx * 0.8, 1, z + dz * 0.8, 0x9ae8ff, 3)
        this.sparks(x + dx * 0.8, 1, z + dz * 0.8, 0xd8f8ff, 10, 0.12, 0.3)
        h.shake(0.3)
        return true
      case 'ninelives': // 아홉 목숨: 금빛 아홉 불꽃이 몸을 돈다
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2
          h.glow(x + Math.cos(a) * 0.7, 1.1, z + Math.sin(a) * 0.7, -Math.sin(a) * 0.03, 0.03, Math.cos(a) * 0.03, 1.2, 0xffd86a, 1)
        }
        this.wave(x, z, 0xffd86a, 2, 0.5)
        return true
      case 'flash': // 섬광: 하얗게 번쩍 (기절 고리는 aoe)
        h.impact(x, 1, z, 0xffffff, 6)
        h.light(x, 1.2, z, 0xffffff, 30, 10, 0.12)
        return true
      case 'mirror': // 후광: 머리 위 금빛 고리 + 반짝
        this.wave(x, z, 0xfff0a0, 2.4, 0.6)
        this.pillar(x, z, 0xfff0a0, 0.7, 2.4, 0.8, 1.4)
        this.glyphs(x, z, '✦', 0xfff0a0, 5, 0.9)
        return true
      case 'supernova': // 초신성: 시전 땐 빨려 드는 빛 (터짐은 aoe)
        h.impact(x, 1.2, z, 0xffffff, 5)
        return true
      case 'stunt': // 스턴트: 구르며 부채꼴 총구 불 + 흙먼지
        this.fan(x, z, aim, 0.35, 4, 0xffc070, 0.22, 2)
        this.smoke(x, z, 0xd8c8a8, 8, 0.6, 0.35, 0.45)
        return true
      case 'curtain': // 커튼콜: 붉은 막이 내리듯 — 붉은 파도 + 떨어지는 꽃잎
        this.wave(x, z, 0xd0506a, 7, 0.8)
        for (let k = 0; k < 24; k++) {
          const a = Math.random() * Math.PI * 2
          const d = Math.random() * 6
          h.glow(x + Math.cos(a) * d, 2.2 + Math.random(), z + Math.sin(a) * d, 0, -0.02, 0, 1.2, 0xff5a7a, 0.7)
        }
        return true
      case 'redcarpet': // 레드카펫: 발밑에 붉은 길
        this.beam(x, z, aim, 5, 0xff4a5a, 1.2, 0.8, 0.05, 1.6)
        this.glyphs(x, z, '★', 0xffd86a, 4, 1)
        return true
      case 'overdrive': // 폭주: 노란 번개 기둥 + 튀는 전기
        this.pillar(x, z, 0xfff07a, 0.6, 3.6, 0.5, 2.4)
        this.sparks(x, 1, z, 0xfff07a, 20, 0.16, 0.25, 0.6)
        h.light(x, 1.2, z, 0xfff07a, 18, 8, 0.2)
        return true
      case 'shout': // 고함: 앞으로 퍼지는 부채꼴 음파 (aoe 도 같은 자리)
        this.fan(x, z, aim, 0.5, 6, 0xffb46a, 0.35, 1.8)
        setTimeout(() => this.fan(x, z, aim, 0.5, 6, 0xffb46a, 0.3, 1.2), 110)
        return true
      case 'kingrage': // 킹의 분노: 붉은 불꽃이 솟는다 + 왕관
        this.spiral(x, z, 0xff5a3a, 22, 0.55, 0.8)
        this.glyphs(x, z, '★', 0xffd86a, 3, 0.6, 1.2, 0.6)
        this.wave(x, z, 0xff5a3a, 2.5, 0.45)
        return true
      case 'advice': // 훈수: 채팅이 쏟아진다 — 물음표 · 느낌표
        this.glyphs(x, z, '?', 0xd8a8ff, 5, 3, 1.3, 0.55)
        this.glyphs(x, z, '!', 0xffd86a, 4, 3, 1.3, 0.55)
        this.wave(x, z, 0xb08aff, 8, 0.7)
        return true
      case 'cluck': // 꼬꼬꼬: 깃털 (터짐은 aoe)
        return true
      case 'kenwang': // 켠왕: 버티는 방패 — 초록 금빛 기둥 + 고리
        this.pillar(x, z, 0xd8ff7a, 1.1, 3.4, 1.0)
        this.wave(x, z, 0xd8ff7a, 6, 0.7)
        this.glyphs(x, z, '★', 0xd8ff7a, 3, 0.8, 1.3, 0.55)
        return true
      case 'snack': // 치킨 나눔: 따뜻한 회복 기둥 + 십자
        this.pillar(x, z, 0xffc06a, 1.1, 3, 1)
        this.glyphs(x, z, '✚', 0xffd890, 6, 1.6)
        this.wave(x, z, 0xffc06a, 7, 0.7)
        return true
      case 'trap': // 덫 놓기: 쇳빛 반짝 (터짐은 aoe)
        this.sparks(c.tx, 0.3, c.tz, 0xd8d8e8, 8, 0.05, 0.4, 0.5)
        this.wave(c.tx, c.tz, 0xd8d8e8, 1, 0.4)
        return true
      case 'angelshot': // 천사의 한 발: 아주 굵은 금빛 광선 + 깃털
        this.beam(x, z, aim, 18, 0xfff0b0, 1.6, 0.7, 0.9, 3)
        this.beam(x, z, aim, 18, 0xffffff, 0.5, 0.5, 0.9, 3)
        for (let k = 0; k < 16; k++) {
          const t = Math.random() * 18
          h.glow(x + dx * t, 1 + Math.random(), z + dz * t, 0, 0.02, 0, 1, 0xffffff, 0.8)
        }
        h.light(x + dx * 2, 1.2, z + dz * 2, 0xfff0b0, 24, 12, 0.3)
        h.shake(0.4)
        return true
      case 'catwalk': // 런웨이: 분홍 빛길 + 플래시
        this.beam(x, z, aim, 4, 0xff9ac8, 1, 0.6, 0.05, 1.6)
        this.glyphs(x, z, '✦', 0xffffff, 6, 1.6, 0.8, 0.45)
        return true
      case 'flashbulb': // 플래시 세례: 터짐은 aoe(커서 자리)
        return true
      case 'encore': // 앙코르: 금빛 기둥 + 음표 + 색종이
        this.pillar(x, z, 0xffd86a, 1, 3.6, 1)
        this.glyphs(x, z, '♪', 0xffd86a, 5, 1.2)
        this.glyphs(x, z, '★', 0xff9ac8, 4, 1.2)
        return true
      case 'bladewind': // 칼바람: 시전 땐 짧은 회오리 (터짐은 aoe)
        for (let k = 0; k < 4; k++) setTimeout(() => this.fan(x, z, aim + (k * Math.PI) / 2, 0.6, 3.5, 0xe8f4ff, 0.25, 1.6), k * 60)
        return true
    }
    return false
  }

  /** 범위 터짐 (sim 'aoe' 이벤트). 고유 연출이 있으면 true */
  aoe(id: string, c: FxAt): boolean {
    const h = this.host
    const { x, z, r } = c
    switch (id) {
      case 'grenade': // 불덩이 + 충격파 + 솟는 연기 + 불티
        h.impact(x, 0.9, z, 0xffa040, r * 2.6)
        h.impact(x, 0.9, z, 0xffffff, r * 1.2)
        this.wave(x, z, 0xff8a3a, r * 1.15, 0.45, 0.3, 1.8)
        this.sparks(x, 0.6, z, 0xffb050, 26, 0.16, 0.6, 0.9, 0.14)
        this.smoke(x, z, 0x3a3530, 10, r * 0.5, 0.7, 0.55)
        h.light(x, 1, z, 0xff8a3a, 30, r * 3, 0.25)
        h.shake(0.35)
        return true
      case 'roar': // 땅을 울리는 충격파 둘 + 흙먼지
        this.wave(x, z, 0xffa04a, r * 1.1, 0.5, 0.4, 1.8)
        setTimeout(() => this.wave(x, z, 0xffd0a0, r * 0.9, 0.4, 0.3, 1.2), 90)
        this.smoke(x, z, 0x8a7a68, 12, r * 0.8, 0.55, 0.4)
        h.shake(0.35)
        return true
      case 'flame': // 불꽃 바다: 솟는 불티 + 연기
        this.wave(x, z, 0xff7a2a, r, 0.4, 0.3, 1.6)
        for (let k = 0; k < 34; k++) {
          const a = Math.random() * Math.PI * 2
          const d = Math.random() * r
          h.glow(x + Math.cos(a) * d, 0.2, z + Math.sin(a) * d, Math.cos(a) * 0.02, 0.08 + Math.random() * 0.08, Math.sin(a) * 0.02, 0.5 + Math.random() * 0.3, k % 3 ? 0xff8a3a : 0xffd26a, 1)
        }
        this.smoke(x, z, 0x4a3a30, 6, r * 0.7, 0.5, 0.4)
        return true
      case 'oil': // 기름 방울 + 바닥에 번지는 빛
        this.wave(x, z, 0xe8d060, r, 0.5, 0.3, 1.1)
        return false // 기름 방울(조각)은 렌더러의 옛 연출을 함께 쓴다
      case 'flash': // 섬광 고리
        this.wave(x, z, 0xffffff, r * 1.1, 0.3, 0.3, 2.2)
        this.sparks(x, 1, z, 0xffffff, 14, 0.15, 0.25, 0.6)
        return true
      case 'supernova': // 초신성: 흰 핵 · 두 겹 충격파 · 사방으로 튀는 빛 · 크게 흔들림
        h.impact(x, 1.2, z, 0xffffff, r * 2.2)
        h.impact(x, 1.2, z, 0xffd86a, r * 3)
        this.wave(x, z, 0xfff0b0, r * 1.15, 0.6, 0.4, 2.2)
        setTimeout(() => this.wave(x, z, 0xffd86a, r * 0.9, 0.5, 0.3, 1.6), 120)
        this.pillar(x, z, 0xfff0b0, 1.6, 6, 0.7, 2)
        this.sparks(x, 1, z, 0xfff0b0, 40, 0.24, 0.7, 1)
        h.light(x, 1.5, z, 0xfff0b0, 40, r * 3, 0.35)
        h.shake(0.6)
        return true
      case 'cluck': // 꼬꼬꼬: 깃털이 흩날린다 + 충격파
        this.wave(x, z, 0xfff6e0, r, 0.4)
        for (let k = 0; k < 16; k++) {
          const a = Math.random() * Math.PI * 2
          h.puff(x, 0.8, z, Math.cos(a) * 0.05, 0.03, Math.sin(a) * 0.05, 1.2, 0xffffff, 0.18, 0.8)
        }
        return true
      case 'bladewind': // 칼바람: 하얀 바람 고리 + 날리는 조각
        this.wave(x, z, 0xe8f4ff, r * 1.1, 0.4, 0.3, 1.7)
        this.sparks(x, 0.6, z, 0xe8f4ff, 18, 0.2, 0.35, 0.6, 0.02)
        return true
      case 'trap': // 덫이 물었다: 쇳조각 + 충격파 + 섬광
        h.impact(x, 0.6, z, 0xd8d8ff, r * 1.6)
        this.wave(x, z, 0xd8d8ff, r * 1.1, 0.4, 0.3, 1.8)
        this.sparks(x, 0.4, z, 0xfff0d0, 18, 0.14, 0.4)
        h.shake(0.25)
        return true
      case 'flashbulb': // 사진기 섬광: 하얀 번쩍 + 빛살
        h.impact(x, 1, z, 0xffffff, r * 2)
        h.light(x, 1.2, z, 0xffffff, 26, r * 3, 0.12)
        this.wave(x, z, 0xffffff, r, 0.3, 0.3, 2)
        this.glyphs(x, z, '✦', 0xffffff, 4, r * 0.6, 0.6, 0.5)
        return true
      case 'echo': // 스킬 변형 "여진": 같은 자리에 한 번 더 — 금빛 충격파 · 불티
        this.wave(x, z, 0xffe08a, r * 1.05, 0.4, 0.3, 1.6)
        this.sparks(x, 0.6, z, 0xffe08a, 14, 0.14, 0.4, 0.7)
        h.impact(x, 0.8, z, 0xffd86a, r * 1.4)
        return true
      case 'curtain':
      case 'shout':
      case 'catstep':
      case 'pancharge':
      case 'catwalk': // 시전 연출로 충분 — 작은 고리만
        this.wave(x, z, 0xffffff, r * 0.9, 0.3, 0.3, 0.6)
        return true
    }
    return false
  }

  // ---------------------------------------------------------------- 갱신

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i]
      l.life -= dt
      if (l.life <= 0) {
        this.end(i)
        continue
      }
      const t = 1 - l.life / l.max
      const e = 1 - (1 - t) * (1 - t) // 빠르게 퍼졌다 느려진다
      const fade = Math.min(1, t * 10) * (1 - t) * (1 - t)
      l.mat.opacity = l.peak * fade * 1.6
      if (l.kind === 'wave') l.obj.scale.setScalar(l.s0 + (l.s1 - l.s0) * e)
      else if (l.kind === 'pillar') l.obj.scale.set(l.s0 * (1 + 0.25 * t), 0.2 + (l.s1 - 0.2) * e, l.s0 * (1 + 0.25 * t))
      else if (l.kind === 'fan') l.obj.scale.setScalar(l.s0 + (l.s1 - l.s0) * e)
      else if (l.kind === 'beam') {
        const w = l.s0 + (l.s1 - l.s0) * t
        l.obj.scale.y = w
        l.obj.scale.z = w
      } else if (l.kind === 'glyph') {
        l.obj.position.y += l.vy * dt
        l.obj.scale.setScalar(l.s0 + (l.s1 - l.s0) * t)
        l.mat.opacity = Math.min(1, t * 8) * (1 - t)
      }
    }
  }

  private end(i: number): void {
    const l = this.live[i]
    this.scene.remove(l.obj)
    const key = l.obj.userData.pool as string
    let pool = this.pools.get(key)
    if (!pool) this.pools.set(key, (pool = []))
    if (pool.length < 24) pool.push(l.obj)
    this.live.splice(i, 1)
  }

  clear(): void {
    while (this.live.length) this.end(this.live.length - 1)
  }

  dispose(): void {
    this.clear()
    for (const t of Object.values(this.tex)) t.dispose()
    for (const t of this.glyphTex.values()) t.dispose()
    this.geo.wave.dispose()
    this.geo.pillar.dispose()
    this.geo.beamFlat.dispose()
    this.geo.beamUp.dispose()
    for (const g of this.geo.fans.values()) g.dispose()
  }
}
