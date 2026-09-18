import { describe, expect, it } from 'vitest'
import { YAW, moveDirFromScreen } from '../src/render3d/camera'

describe('카메라 기준 이동', () => {
  it('요 45°: 화면 위(W)는 월드 (-1,-1), 오른쪽(D)은 (1,-1), 대각선은 축 방향', () => {
    expect(YAW).toBeCloseTo(Math.PI / 4)
    expect(moveDirFromScreen(0, -1)).toEqual({ mx: -1, my: -1 })
    expect(moveDirFromScreen(1, 0)).toEqual({ mx: 1, my: -1 })
    expect(moveDirFromScreen(0, 1)).toEqual({ mx: 1, my: 1 })
    expect(moveDirFromScreen(-1, 0)).toEqual({ mx: -1, my: 1 })
    expect(moveDirFromScreen(1, -1)).toEqual({ mx: 0, my: -1 })
    expect(moveDirFromScreen(-1, -1)).toEqual({ mx: -1, my: 0 })
    expect(moveDirFromScreen(1, 1)).toEqual({ mx: 1, my: 0 })
    expect(moveDirFromScreen(-1, 1)).toEqual({ mx: 0, my: 1 })
    expect(moveDirFromScreen(0, 0)).toEqual({ mx: 0, my: 0 })
  })

  it('8방향 입력이 8방향으로 일대일 대응한다', () => {
    const seen = new Set<string>()
    for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) {
      if (sx === 0 && sy === 0) continue
      const { mx, my } = moveDirFromScreen(sx, sy)
      expect(mx !== 0 || my !== 0).toBe(true)
      seen.add(`${mx},${my}`)
    }
    expect(seen.size).toBe(8)
  })
})
