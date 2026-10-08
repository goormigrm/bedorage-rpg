// 마을 사람 초상 (2026-10-08 퀄리티 2차 7단계 U6 — 전에는 창 위에 따옴표 한 줄): 대사 상자 왼쪽의 둥근 그림.
// 3D 마을 사람(render3d/npc3d.ts)과 같은 차림을 캔버스에 2D 로 — 계란 얼굴 · 눈 · 볼 · 웃는 입 + 역할마다 모자 · 소품 하나.
// 파일 없이 코드로 그린다(한 번 그려 data URL 로 기억). 철면수심전용은 색만 바뀐다.

import type { NpcId } from '../core/world'

const cache = new Map<string, string>()

/** 초상 그림 (정사각 · data URL) */
export function npcPortrait(id: NpcId, bright: boolean): string {
  const key = `${id}|${bright}`
  const hit = cache.get(key)
  if (hit) return hit
  const S = 128
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const g = c.getContext('2d')!
  // 바탕: 역할 색의 둥근 빛
  const tint: Record<NpcId, string> = {
    merchant: '#5a7a3a',
    smith: '#8a4a2a',
    gambler: bright ? '#a47ad8' : '#4a2a52',
    stash: '#6a4a2a',
    elder: bright ? '#ff8fb8' : '#5a5a4a',
    captain: '#7a3a2a',
    trial: bright ? '#ff8fd0' : '#5a2a9a',
  }
  const bg = g.createRadialGradient(S / 2, S * 0.45, 8, S / 2, S / 2, S * 0.7)
  bg.addColorStop(0, tint[id])
  bg.addColorStop(1, '#0c0a08')
  g.fillStyle = bg
  g.fillRect(0, 0, S, S)
  if (id === 'stash') drawChest(g, S, bright)
  else if (id === 'trial') drawGate(g, S, bright)
  else drawEgg(g, S, id, bright)
  const url = c.toDataURL('image/png')
  cache.set(key, url)
  return url
}

function drawEgg(g: CanvasRenderingContext2D, S: number, id: NpcId, bright: boolean): void {
  const cx = S / 2
  const cy = S * 0.6
  const rx = S * 0.3
  const ry = S * 0.38
  const cloth: Partial<Record<NpcId, string>> = { merchant: '#5a7a3a', smith: '#4a3a30', gambler: '#4a2a52', elder: bright ? '#ff8fb8' : '#5a5a4a', captain: '#5a2a22' }
  // 몸 (계란) — 아래 40% 는 옷
  g.save()
  g.beginPath()
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  g.clip()
  g.fillStyle = '#f6ead6'
  g.fillRect(0, 0, S, S)
  g.fillStyle = cloth[id] ?? '#5a4a3a'
  g.fillRect(0, cy + ry * 0.25, S, S)
  // 아래쪽 그늘 (툰 명암 한 단)
  g.fillStyle = 'rgba(60,30,10,0.18)'
  g.beginPath()
  g.ellipse(cx + rx * 0.35, cy + ry * 0.2, rx * 0.9, ry, 0, 0, Math.PI * 2)
  g.fill()
  g.restore()
  // 먹선
  g.strokeStyle = 'rgba(20,12,8,0.85)'
  g.lineWidth = 3
  g.beginPath()
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  g.stroke()
  const ey = cy - ry * 0.18
  for (const s of [-1, 1]) {
    g.fillStyle = '#2a1e18'
    g.beginPath()
    g.ellipse(cx + s * 12, ey, 4.5, 6, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#fff'
    g.beginPath()
    g.arc(cx + s * 12 + 1.5, ey - 2.5, 1.6, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = 'rgba(255,130,130,0.5)'
    g.beginPath()
    g.ellipse(cx + s * 21, ey + 9, 6, 3.5, 0, 0, Math.PI * 2)
    g.fill()
  }
  const beard = id === 'elder' && !bright
  if (!beard) {
    g.strokeStyle = '#6a3a2a'
    g.lineWidth = 2.5
    g.beginPath()
    g.arc(cx, ey + 8, 6, 0.15 * Math.PI, 0.85 * Math.PI)
    g.stroke()
  }
  const top = cy - ry
  if (id === 'merchant') {
    // 납작 모자
    g.fillStyle = '#6a8a4a'
    g.beginPath()
    g.ellipse(cx, top + 10, rx * 0.95, 12, 0, Math.PI, 0)
    g.fill()
    g.fillRect(cx - rx * 0.2, top + 8, rx * 1.25, 6)
    g.fillStyle = '#ffd34a'
    g.beginPath()
    g.arc(cx + rx * 0.75, cy + ry * 0.55, 7, 0, Math.PI * 2)
    g.fill()
  } else if (id === 'smith') {
    // 붉은 머리띠 + 망치
    g.fillStyle = '#b83a2a'
    g.fillRect(cx - rx, top + ry * 0.45, rx * 2, 8)
    g.fillStyle = '#7a5a3a'
    g.fillRect(cx + rx * 0.8, cy - 4, 5, 40)
    g.fillStyle = '#8b949c'
    g.fillRect(cx + rx * 0.8 - 8, cy - 12, 22, 12)
  } else if (id === 'gambler') {
    // 실크햇 + 띠
    g.fillStyle = bright ? '#c6a4ff' : '#2a1e30'
    g.fillRect(cx - rx * 1.05, top + 6, rx * 2.1, 6)
    g.fillRect(cx - rx * 0.6, top - 24, rx * 1.2, 32)
    g.fillStyle = '#d8402a'
    g.fillRect(cx - rx * 0.6, top - 2, rx * 1.2, 6)
  } else if (id === 'elder') {
    if (bright) {
      // 안내원 모모: 분홍 모자 · 흰 챙 · 깃발
      g.fillStyle = '#ff8fb8'
      g.beginPath()
      g.ellipse(cx, top + 12, rx * 0.95, 16, 0, Math.PI, 0)
      g.fill()
      g.fillStyle = '#fff'
      g.fillRect(cx - 4, top + 10, rx * 1.2, 5)
      g.fillStyle = '#ffd36e'
      g.beginPath()
      g.moveTo(cx - rx - 6, cy - 20)
      g.lineTo(cx - rx - 6, cy - 44)
      g.lineTo(cx - rx + 16, cy - 32)
      g.fill()
    } else {
      // 촌장 카인: 두건 + 흰 수염
      g.fillStyle = '#6a5a40'
      g.beginPath()
      g.ellipse(cx, top + 18, rx * 1.05, 22, 0, Math.PI, 0)
      g.fill()
      g.fillStyle = '#f2f0ea'
      g.beginPath()
      g.moveTo(cx - 16, ey + 6)
      g.lineTo(cx + 16, ey + 6)
      g.lineTo(cx, ey + 40)
      g.fill()
    }
  } else if (id === 'captain') {
    // 투구 + 깃털
    g.fillStyle = '#9aa4ad'
    g.beginPath()
    g.ellipse(cx, top + 16, rx * 1.05, 20, 0, Math.PI, 0)
    g.fill()
    g.fillStyle = bright ? '#ff8fb8' : '#d8402a'
    g.beginPath()
    g.ellipse(cx - 4, top - 6, 6, 14, -0.4, 0, Math.PI * 2)
    g.fill()
  }
}

/** 보관함: 쇠테 궤짝 */
function drawChest(g: CanvasRenderingContext2D, S: number, bright: boolean): void {
  const x = S * 0.2
  const y = S * 0.42
  const w = S * 0.6
  const h = S * 0.36
  g.fillStyle = bright ? '#7fdcc0' : '#4a3420'
  g.fillRect(x, y, w, h)
  g.fillStyle = bright ? '#9fe8d0' : '#5a4028'
  g.beginPath()
  g.ellipse(S / 2, y, w / 2, h * 0.45, 0, Math.PI, 0)
  g.fill()
  g.fillStyle = bright ? '#ffd36e' : '#8a8070'
  g.fillRect(x - 2, y + h * 0.35, w + 4, 6)
  g.fillStyle = '#c9a24a'
  g.fillRect(S / 2 - 6, y + h * 0.25, 12, 14)
  g.strokeStyle = 'rgba(20,12,8,0.85)'
  g.lineWidth = 3
  g.strokeRect(x, y, w, h)
}

/** 시련의 문: 돌기둥 사이 소용돌이 */
function drawGate(g: CanvasRenderingContext2D, S: number, bright: boolean): void {
  g.fillStyle = bright ? '#ffb8d8' : '#4a4652'
  g.fillRect(S * 0.16, S * 0.2, S * 0.14, S * 0.7)
  g.fillRect(S * 0.7, S * 0.2, S * 0.14, S * 0.7)
  g.fillRect(S * 0.12, S * 0.12, S * 0.76, S * 0.12)
  const sw = g.createRadialGradient(S / 2, S * 0.56, 2, S / 2, S * 0.56, S * 0.26)
  sw.addColorStop(0, '#fff')
  sw.addColorStop(0.3, bright ? '#ff9ad8' : '#b47aff')
  sw.addColorStop(1, bright ? 'rgba(122,216,255,0.2)' : 'rgba(58,26,138,0.2)')
  g.fillStyle = sw
  g.beginPath()
  g.ellipse(S / 2, S * 0.56, S * 0.2, S * 0.3, 0, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.6)'
  g.lineWidth = 2
  for (let k = 0; k < 3; k++) {
    g.beginPath()
    for (let i = 0; i <= 24; i++) {
      const t = i / 24
      const a = k * 2.1 + t * 4
      const r = 3 + t * S * 0.18
      const px = S / 2 + Math.cos(a) * r * 0.7
      const py = S * 0.56 + Math.sin(a) * r
      if (i === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.stroke()
  }
}
