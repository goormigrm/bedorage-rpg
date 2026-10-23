// 체력 띠 잔상 (2026-10-24): 깎인 몫이 잠깐 서 있다가 줄어든다 · 회복은 잔상 없음 · 번쩍임은 맞은 순간만
import { describe, expect, it } from 'vitest'
import { hpGhost } from '../src/render/hpGhost'

describe('체력 띠 잔상', () => {
  it('맞으면 잔상이 서 있다가 줄어 채움에 닿는다', () => {
    expect(hpGhost('a', 1, 0).ghost).toBe(1)
    const hit = hpGhost('a', 0.6, 16)
    expect(hit.ghost).toBe(1)
    expect(hit.flash).toBe(1)
    // 0.3초 뒤에도 그대로 (번쩍임은 끝)
    let r = hpGhost('a', 0.6, 300)
    expect(r.ghost).toBe(1)
    expect(r.flash).toBe(0)
    // 그 뒤로 줄어 1.5초 안에 닿는다
    for (let t = 316; t <= 1800; t += 16) r = hpGhost('a', 0.6, t)
    expect(r.ghost).toBeCloseTo(0.6, 3)
  })

  it('회복은 잔상 없이 바로 · 줄어드는 중에 또 맞으면 다시 선다', () => {
    hpGhost('b', 0.5, 0)
    expect(hpGhost('b', 0.8, 16).ghost).toBe(0.8)
    hpGhost('b', 0.4, 32)
    const mid = hpGhost('b', 0.4, 500).ghost
    expect(mid).toBeLessThan(0.8)
    expect(mid).toBeGreaterThan(0.4)
    // 줄던 자리에서 다시 선다 (0.35초 동안 그대로)
    const at = hpGhost('b', 0.3, 516).ghost
    expect(hpGhost('b', 0.3, 820).ghost).toBe(at)
    expect(at).toBeGreaterThan(0.35)
  })
})
