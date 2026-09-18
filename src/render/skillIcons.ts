// 스킬 아이콘: 이미지 파일 없이 캔버스 선·면으로 그린다(저작권·준비물 0 원칙). (cx, cy) 가운데, s = 한 변.
// 디아블로 4 의 스킬 칸처럼 어두운 바탕에 금속빛 실루엣 — 색은 역할마다(탱커 주황 · 원거리 청록 · 정찰 보라 · 치유 초록 · 근접 붉은 금 · 저격 파랑).

import { SkillId } from '../core/skills'

type Painter = (c: CanvasRenderingContext2D, s: number) => void

const TONE: Record<SkillId, string> = {
  ironwall: '#e0a060', barrage: '#e0a060', roar: '#ff8a50',
  pierce: '#7fd6d0', grenade: '#7fd6d0', composure: '#ffd86a',
  broadcast: '#b99cff', fanfire: '#b99cff', spotlight: '#fff0b0',
  firstaid: '#7ee0a0', flame: '#ff9a4a', surgery: '#b0ffcc',
  pancharge: '#ffb070', oil: '#e8d060', kitchen: '#ff7050',
  catstep: '#9cc8ff', railshot: '#9cc8ff', ninelives: '#ffd86a',
  flash: '#fff4a0', mirror: '#c8f0ff', supernova: '#ffe070',
  stunt: '#e8c070', curtain: '#d0506a', redcarpet: '#ff4a5a',
  overdrive: '#ff9a3a', shout: '#ffb050', kingrage: '#ffd040',
  gust: '#a0f0e0', windstep: '#a0f0e0', typhoon: '#70d0ff',
  snack: '#ffc070', trap: '#c09060', angelshot: '#fff0c0',
  catwalk: '#f0a0d0', flashbulb: '#ffffff', encore: '#ffd0f0',
}

function line(c: CanvasRenderingContext2D, pts: number[][], w: number): void {
  c.lineWidth = w
  c.beginPath()
  pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)))
  c.stroke()
}

const P: Record<SkillId, Painter> = {
  // 방패
  ironwall: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.moveTo(0, -k * 0.8)
    c.lineTo(k * 0.62, -k * 0.5)
    c.lineTo(k * 0.55, k * 0.15)
    c.quadraticCurveTo(k * 0.35, k * 0.6, 0, k * 0.82)
    c.quadraticCurveTo(-k * 0.35, k * 0.6, -k * 0.55, k * 0.15)
    c.lineTo(-k * 0.62, -k * 0.5)
    c.closePath()
    c.fill()
    c.globalCompositeOperation = 'destination-out'
    line(c, [[0, -k * 0.5], [0, k * 0.5]], s * 0.08)
    line(c, [[-k * 0.35, -k * 0.1], [k * 0.35, -k * 0.1]], s * 0.08)
    c.globalCompositeOperation = 'source-over'
  },
  // 탄 세 줄
  barrage: (c, s) => {
    const k = s / 2
    for (const y of [-0.4, 0, 0.4]) {
      line(c, [[-k * 0.75, y * k], [k * 0.35, y * k]], s * 0.08)
      c.beginPath()
      c.arc(k * 0.5, y * k, s * 0.09, 0, Math.PI * 2)
      c.fill()
    }
  },
  // 포효: 벌린 입 + 파동
  roar: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.arc(-k * 0.2, 0, k * 0.35, 0.5, Math.PI * 2 - 0.5)
    c.lineTo(-k * 0.2, 0)
    c.closePath()
    c.fill()
    for (const r of [0.45, 0.65, 0.85]) {
      c.lineWidth = s * 0.06
      c.beginPath()
      c.arc(-k * 0.2, 0, r * k, -0.6, 0.6)
      c.stroke()
    }
  },
  // 관통: 화살이 원 셋을 뚫는다
  pierce: (c, s) => {
    const k = s / 2
    for (const x of [-0.35, 0.05, 0.45]) {
      c.lineWidth = s * 0.05
      c.beginPath()
      c.arc(x * k, 0, k * 0.2, 0, Math.PI * 2)
      c.stroke()
    }
    line(c, [[-k * 0.85, 0], [k * 0.85, 0]], s * 0.08)
    line(c, [[k * 0.6, -k * 0.2], [k * 0.85, 0], [k * 0.6, k * 0.2]], s * 0.08)
  },
  // 수류탄
  grenade: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.ellipse(0, k * 0.12, k * 0.45, k * 0.55, 0, 0, Math.PI * 2)
    c.fill()
    c.fillRect(-k * 0.18, -k * 0.62, k * 0.36, k * 0.2)
    line(c, [[k * 0.18, -k * 0.55], [k * 0.55, -k * 0.75]], s * 0.06)
  },
  // 침착: 조준경 십자 + 가운데 점
  composure: (c, s) => {
    const k = s / 2
    c.lineWidth = s * 0.07
    c.beginPath()
    c.arc(0, 0, k * 0.6, 0, Math.PI * 2)
    c.stroke()
    line(c, [[-k * 0.85, 0], [-k * 0.3, 0]], s * 0.06)
    line(c, [[k * 0.3, 0], [k * 0.85, 0]], s * 0.06)
    line(c, [[0, -k * 0.85], [0, -k * 0.3]], s * 0.06)
    line(c, [[0, k * 0.3], [0, k * 0.85]], s * 0.06)
    c.beginPath()
    c.arc(0, 0, s * 0.07, 0, Math.PI * 2)
    c.fill()
  },
  // 생중계: 마이크 + 전파
  broadcast: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.ellipse(-k * 0.15, -k * 0.2, k * 0.2, k * 0.32, 0, 0, Math.PI * 2)
    c.fill()
    line(c, [[-k * 0.15, k * 0.15], [-k * 0.15, k * 0.6]], s * 0.07)
    for (const r of [0.45, 0.7]) {
      c.lineWidth = s * 0.06
      c.beginPath()
      c.arc(-k * 0.15, -k * 0.2, r * k, -0.9, 0.9)
      c.stroke()
    }
  },
  // 난사: 부채꼴 선
  fanfire: (c, s) => {
    const k = s / 2
    for (let i = -3; i <= 3; i++) {
      const a = i * 0.16
      line(c, [[-k * 0.7, k * 0.3], [-k * 0.7 + Math.cos(a) * k * 1.4, k * 0.3 + Math.sin(a) * k * 1.4 - k * 0.3]], s * 0.05)
    }
  },
  // 스포트라이트: 위에서 내리쬐는 빛
  spotlight: (c, s) => {
    const k = s / 2
    c.globalAlpha = 0.85
    c.beginPath()
    c.moveTo(-k * 0.15, -k * 0.75)
    c.lineTo(k * 0.15, -k * 0.75)
    c.lineTo(k * 0.7, k * 0.55)
    c.lineTo(-k * 0.7, k * 0.55)
    c.closePath()
    c.fill()
    c.globalAlpha = 1
    c.beginPath()
    c.ellipse(0, k * 0.58, k * 0.72, k * 0.18, 0, 0, Math.PI * 2)
    c.fill()
  },
  // 응급 처치: 십자
  firstaid: (c, s) => {
    const k = s / 2
    c.fillRect(-k * 0.18, -k * 0.65, k * 0.36, k * 1.3)
    c.fillRect(-k * 0.65, -k * 0.18, k * 1.3, k * 0.36)
  },
  // 화염
  flame: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.moveTo(0, -k * 0.85)
    c.quadraticCurveTo(k * 0.7, -k * 0.1, k * 0.35, k * 0.7)
    c.quadraticCurveTo(0, k * 0.9, -k * 0.35, k * 0.7)
    c.quadraticCurveTo(-k * 0.7, -k * 0.1, 0, -k * 0.85)
    c.fill()
  },
  // 대수술: 하트 + 십자
  surgery: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.moveTo(0, k * 0.7)
    c.bezierCurveTo(-k * 0.95, 0, -k * 0.55, -k * 0.8, 0, -k * 0.35)
    c.bezierCurveTo(k * 0.55, -k * 0.8, k * 0.95, 0, 0, k * 0.7)
    c.fill()
    c.globalCompositeOperation = 'destination-out'
    c.fillRect(-k * 0.08, -k * 0.35, k * 0.16, k * 0.6)
    c.fillRect(-k * 0.3, -k * 0.13, k * 0.6, k * 0.16)
    c.globalCompositeOperation = 'source-over'
  },
  // 돌진: 후라이팬 + 속도선
  pancharge: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.arc(k * 0.25, 0, k * 0.38, 0, Math.PI * 2)
    c.fill()
    line(c, [[-k * 0.1, 0], [-k * 0.5, 0]], s * 0.08)
    for (const y of [-0.5, 0.5]) line(c, [[-k * 0.85, y * k], [-k * 0.35, y * k]], s * 0.05)
  },
  // 기름: 방울 셋
  oil: (c, s) => {
    const k = s / 2
    const drop = (x: number, y: number, r: number) => {
      c.beginPath()
      c.moveTo(x, y - r * 1.6)
      c.quadraticCurveTo(x + r, y - r * 0.2, x, y + r)
      c.quadraticCurveTo(x - r, y - r * 0.2, x, y - r * 1.6)
      c.fill()
    }
    drop(0, -k * 0.1, k * 0.32)
    drop(-k * 0.5, k * 0.35, k * 0.2)
    drop(k * 0.5, k * 0.4, k * 0.18)
  },
  // 회전: 소용돌이
  kitchen: (c, s) => {
    const k = s / 2
    c.lineWidth = s * 0.08
    c.beginPath()
    for (let t = 0; t < 1; t += 0.02) {
      const a = t * Math.PI * 4
      const r = k * 0.1 + t * k * 0.7
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      if (t === 0) c.moveTo(x, y)
      else c.lineTo(x, y)
    }
    c.stroke()
  },
  // 고양이 발자국
  catstep: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.ellipse(0, k * 0.2, k * 0.32, k * 0.26, 0, 0, Math.PI * 2)
    c.fill()
    for (const [x, y] of [[-0.42, -0.25], [-0.15, -0.5], [0.15, -0.5], [0.42, -0.25]]) {
      c.beginPath()
      c.arc(x * k, y * k, k * 0.13, 0, Math.PI * 2)
      c.fill()
    }
  },
  // 관통 저격: 긴 탄 한 줄
  railshot: (c, s) => {
    const k = s / 2
    line(c, [[-k * 0.9, k * 0.4], [k * 0.9, -k * 0.4]], s * 0.07)
    c.beginPath()
    c.arc(k * 0.55, -k * 0.24, k * 0.14, 0, Math.PI * 2)
    c.fill()
    c.globalAlpha = 0.5
    line(c, [[-k * 0.9, k * 0.55], [k * 0.2, k * 0.05]], s * 0.04)
    c.globalAlpha = 1
  },
  // 아홉 목숨: 9
  ninelives: (c, s) => {
    c.font = `800 ${Math.round(s * 0.7)}px "Nanum Myeongjo", serif`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText('9', 0, s * 0.03)
  },
  // ---- D7 여섯
  // 섬광: 가운데 별 + 빛살
  flash: (c, s) => star(c, s, 8, 0.85, 0.3),
  // 반사광: 거울 마름모 + 되돌아가는 화살
  mirror: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.moveTo(0, -k * 0.75)
    c.lineTo(k * 0.35, 0)
    c.lineTo(0, k * 0.75)
    c.lineTo(-k * 0.35, 0)
    c.closePath()
    c.fill()
    line(c, [[k * 0.9, -k * 0.5], [k * 0.45, -k * 0.1], [k * 0.9, k * 0.3]], s * 0.06)
  },
  // 초신성: 큰 별 + 고리
  supernova: (c, s) => {
    star(c, s, 12, 0.7, 0.28)
    c.lineWidth = s * 0.05
    c.beginPath()
    c.arc(0, 0, s * 0.44, 0, Math.PI * 2)
    c.stroke()
  },
  // 스턴트: 구르는 원 + 부채 탄
  stunt: (c, s) => {
    const k = s / 2
    c.lineWidth = s * 0.07
    c.beginPath()
    c.arc(-k * 0.35, k * 0.2, k * 0.32, 0.4, Math.PI * 1.8)
    c.stroke()
    for (const a of [-0.35, 0, 0.35]) line(c, [[k * 0.1, 0], [k * 0.1 + Math.cos(a) * k * 0.75, Math.sin(a) * k * 0.75]], s * 0.05)
  },
  // 커튼콜: 양쪽 막
  curtain: (c, s) => {
    const k = s / 2
    c.fillRect(-k * 0.8, -k * 0.75, k * 1.6, k * 0.18)
    for (const side of [-1, 1]) {
      c.beginPath()
      c.moveTo(side * k * 0.8, -k * 0.6)
      c.quadraticCurveTo(side * k * 0.2, -k * 0.1, side * k * 0.55, k * 0.75)
      c.lineTo(side * k * 0.8, k * 0.75)
      c.closePath()
      c.fill()
    }
  },
  // 레드카펫: 비스듬한 긴 띠
  redcarpet: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.moveTo(-k * 0.8, k * 0.75)
    c.lineTo(-k * 0.35, k * 0.75)
    c.lineTo(k * 0.8, -k * 0.7)
    c.lineTo(k * 0.45, -k * 0.7)
    c.closePath()
    c.fill()
    star(c, s * 0.45, 5, 0.8, 0.4, k * 0.45, -k * 0.35)
  },
  // 폭주: 번개
  overdrive: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.moveTo(k * 0.15, -k * 0.85)
    c.lineTo(-k * 0.45, k * 0.1)
    c.lineTo(-k * 0.02, k * 0.1)
    c.lineTo(-k * 0.2, k * 0.85)
    c.lineTo(k * 0.45, -k * 0.15)
    c.lineTo(k * 0.02, -k * 0.15)
    c.closePath()
    c.fill()
  },
  // 고함: 확성 부채
  shout: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.moveTo(-k * 0.7, -k * 0.2)
    c.lineTo(-k * 0.2, -k * 0.2)
    c.lineTo(k * 0.3, -k * 0.6)
    c.lineTo(k * 0.3, k * 0.6)
    c.lineTo(-k * 0.2, k * 0.2)
    c.lineTo(-k * 0.7, k * 0.2)
    c.closePath()
    c.fill()
    for (const r of [0.55, 0.8]) {
      c.lineWidth = s * 0.05
      c.beginPath()
      c.arc(k * 0.1, 0, r * k, -0.7, 0.7)
      c.stroke()
    }
  },
  // 킹의 분노: 왕관
  kingrage: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.moveTo(-k * 0.7, k * 0.45)
    c.lineTo(-k * 0.7, -k * 0.35)
    c.lineTo(-k * 0.35, k * 0.05)
    c.lineTo(0, -k * 0.6)
    c.lineTo(k * 0.35, k * 0.05)
    c.lineTo(k * 0.7, -k * 0.35)
    c.lineTo(k * 0.7, k * 0.45)
    c.closePath()
    c.fill()
  },
  // 돌풍: 바람 줄 셋
  gust: (c, s) => wind(c, s, 3),
  // 순풍: 바람 둘 + 화살
  windstep: (c, s) => {
    wind(c, s, 2)
    const k = s / 2
    line(c, [[k * 0.45, k * 0.35], [k * 0.8, k * 0.55], [k * 0.45, k * 0.75]], s * 0.06)
  },
  // 태풍: 굵은 소용돌이
  typhoon: (c, s) => {
    const k = s / 2
    c.lineWidth = s * 0.1
    c.beginPath()
    for (let t = 0; t < 1; t += 0.02) {
      const a = -t * Math.PI * 3.2
      const r = k * 0.08 + t * k * 0.78
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      if (t === 0) c.moveTo(x, y)
      else c.lineTo(x, y)
    }
    c.stroke()
  },
  // 치킨 한 입: 닭다리
  snack: (c, s) => {
    const k = s / 2
    c.beginPath()
    c.ellipse(-k * 0.15, -k * 0.15, k * 0.42, k * 0.34, -0.7, 0, Math.PI * 2)
    c.fill()
    line(c, [[k * 0.1, k * 0.1], [k * 0.55, k * 0.55]], s * 0.1)
    c.beginPath()
    c.arc(k * 0.62, k * 0.5, k * 0.1, 0, Math.PI * 2)
    c.arc(k * 0.5, k * 0.64, k * 0.1, 0, Math.PI * 2)
    c.fill()
  },
  // 덫: 톱니 턱
  trap: (c, s) => {
    const k = s / 2
    c.lineWidth = s * 0.06
    c.beginPath()
    c.arc(0, 0, k * 0.6, 0, Math.PI * 2)
    c.stroke()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      c.beginPath()
      c.moveTo(Math.cos(a - 0.2) * k * 0.6, Math.sin(a - 0.2) * k * 0.6)
      c.lineTo(Math.cos(a) * k * 0.3, Math.sin(a) * k * 0.3)
      c.lineTo(Math.cos(a + 0.2) * k * 0.6, Math.sin(a + 0.2) * k * 0.6)
      c.fill()
    }
  },
  // 천사의 한 발: 날개 + 긴 탄
  angelshot: (c, s) => {
    const k = s / 2
    line(c, [[-k * 0.9, 0], [k * 0.9, 0]], s * 0.09)
    for (const side of [-1, 1]) {
      c.beginPath()
      c.moveTo(-k * 0.2, 0)
      c.quadraticCurveTo(-k * 0.55, side * k * 0.75, -k * 0.85, side * k * 0.55)
      c.quadraticCurveTo(-k * 0.5, side * k * 0.25, -k * 0.2, 0)
      c.fill()
    }
  },
  // 런웨이 워크: 하이힐 발자국 + 선
  catwalk: (c, s) => {
    const k = s / 2
    line(c, [[-k * 0.85, k * 0.55], [k * 0.85, k * 0.55]], s * 0.05)
    for (const x of [-0.45, 0.15]) {
      c.beginPath()
      c.ellipse(x * k, -k * 0.05, k * 0.14, k * 0.26, 0, 0, Math.PI * 2)
      c.fill()
      c.fillRect(x * k - k * 0.05, k * 0.2, k * 0.1, k * 0.2)
    }
  },
  // 플래시 세례: 카메라
  flashbulb: (c, s) => {
    const k = s / 2
    c.fillRect(-k * 0.7, -k * 0.35, k * 1.4, k * 0.9)
    c.fillRect(-k * 0.3, -k * 0.55, k * 0.5, k * 0.25)
    c.globalCompositeOperation = 'destination-out'
    c.beginPath()
    c.arc(0, k * 0.1, k * 0.28, 0, Math.PI * 2)
    c.fill()
    c.globalCompositeOperation = 'source-over'
    star(c, s * 0.4, 4, 0.9, 0.3, k * 0.62, -k * 0.62)
  },
  // 앙코르: 되감기 원 화살 둘
  encore: (c, s) => {
    const k = s / 2
    c.lineWidth = s * 0.08
    for (const [a0, a1] of [[0.3, 2.8], [3.44, 5.94]]) {
      c.beginPath()
      c.arc(0, 0, k * 0.55, a0, a1)
      c.stroke()
      const x = Math.cos(a1) * k * 0.55
      const y = Math.sin(a1) * k * 0.55
      c.beginPath()
      c.arc(x, y, s * 0.07, 0, Math.PI * 2)
      c.fill()
    }
  },
}

/** 별 (가운데 원 + 빛살 n 개) */
function star(c: CanvasRenderingContext2D, s: number, n: number, outer: number, inner: number, ox = 0, oy = 0): void {
  const k = s / 2
  c.beginPath()
  for (let i = 0; i < n * 2; i++) {
    const r = (i % 2 === 0 ? outer : inner) * k
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2
    const x = ox + Math.cos(a) * r
    const y = oy + Math.sin(a) * r
    if (i === 0) c.moveTo(x, y)
    else c.lineTo(x, y)
  }
  c.closePath()
  c.fill()
}

/** 바람 줄 (끝이 말린 선 n 개) */
function wind(c: CanvasRenderingContext2D, s: number, n: number): void {
  const k = s / 2
  c.lineWidth = s * 0.07
  for (let i = 0; i < n; i++) {
    const y = (i - (n - 1) / 2) * k * 0.45
    const w = k * (0.9 - i * 0.12)
    c.beginPath()
    c.moveTo(-k * 0.8, y)
    c.lineTo(-k * 0.8 + w, y)
    c.arc(-k * 0.8 + w, y - k * 0.14, k * 0.14, Math.PI / 2, -Math.PI / 2, true)
    c.stroke()
  }
}

/** 스킬 아이콘 (dim = 대기 중이라 어둡게) */
export function drawSkillIcon(c: CanvasRenderingContext2D, id: SkillId, cx: number, cy: number, s: number, dim = false): void {
  c.save()
  c.translate(cx, cy)
  c.lineCap = 'round'
  c.lineJoin = 'round'
  const col = TONE[id]
  c.fillStyle = col
  c.strokeStyle = col
  c.globalAlpha = dim ? 0.35 : 1
  if (!dim) {
    c.shadowColor = col
    c.shadowBlur = s * 0.18
  }
  P[id](c, s)
  c.restore()
}

/** 구르기 아이콘: 둥근 화살표 */
export function drawDashIcon(c: CanvasRenderingContext2D, cx: number, cy: number, s: number, dim = false): void {
  const k = s / 2
  c.save()
  c.translate(cx, cy)
  c.strokeStyle = '#9fe0ff'
  c.fillStyle = '#9fe0ff'
  c.globalAlpha = dim ? 0.35 : 1
  c.lineWidth = s * 0.08
  c.lineCap = 'round'
  c.beginPath()
  c.arc(0, 0, k * 0.55, Math.PI * 0.9, Math.PI * 2.3)
  c.stroke()
  const a = Math.PI * 2.3
  const x = Math.cos(a) * k * 0.55
  const y = Math.sin(a) * k * 0.55
  c.beginPath()
  c.moveTo(x + k * 0.22, y - k * 0.05)
  c.lineTo(x - k * 0.05, y - k * 0.25)
  c.lineTo(x - k * 0.1, y + k * 0.12)
  c.closePath()
  c.fill()
  c.restore()
}
