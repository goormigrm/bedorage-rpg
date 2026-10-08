// 아이템 그림 (2026-10-08 퀄리티 3단계 — 사용자: "게임의 퀄리티를 올릴 수 있는 것들 … 단계별로 모두"):
// 가방 · 보관함 · 상점 · 장비 칸 · 설명 풍선이 글자뿐이었다 → 부위 · 바탕 종류마다 그림 하나.
// 파일 없이 캔버스로 그려 data URL 로 한 번만 만들어 둔다(종류 33가지 — 무기 18 · 투구 4 · 갑옷 3 · 반지 4 · 목걸이 4, 바탕 없는 옛 아이템은 대표 그림).
// 무기는 스킬 바의 무기 실루엣(render/hud drawWeaponIcon)을 그대로 쓰고 쇠빛으로 칠한다. 등급은 칸의 테두리 · 빛(style.css)이 맡는다.

import { Item, SLOT_WEAPON, WEAPON_IDS } from '../core/items'
import { drawWeaponIcon } from '../render/hud'

const SIZE = 64
const cache = new Map<string, string>()

/** 이 아이템의 그림 (data URL) — 같은 종류는 한 번만 그린다 */
export function itemIconUrl(it: Item): string {
  const key = it.slot === SLOT_WEAPON ? `w${it.wt}` : `s${it.slot}-${it.bt ?? -1}`
  let url = cache.get(key)
  if (url) return url
  // 화면이 없는 곳(시험 · 서버)에서는 그림 없이
  if (typeof document === 'undefined') return ''
  const c = document.createElement('canvas')
  c.width = c.height = SIZE
  const g = c.getContext('2d')
  if (!g) return ''
  if (it.slot === SLOT_WEAPON) drawWeapon(g, WEAPON_IDS[it.wt] ?? 'rifle')
  else if (it.slot === 1) drawHelm(g, it.bt ?? 1)
  else if (it.slot === 2) drawArmor(g, it.bt ?? 2)
  else if (it.slot === 3) drawRing(g, it.bt ?? 0)
  else drawAmulet(g, it.bt ?? 1)
  url = c.toDataURL('image/png')
  cache.set(key, url)
  return url
}

// ---------------------------------------------------------------- 무기

function drawWeapon(g: CanvasRenderingContext2D, id: (typeof WEAPON_IDS)[number]): void {
  // 흰 실루엣을 그린 뒤 그 모양 안만 쇠빛 그라데이션으로 칠한다 (source-atop)
  g.save()
  g.translate(SIZE / 2 + 2, SIZE / 2 + 1)
  // 긴 총은 대각선으로 눕혀야 칸에 다 들어온다 (처음 1.25 배는 소총 · 기관총 끝이 잘렸다)
  g.rotate(-0.62)
  g.scale(0.92, 0.92)
  drawWeaponIcon(g, 0, 0, id)
  g.restore()
  g.save()
  g.globalCompositeOperation = 'source-atop'
  const grad = g.createLinearGradient(0, 8, 0, SIZE - 8)
  grad.addColorStop(0, '#f4f1ea')
  grad.addColorStop(0.5, '#b9b3a6')
  grad.addColorStop(1, '#6d675d')
  g.fillStyle = grad
  g.fillRect(0, 0, SIZE, SIZE)
  g.restore()
  shadow(g)
}

// ---------------------------------------------------------------- 도우미

/** 그린 것 아래에 옅은 그림자 (칸 바탕 위에서 떠 보이게) */
function shadow(g: CanvasRenderingContext2D): void {
  g.save()
  g.globalCompositeOperation = 'destination-over'
  g.shadowColor = 'rgba(0,0,0,0.7)'
  g.shadowBlur = 5
  g.shadowOffsetY = 2
  const img = g.getImageData(0, 0, SIZE, SIZE)
  const tmp = document.createElement('canvas')
  tmp.width = tmp.height = SIZE
  tmp.getContext('2d')!.putImageData(img, 0, 0)
  g.drawImage(tmp, 0, 0)
  g.restore()
}

function metal(g: CanvasRenderingContext2D, y0: number, y1: number, hi: string, mid: string, lo: string): CanvasGradient {
  const grad = g.createLinearGradient(0, y0, 0, y1)
  grad.addColorStop(0, hi)
  grad.addColorStop(0.5, mid)
  grad.addColorStop(1, lo)
  return grad
}

function outline(g: CanvasRenderingContext2D, w = 2): void {
  g.lineWidth = w
  g.strokeStyle = 'rgba(20,14,10,0.85)'
  g.stroke()
}

// ---------------------------------------------------------------- 투구 (가죽 두건 · 철 투구 · 사제 두건 · 사냥꾼 모자)

function drawHelm(g: CanvasRenderingContext2D, bt: number): void {
  if (bt === 0 || bt === 2) {
    // 두건: 둥근 머리 덮개 + 어깨로 흘러내리는 천 (가죽 = 갈색 · 사제 = 흰 천에 보라 테)
    const priest = bt === 2
    g.beginPath()
    g.moveTo(14, 54)
    g.quadraticCurveTo(12, 14, 32, 10)
    g.quadraticCurveTo(52, 14, 50, 54)
    g.quadraticCurveTo(32, 46, 14, 54)
    g.closePath()
    g.fillStyle = priest ? metal(g, 10, 54, '#fbf6ee', '#ddd3c4', '#a99c8a') : metal(g, 10, 54, '#b98a5a', '#8a5f38', '#5a3c22')
    g.fill()
    outline(g)
    // 얼굴 구멍
    g.beginPath()
    g.ellipse(32, 32, 10, 12, 0, 0, Math.PI * 2)
    g.fillStyle = 'rgba(15,10,8,0.85)'
    g.fill()
    if (priest) {
      g.beginPath()
      g.moveTo(14, 54)
      g.quadraticCurveTo(32, 46, 50, 54)
      g.lineWidth = 4
      g.strokeStyle = '#8a5ac0'
      g.stroke()
    } else {
      // 꿰맨 자국
      g.setLineDash([3, 3])
      g.beginPath()
      g.moveTo(32, 11)
      g.lineTo(32, 19)
      g.lineWidth = 1.5
      g.strokeStyle = 'rgba(40,24,12,0.8)'
      g.stroke()
      g.setLineDash([])
    }
  } else if (bt === 1) {
    // 철 투구: 둥근 쇠 머리 + 코 가리개 + 테
    g.beginPath()
    g.moveTo(12, 42)
    g.quadraticCurveTo(10, 10, 32, 9)
    g.quadraticCurveTo(54, 10, 52, 42)
    g.closePath()
    g.fillStyle = metal(g, 9, 42, '#eef2f5', '#9aa4ad', '#5a636b')
    g.fill()
    outline(g)
    g.fillStyle = metal(g, 38, 46, '#c9ced3', '#7d868e', '#4a5258')
    g.fillRect(10, 38, 44, 8)
    g.strokeRect(10, 38, 44, 8)
    g.beginPath()
    g.moveTo(28, 44)
    g.lineTo(36, 44)
    g.lineTo(34, 58)
    g.lineTo(30, 58)
    g.closePath()
    g.fillStyle = '#8b949c'
    g.fill()
    outline(g, 1.5)
    // 반짝
    g.beginPath()
    g.ellipse(24, 20, 5, 3, -0.6, 0, Math.PI * 2)
    g.fillStyle = 'rgba(255,255,255,0.6)'
    g.fill()
  } else {
    // 사냥꾼 모자: 챙 넓은 초록 모자 + 깃털
    g.beginPath()
    g.ellipse(32, 44, 26, 8, 0, 0, Math.PI * 2)
    g.fillStyle = metal(g, 36, 52, '#5d8a4a', '#3d6230', '#284420')
    g.fill()
    outline(g)
    g.beginPath()
    g.moveTo(18, 44)
    g.quadraticCurveTo(18, 16, 34, 16)
    g.quadraticCurveTo(48, 18, 46, 44)
    g.closePath()
    g.fillStyle = metal(g, 16, 44, '#6f9a58', '#4a7238', '#2f4c22')
    g.fill()
    outline(g)
    g.fillStyle = '#7a4a26'
    g.fillRect(18, 36, 28, 5)
    // 깃털
    g.beginPath()
    g.moveTo(42, 36)
    g.quadraticCurveTo(58, 18, 52, 8)
    g.quadraticCurveTo(48, 22, 40, 34)
    g.closePath()
    g.fillStyle = '#d8402a'
    g.fill()
    outline(g, 1.2)
  }
  shadow(g)
}

// ---------------------------------------------------------------- 갑옷 (누빈 옷 · 사슬 갑옷 · 판금 갑옷)

function torso(g: CanvasRenderingContext2D): void {
  g.beginPath()
  g.moveTo(20, 10)
  g.lineTo(26, 14)
  g.quadraticCurveTo(32, 18, 38, 14)
  g.lineTo(44, 10)
  g.lineTo(56, 18)
  g.lineTo(50, 30)
  g.lineTo(46, 27)
  g.lineTo(46, 56)
  g.quadraticCurveTo(32, 60, 18, 56)
  g.lineTo(18, 27)
  g.lineTo(14, 30)
  g.lineTo(8, 18)
  g.closePath()
}

function drawArmor(g: CanvasRenderingContext2D, bt: number): void {
  torso(g)
  if (bt === 0) {
    // 누빈 옷: 베이지 천 + 누빈 줄
    g.fillStyle = metal(g, 10, 58, '#e6d3b0', '#c4a97e', '#8a7250')
    g.fill()
    outline(g)
    g.save()
    torso(g)
    g.clip()
    g.strokeStyle = 'rgba(90,64,36,0.55)'
    g.lineWidth = 1.2
    for (let y = 20; y < 58; y += 7) {
      g.beginPath()
      g.moveTo(10, y)
      g.lineTo(54, y)
      g.stroke()
    }
    g.restore()
  } else if (bt === 1) {
    // 사슬 갑옷: 회색 + 고리 무늬
    g.fillStyle = metal(g, 10, 58, '#d5dade', '#8f989f', '#565e64')
    g.fill()
    outline(g)
    g.save()
    torso(g)
    g.clip()
    g.strokeStyle = 'rgba(40,46,52,0.55)'
    g.lineWidth = 1
    for (let y = 14; y < 60; y += 5)
      for (let x = 8 + ((y / 5) % 2) * 2.5; x < 56; x += 5) {
        g.beginPath()
        g.arc(x, y, 2, 0, Math.PI * 2)
        g.stroke()
      }
    g.restore()
  } else {
    // 판금 갑옷: 은빛 판 + 가운데 줄 + 반짝
    g.fillStyle = metal(g, 10, 58, '#f4f7f9', '#aab3ba', '#5d666d')
    g.fill()
    outline(g)
    g.beginPath()
    g.moveTo(32, 18)
    g.lineTo(32, 56)
    g.lineWidth = 2
    g.strokeStyle = 'rgba(50,56,62,0.6)'
    g.stroke()
    g.beginPath()
    g.moveTo(18, 36)
    g.quadraticCurveTo(32, 41, 46, 36)
    g.stroke()
    g.beginPath()
    g.ellipse(25, 26, 4, 7, 0.2, 0, Math.PI * 2)
    g.fillStyle = 'rgba(255,255,255,0.55)'
    g.fill()
  }
  shadow(g)
}

// ---------------------------------------------------------------- 반지 (구리 · 은 · 뼈 · 루비)

function drawRing(g: CanvasRenderingContext2D, bt: number): void {
  const band = bt === 0 ? ['#f0b98a', '#c07a48', '#7a4422'] : bt === 1 ? ['#ffffff', '#c3cbd2', '#7c858c'] : bt === 2 ? ['#fbf4e2', '#d8ccae', '#9a8c6a'] : ['#fff1a8', '#e2b23a', '#8a6414']
  // 고리 (위에서 비스듬히 본 두꺼운 고리)
  g.beginPath()
  g.ellipse(32, 38, 20, 14, 0, 0, Math.PI * 2)
  g.ellipse(32, 38, 13, 8, 0, 0, Math.PI * 2, true)
  g.fillStyle = metal(g, 24, 52, band[0], band[1], band[2])
  g.fill('evenodd')
  g.lineWidth = 2
  g.strokeStyle = 'rgba(20,14,10,0.85)'
  g.stroke()
  if (bt === 2) {
    // 뼈 반지: 갈라진 금
    g.beginPath()
    g.moveTo(16, 34)
    g.lineTo(20, 38)
    g.lineTo(18, 42)
    g.lineWidth = 1.2
    g.strokeStyle = 'rgba(90,70,40,0.8)'
    g.stroke()
  }
  if (bt === 1 || bt === 3) {
    // 보석 (은 = 파랑 · 루비 = 빨강)
    const col = bt === 3 ? ['#ffb0b0', '#e02a2a', '#7a0a0a'] : ['#cfe8ff', '#3a8ae0', '#103a7a']
    g.beginPath()
    g.moveTo(32, 12)
    g.lineTo(42, 22)
    g.lineTo(32, 32)
    g.lineTo(22, 22)
    g.closePath()
    g.fillStyle = metal(g, 12, 32, col[0], col[1], col[2])
    g.fill()
    outline(g, 1.6)
    g.beginPath()
    g.moveTo(29, 17)
    g.lineTo(32, 14)
    g.lineTo(35, 17)
    g.fillStyle = 'rgba(255,255,255,0.75)'
    g.fill()
  }
  shadow(g)
}

// ---------------------------------------------------------------- 목걸이 (나무 부적 · 은 목걸이 · 성물 목걸이 · 호박 목걸이)

function drawAmulet(g: CanvasRenderingContext2D, bt: number): void {
  // 줄: 위에서 늘어진 고리
  g.beginPath()
  g.moveTo(12, 8)
  g.quadraticCurveTo(14, 34, 32, 36)
  g.quadraticCurveTo(50, 34, 52, 8)
  g.lineWidth = 2.5
  g.strokeStyle = bt === 0 ? '#8a6a44' : bt === 2 ? '#e2b23a' : '#c3cbd2'
  g.stroke()
  if (bt === 0) {
    // 나무 부적: 갈색 패에 새긴 무늬
    g.beginPath()
    g.roundRect(22, 34, 20, 24, 4)
    g.fillStyle = metal(g, 34, 58, '#c99a64', '#9a6a3a', '#5e3e1e')
    g.fill()
    outline(g)
    g.beginPath()
    g.moveTo(27, 40)
    g.lineTo(37, 52)
    g.moveTo(37, 40)
    g.lineTo(27, 52)
    g.lineWidth = 1.6
    g.strokeStyle = 'rgba(40,24,10,0.75)'
    g.stroke()
  } else if (bt === 2) {
    // 성물: 금빛 별 모양 + 가운데 보석
    g.beginPath()
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5
      const r = k % 2 === 0 ? 13 : 6
      const x = 32 + Math.cos(a) * r
      const y = 47 + Math.sin(a) * r
      if (k === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.closePath()
    g.fillStyle = metal(g, 34, 60, '#fff1a8', '#e2b23a', '#8a6414')
    g.fill()
    outline(g, 1.6)
    g.beginPath()
    g.arc(32, 47, 3.2, 0, Math.PI * 2)
    g.fillStyle = '#e8e0ff'
    g.fill()
  } else {
    // 은 목걸이 = 푸른 물방울 · 호박 목걸이 = 주황 알
    const amber = bt === 3
    g.beginPath()
    if (amber) g.ellipse(32, 46, 10, 12, 0, 0, Math.PI * 2)
    else {
      g.moveTo(32, 34)
      g.quadraticCurveTo(44, 48, 32, 58)
      g.quadraticCurveTo(20, 48, 32, 34)
    }
    g.fillStyle = amber ? metal(g, 34, 58, '#ffe0a0', '#e88a1a', '#8a4a06') : metal(g, 34, 58, '#e6f4ff', '#6aaae8', '#1e4a8a')
    g.fill()
    outline(g, 1.8)
    g.beginPath()
    g.ellipse(29, 42, 2.5, 4, -0.3, 0, Math.PI * 2)
    g.fillStyle = 'rgba(255,255,255,0.7)'
    g.fill()
  }
  shadow(g)
}
