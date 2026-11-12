// 방송 재미 (2026-11-12 — 치지직 최종 업데이트): 채팅 합창 · 시청자 비석. 둘 다 화면만 바꾼다(판은 그대로) — 여기서는 고르는 규칙만 본다
import { describe, expect, it } from 'vitest'
import { CHORUS_COOL, CHORUS_JOIN, CHORUS_MIN, CHORUS_VOICES, CHORUS_WINDOW, Chorus, TOMB_MAX, Tomb, addTomb, defaultStreamCfg } from '../src/game/stream'

describe('채팅 합창', () => {
  it('서로 다른 시청자 넷이 같은 말을 치면 한 번 — 늘인 글자 · 띄어쓰기는 같은 말', () => {
    const c = new Chorus()
    expect(CHORUS_MIN).toBe(4)
    expect(c.add('가', 'ㅋㅋㅋ', 0)).toBeNull()
    expect(c.add('나', 'ㅋㅋㅋㅋㅋㅋ', 500)).toBeNull()
    expect(c.add('다', 'ㅋ ㅋ', 1000)).toBeNull()
    const got = c.add('라', 'ㅋㅋㅋㅋ', 1500)
    expect(got).toEqual({ text: 'ㅋㅋㅋㅋ', nicks: ['가', '나', '다', '라'] })
  })
  it('한 사람이 거듭 쳐서는 일어나지 않는다 (도배로 못 일으킨다)', () => {
    const c = new Chorus()
    for (let i = 0; i < 20; i++) expect(c.add('도배', '가즈아', i * 100)).toBeNull()
    expect(c.add('둘', '가즈아', 2100)).toBeNull()
    expect(c.add('셋', '가즈아', 2200)).toBeNull()
    expect(c.add('넷', '가즈아', 2300)?.nicks).toEqual(['도배', '둘', '셋', '넷'])
  })
  it('창(6초) 밖의 말은 세지 않는다 · 다른 말끼리는 섞이지 않는다', () => {
    const c = new Chorus()
    c.add('가', '뒤에!', 0)
    c.add('나', '뒤에!', 100)
    c.add('다', '앞에!', 200)
    expect(c.add('라', '뒤에!', 300)).toBeNull()
    expect(c.add('마', '뒤에!', CHORUS_WINDOW + 150)).toBeNull()
  })
  it('일어난 뒤에는 쉰다 — 채팅이 빠른 방송에서 화면이 합창으로 덮이지 않게', () => {
    const c = new Chorus()
    const sing = (t: number) => ['가', '나', '다', '라'].map((n, i) => c.add(n, 'ㅋㅋ', t + i)).pop()
    expect(sing(0)).not.toBeNull()
    expect(sing(1000)).toBeNull()
    expect(sing(CHORUS_COOL + 100)).not.toBeNull()
  })
  it('일어난 직후(2초) 같은 말을 친 사람은 끼어든다 — 모두 여덟까지 · 같은 사람 · 다른 말 · 늦은 사람은 아니다', () => {
    const c = new Chorus()
    const got: string[] = []
    // 같은 순간 스무 명: 넷째에서 일어나고 뒤의 넷이 끼어든다
    for (let i = 0; i < 20; i++) {
      const r = c.add(`v${i}`, '와', i)
      if (r) got.push(...r.nicks)
      if (r && i > 3) expect(r.more).toBe(true)
    }
    expect(got).toEqual(['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'])
    expect(got.length).toBe(CHORUS_VOICES)
    const d = new Chorus()
    ;['가', '나', '다', '라'].forEach((n) => d.add(n, '와', 0))
    expect(d.add('가', '와', 100)).toBeNull()
    expect(d.add('마', '오', 100)).toBeNull()
    expect(d.add('마', '와 와', 100)).toEqual({ text: '와 와', nicks: ['마'], more: true })
    expect(d.add('바', '와', CHORUS_JOIN + 1)).toBeNull()
  })
  it('처음부터 켜져 있다 (방송인이 설정하지 않아도)', () => {
    expect(defaultStreamCfg().chorus).toBe(true)
  })
})

describe('시청자 비석', () => {
  it('한 지역에 여덟까지 — 넘으면 오래된 것부터 사라진다', () => {
    const list: Tomb[] = []
    for (let i = 0; i < TOMB_MAX + 3; i++) addTomb(list, { x: i * 100, y: 0, kind: 'rip', nick: `v${i}` })
    expect(list.length).toBe(TOMB_MAX)
    expect(list[0].nick).toBe('v3')
  })
  it('같은 자리(한 칸 안)에 또 세우면 갈아 끼운다 — 글씨가 겹치지 않게', () => {
    const list: Tomb[] = []
    addTomb(list, { x: 100, y: 100, kind: 'rip', nick: '가', say: '살려줘' })
    addTomb(list, { x: 110, y: 105, kind: 'win', nick: '나', who: '철면란' })
    expect(list).toEqual([{ x: 110, y: 105, kind: 'win', nick: '나', who: '철면란' }])
  })
})
