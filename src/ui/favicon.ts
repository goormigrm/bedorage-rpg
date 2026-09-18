// 탭 아이콘을 **게임 안의 철면덕 초상**(드로잉 코드)으로 바꾼다.
// public/favicon.svg 는 JS 가 뜨기 전에 보이는 대체용이고, 페이지가 뜨면 이걸로 갈아 끼운다.
// (2026-09-05 — 손으로 그린 SVG 는 "뭔지 잘 안 보인다" 는 말이 나와, 로비에 나오는 그 얼굴을 그대로 쓴다)

import { CHARACTERS } from '../core/characters'
import { drawPortrait } from '../render/character'

export function setFavicon(): void {
  try {
    const size = 64
    const face = document.createElement('canvas')
    // drawPortrait 는 clientWidth(없으면 64)에 dpr 을 곱해 그린다
    drawPortrait(face, CHARACTERS.cheolmyeon)
    const out = document.createElement('canvas')
    out.width = size
    out.height = size
    const ctx = out.getContext('2d')!
    // 남색 둥근 판 + 금테 (로비 톤)
    const r = 14
    ctx.beginPath()
    ctx.moveTo(r, 1)
    ctx.arcTo(size - 1, 1, size - 1, size - 1, r)
    ctx.arcTo(size - 1, size - 1, 1, size - 1, r)
    ctx.arcTo(1, size - 1, 1, 1, r)
    ctx.arcTo(1, 1, size - 1, 1, r)
    ctx.closePath()
    ctx.fillStyle = '#0d1117'
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = '#e3b341'
    ctx.stroke()
    // 초상은 얼굴이 가운데 위쪽에 작게 그려지므로 키워서 판에 꽉 채운다
    const k = 1.42
    const w = size * k
    ctx.drawImage(face, (size - w) / 2, (size - w) / 2 + size * 0.16, w, w)
    const url = out.toDataURL('image/png')
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.type = 'image/png'
    link.href = url
  } catch {
    /* 캔버스가 안 되는 환경이면 SVG 그대로 */
  }
}
