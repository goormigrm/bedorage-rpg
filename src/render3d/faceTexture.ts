// 달걀형 몸통(구 기반) 한 장짜리 텍스처: 위쪽은 피부 + 이목구비, 아래쪽은 셔츠/겉옷/넥타이/바지.
// 구의 등장방형 UV 를 그대로 쓴다: u=0.25 가 정면(+z), v=0 이 정수리.
// 이목구비는 2D 캐리커처(render/character.ts drawHead, featuresOnly)를 정면 영역에 그린다.

import * as THREE from 'three'
import { CharacterDef } from '../core/characters'
import { drawHead } from '../render/character'

const cache = new Map<string, THREE.CanvasTexture>()

const W = 1024
const H = 512
/** 정면 중심 u */
const FRONT_U = 0.25
/** 얼굴 중심 v (정수리 0 → 바닥 1) */
const FACE_V = 0.34
/** 옷깃: 앞은 이 v 까지 내려오고 뒤는 조금 높다 */
const COLLAR_FRONT_V = 0.7
const COLLAR_BACK_V = 0.58
/** 바지 띠 시작 v */
const PANTS_V = 0.88
const OUTLINE = '#2b2412'

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0')
}

function collarY(u: number): number {
  const k = (1 + Math.cos((u - FRONT_U) * Math.PI * 2)) / 2 // 정면 1, 뒤 0
  return H * (COLLAR_BACK_V + (COLLAR_FRONT_V - COLLAR_BACK_V) * k)
}

/** V넥: 정면 가운데가 아래로 뾰족하게 파인 옷깃 (u 는 0..1) */
function vNeckY(u: number): number {
  const d = Math.abs(((u - FRONT_U + 1.5) % 1) - 0.5) // 정면에서의 u 거리 0..0.5
  const base = collarY(u)
  const w = 0.075
  if (d >= w) return base
  return base + H * 0.11 * (1 - d / w)
}

/** 옷깃 아래 영역 경로 (u 0..1 전체, 아래는 바닥까지) */
function clothPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath()
  ctx.moveTo(0, collarY(0))
  for (let x = 1; x <= W; x += 8) ctx.lineTo(x, collarY(x / W))
  ctx.lineTo(W, H)
  ctx.lineTo(0, H)
  ctx.closePath()
}

export function bodyTexture(def: CharacterDef): THREE.CanvasTexture {
  const key = `body:${def.id}`
  const hit = cache.get(key)
  if (hit) return hit
  const L = def.look
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const vneck = L.neck === 'v'
  const collar = vneck ? vNeckY : collarY

  // 피부
  ctx.fillStyle = hex(L.skin)
  ctx.fillRect(0, 0, W, H)

  // V넥 속옷: 옷깃(둥근 선) 아래는 먼저 속옷 색으로 채우고, 그 위에 V 자로 파인 겉옷을 덮는다
  if (vneck && L.undershirt !== undefined) {
    ctx.fillStyle = hex(L.undershirt)
    clothPath(ctx)
    ctx.fill()
  }

  // 옷 (셔츠 또는 겉옷)
  const clothColor = L.coat !== undefined ? L.coat : L.shirt
  ctx.fillStyle = hex(clothColor)
  ctx.beginPath()
  ctx.moveTo(0, collar(0))
  for (let x = 1; x <= W; x += 4) ctx.lineTo(x, collar(x / W))
  ctx.lineTo(W, H)
  ctx.lineTo(0, H)
  ctx.closePath()
  ctx.fill()
  if (L.coat !== undefined) {
    // 겉옷 물방울
    if (L.coatDots !== undefined) {
      ctx.save()
      clothPath(ctx)
      ctx.clip()
      ctx.fillStyle = hex(L.coatDots)
      const step = 34
      for (let y = H * 0.5; y < H; y += step) {
        const off = Math.round((y - H * 0.5) / step) % 2 === 1 ? step / 2 : 0
        for (let x = 0; x < W; x += step) {
          ctx.beginPath()
          ctx.arc(x + off, y, 6, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.restore()
    }
    // 앞섶: 셔츠 색 띠 + 깃
    const cx = W * FRONT_U
    const top = collarY(FRONT_U)
    ctx.fillStyle = hex(L.shirt)
    ctx.beginPath()
    ctx.moveTo(cx - 34, top - 4)
    ctx.lineTo(cx + 34, top - 4)
    ctx.lineTo(cx + 26, H)
    ctx.lineTo(cx - 26, H)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 3
    ctx.stroke()
    // 깃 (양쪽 삼각)
    ctx.fillStyle = hex(clothColor)
    for (const d of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + d * 34, top - 6)
      ctx.lineTo(cx + d * 70, top + 26)
      ctx.lineTo(cx + d * 30, top + 58)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }
  // 가로 줄무늬 (스웨터)
  if (L.stripe !== undefined) {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(0, collar(0))
    for (let x = 1; x <= W; x += 4) ctx.lineTo(x, collar(x / W))
    ctx.lineTo(W, H)
    ctx.lineTo(0, H)
    ctx.closePath()
    ctx.clip()
    ctx.fillStyle = hex(L.stripe)
    let band = 0
    for (let y = H * 0.55; y < H; y += 34) {
      if (band++ % 2 === 0) ctx.fillRect(0, y, W, 17)
    }
    ctx.restore()
  }
  // 앞치마 (앞면에만)
  if (L.apron !== undefined) {
    const ax = W * FRONT_U
    const ay = collarY(FRONT_U)
    ctx.fillStyle = hex(L.apron)
    ctx.beginPath()
    ctx.moveTo(ax - 62, ay + 6)
    ctx.lineTo(ax + 62, ay + 6)
    ctx.lineTo(ax + 104, ay + 62)
    ctx.lineTo(ax + 104, H)
    ctx.lineTo(ax - 104, H)
    ctx.lineTo(ax - 104, ay + 62)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 3
    ctx.stroke()
    // 목끈
    ctx.lineWidth = 7
    ctx.strokeStyle = hex(L.apron)
    for (const d of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(ax + d * 54, ay + 8)
      ctx.lineTo(ax + d * 84, ay - 40)
      ctx.stroke()
    }
    // 작은 뱃지들
    const badges = ['#d8443c', '#e8b53a', '#3fb950', '#5aa9ff']
    badges.forEach((col, i) => {
      ctx.fillStyle = col
      ctx.fillRect(ax - 86 + i * 26, ay + 118, 16, 16)
    })
  }
  // 옷깃 선
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, collar(0))
  for (let x = 1; x <= W; x += 4) ctx.lineTo(x, collar(x / W))
  ctx.stroke()
  // 명찰 (가슴 왼쪽 = 보는 사람 기준 오른쪽 아래)
  if (L.badge !== undefined) {
    const bx = W * FRONT_U + 74
    const by = collarY(FRONT_U) + 70
    ctx.fillStyle = hex(L.badge)
    ctx.fillRect(bx - 26, by - 9, 52, 18)
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 2
    ctx.strokeRect(bx - 26, by - 9, 52, 18)
    ctx.fillStyle = '#5a4a1a'
    ctx.fillRect(bx - 18, by - 2, 36, 3)
  }
  // 바지 띠
  ctx.fillStyle = hex(L.pants ?? 0x34405a)
  ctx.fillRect(0, H * PANTS_V, W, H * (1 - PANTS_V))
  ctx.beginPath()
  ctx.moveTo(0, H * PANTS_V)
  ctx.lineTo(W, H * PANTS_V)
  ctx.stroke()
  // 넥타이 / 나비넥타이
  const cx = W * FRONT_U
  const top = collarY(FRONT_U)
  if (L.tie !== undefined) {
    ctx.fillStyle = hex(L.tie)
    ctx.beginPath()
    ctx.moveTo(cx - 12, top - 2)
    ctx.lineTo(cx + 12, top - 2)
    ctx.lineTo(cx + 9, top + 70)
    ctx.lineTo(cx, top + 84)
    ctx.lineTo(cx - 9, top + 70)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  if (L.bowTie !== undefined) {
    ctx.fillStyle = hex(L.bowTie)
    for (const d of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + d * 34, top - 18)
      ctx.lineTo(cx, top + 2)
      ctx.lineTo(cx + d * 34, top + 22)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    ctx.fillStyle = '#333333'
    ctx.beginPath()
    ctx.arc(cx, top + 2, 8, 0, Math.PI * 2)
    ctx.fill()
  }

  // 이목구비 (정면 중심). 2D 머리 반지름 R 이 텍스처에서 FACE_R px 가 되도록
  const R = 12.5 * L.headScale
  const FACE_R = 150
  const s = FACE_R / R
  const hy = -8 - R
  ctx.save()
  ctx.translate(W * FRONT_U, H * FACE_V - hy * s)
  ctx.scale(s, s)
  drawHead(ctx, def, { facing: 0, frontal: true, featuresOnly: true, sx: 1, sy: 1, walk: 0, moving: false, flash: 0, t: 0 })
  ctx.restore()

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  cache.set(key, tex)
  return tex
}

/** 모자 라벨 같은 짧은 글자 텍스처 (투명 배경 없이 바탕색) */
export function labelTexture(text: string, bg: number, fg: number): THREE.CanvasTexture {
  const key = `label:${text}:${bg}:${fg}`
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const ctx = c.getContext('2d')!
  ctx.fillStyle = hex(bg)
  ctx.fillRect(0, 0, 256, 128)
  ctx.fillStyle = hex(fg)
  ctx.font = '700 84px "IBM Plex Sans KR", "Malgun Gothic", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 70)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set(key, tex)
  return tex
}

/** 텍스처 안에서 얼굴 중심 v (몸통 세로 위치 계산용) */
export const BODY_FACE_V = FACE_V
