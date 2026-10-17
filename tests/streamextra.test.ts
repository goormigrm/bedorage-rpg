// 방송 개선 ① ② ⑧ (2026-10-17 — 사용자: "남은 작업은 권고대로 결정하고 계속 진행")
import { describe, expect, it } from 'vitest'
import { DONATE_EVENTS, RAGE_SLOT, effectSlot, DON_DARK, DON_SHAKE } from '../src/core/donate'
import { defaultStreamCfg, eventByName, eventForAmount, isBlocked, scaleAmounts } from '../src/game/stream'

const key = (e?: { key: string }) => e?.key
const cfg = defaultStreamCfg()

describe('후원 글 !이름 (방송 개선 ①)', () => {
  it('금액이 그 이벤트 값 이상이면 그 이벤트 — 띄어쓰기는 가리지 않는다', () => {
    expect(key(eventByName('!좀비떼', 1000, cfg))).toBe('horde')
    expect(key(eventByName('가즈아 ! 시야 축소 ㅋㅋ', 5000, cfg))).toBe('dark')
    // 금액표대로라면 5천 원은 정예 무리
    expect(key(eventForAmount(5000, cfg, () => 0))).toBe('elite')
  })
  it('금액이 모자라거나 이름이 없으면 고르지 않는다 (금액표대로)', () => {
    expect(eventByName('!막보스', 1000, cfg)).toBeUndefined()
    expect(eventByName('막 보스 가자', 50000, cfg)).toBeUndefined()
    expect(eventByName('!없는이벤트', 50000, cfg)).toBeUndefined()
  })
  it('이름이 둘이면 그중 비싼 것 · 꺼 둔(0원) 이벤트는 고를 수 없다', () => {
    expect(key(eventByName('!좀비떼 !화면흔들림', 2000, cfg))).toBe('shake')
    const off = { ...cfg, amounts: cfg.amounts.map((a, i) => (DONATE_EVENTS[i].key === 'horde' ? 0 : a)) }
    expect(eventByName('!좀비떼', 1000, off)).toBeUndefined()
  })
})

describe('시청자 차단 (방송 개선 ②)', () => {
  it('닉네임 그대로 — 대소문자 · 띄어쓰기는 가리지 않는다', () => {
    const c = { ...cfg, blocked: ['악성 시청자', 'Troll'] }
    expect(isBlocked('악성시청자', c)).toBe(true)
    expect(isBlocked('troll', c)).toBe(true)
    expect(isBlocked('착한 시청자', c)).toBe(false)
    expect(isBlocked('troll', cfg)).toBe(false)
  })
})

describe('금액표 한꺼번에 ×0.5 · ×2 (방송 개선 ⑧)', () => {
  it('500원 단위 · 켠 칸은 500원 아래로 안 내려간다 · 끈 칸(0)은 그대로', () => {
    expect(scaleAmounts([1000, 0, 3000, 500], 0.5)).toEqual([500, 0, 1500, 500])
    expect(scaleAmounts([1000, 0, 3000], 2)).toEqual([2000, 0, 6000])
  })
})

describe('쉬는 시간의 칸 (방송 개선 ⑥)', () => {
  it('사람에게 거는 효과는 그 칸 · 지옥문은 암흑 칸 · 광폭화는 따로 · 소환은 없음', () => {
    expect(effectSlot('shake')).toBe(DON_SHAKE)
    expect(effectSlot('hell')).toBe(DON_DARK)
    expect(effectSlot('rage')).toBe(RAGE_SLOT)
    expect(effectSlot('horde')).toBe(-1)
  })
  it('새 설정은 처음엔 꺼져 있다 (지금까지와 같게)', () => {
    expect(cfg.effectGap).toBe(0)
    expect(cfg.duckSec).toBe(0)
    expect(cfg.donSfx).toBe(true)
    expect(cfg.seatNote).toBe(false)
    expect(cfg.blocked).toEqual([])
  })
})
