import { describe, expect, it } from 'vitest'
import { BASE_H, MAX_VIEW_H, VIEW_H, VIEW_K, VIEW_W, setViewSize } from '../src/render/hud'

// 논리 해상도 (2026-09-23 사용자: "인게임 해상도를 더 높이고 HUD 를 전체적으로 작게")
describe('논리 해상도는 창 높이를 따른다', () => {
  it('1080p 창에서 HUD 크기 보통이면 논리 1px = 화면 1px (전에는 720 고정이라 1.5 배로 커 보였다)', () => {
    setViewSize(1920, 1080, 1)
    expect(VIEW_H).toBe(1080)
    expect(VIEW_W).toBe(1920)
    expect(VIEW_K).toBe(1080 / BASE_H)
  })

  it('작은 창 · 폰(0)은 720 아래로 내려가지 않는다 — 폰 터치 단추 크기 그대로', () => {
    setViewSize(800, 450, 1)
    expect(VIEW_H).toBe(720)
    setViewSize(2560, 1440, 0)
    expect(VIEW_H).toBe(720)
  })

  it('작게 · 크게 · 상한 · 비율 하한(16:9)', () => {
    setViewSize(1600, 900, 0.85)
    expect(VIEW_H).toBe(1058)
    setViewSize(1600, 900, 1.2)
    expect(VIEW_H).toBe(750)
    setViewSize(3840, 2160, 1)
    expect(VIEW_H).toBe(MAX_VIEW_H)
    setViewSize(1200, 1000, 1) // 4:3 보다 좁아도 폭은 16:9 로
    expect(VIEW_W).toBe(Math.round((VIEW_H * 16) / 9 / 2) * 2)
  })
})
