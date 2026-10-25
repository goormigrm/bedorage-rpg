// 2026-10-25 검토: 구독이 한 번 실패하면 connect() 가 옛 소켓을 끊을 때 그 'disconnect' 처리기가 다시 붙기를 또 걸어
// 5초마다 끊고 붙기를 끝없이 되풀이했다 (socket.io-client 2.5.0 은 붙어 있는 소켓을 끊으면 그 자리에서 'disconnect' 를 낸다)
import { describe, expect, it, vi } from 'vitest'

class FakeSock {
  connected = false
  up = false
  h = new Map<string, ((a?: unknown) => void)[]>()
  on(ev: string, f: (a?: unknown) => void) {
    this.h.set(ev, [...(this.h.get(ev) ?? []), f])
    return this
  }
  emit(ev: string, a?: unknown) {
    for (const f of this.h.get(ev) ?? []) f(a)
  }
  disconnect() {
    if (this.connected) {
      this.connected = false
      this.emit('disconnect', 'io client disconnect')
    }
  }
}
const sockets: FakeSock[] = []
vi.mock('socket.io-client', () => ({
  default: () => {
    const s = new FakeSock()
    sockets.push(s)
    return s
  },
}))

describe('치지직 다시 붙기', () => {
  it('구독이 한 번 실패한 뒤 정상이 되면 소켓을 더 열지 않는다 (끊고 붙기 되풀이 없음)', async () => {
    vi.useFakeTimers()
    const store = new Map<string, string>([['brpg.chzzk.token', JSON.stringify({ accessToken: 'a', refreshToken: 'r' })]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
    vi.stubGlobal('location', { origin: 'x', pathname: '/', search: '' })
    let subFail = true
    vi.stubGlobal('fetch', async (url: string) => {
      const ok = !(url.includes('/subscribe/') && subFail)
      return { ok, status: ok ? 200 : 500, json: async () => ({ content: { url: 'wss://x' }, message: ok ? '' : 'boom' }) }
    })
    const { connect, disconnect } = await import('../src/net/chzzk')
    const up = async (s: FakeSock) => {
      s.up = true
      s.connected = true
      s.emit('SYSTEM', JSON.stringify({ type: 'connected', data: { sessionKey: 'k' } }))
      await vi.advanceTimersByTimeAsync(0)
    }
    await connect()
    await up(sockets[0]) // 구독 둘 다 실패 → 다시 붙기 하나
    subFail = false
    for (let i = 0; i < 60; i++) {
      await vi.advanceTimersByTimeAsync(1000)
      const last = sockets[sockets.length - 1]
      if (!last.up) {
        await up(last)
        for (const t of ['DONATION', 'CHAT']) last.emit('SYSTEM', JSON.stringify({ type: 'subscribed', data: { eventType: t } }))
      }
    }
    // 처음 소켓 + 다시 붙은 소켓 하나뿐
    expect(sockets.length).toBe(2)
    disconnect()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('토큰 갱신이 잠깐 실패(5xx)하면 로그인을 지우지 않는다 · 400 이면 지운다', async () => {
    vi.resetModules()
    const store = new Map<string, string>([['brpg.chzzk.token', JSON.stringify({ accessToken: 'a', refreshToken: 'r' })]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
    vi.stubGlobal('location', { origin: 'x', pathname: '/', search: '' })
    let tokenStatus = 503
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/auth/v1/token')) return { ok: false, status: tokenStatus, json: async () => ({ message: 'busy' }) }
      return { ok: false, status: 401, json: async () => ({}) }
    })
    const { connect, disconnect, hasToken } = await import('../src/net/chzzk')
    await connect()
    expect(hasToken()).toBe(true)
    disconnect()
    tokenStatus = 400
    await connect()
    expect(hasToken()).toBe(false)
    disconnect()
    vi.unstubAllGlobals()
  })
})
