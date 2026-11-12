// 결정론적 락스텝 입력 버퍼 (2~4인). 매 틱 내 입력을 미래 틱(t + delay)에 넣고 모두에게 보낸다.
// 최근 8틱 입력을 한 패킷에 중복 전송해 손실을 흡수한다. 누구 하나라도 입력이 없는 틱은 진행하지 않는다(스톨).
// 이탈한 사람은 drop() 으로 표시하면 그 사람 입력은 빈 입력으로 간주한다.
// **봇 자리**(P2P 방을 봇으로 채움, 2026-09-05): 호스트(0번)가 봇 입력을 만들어 자리 패킷(첫 바이트 0xFF + 자리 번호)으로
// 보낸다. 모두가 같은 입력으로 같은 봇을 돌리므로 결정론이 지켜지고, 리싱크가 있어도 봇 기억이 어긋날 일이 없다
// (각자 봇을 굴리면 리싱크 뒤 봇의 기억(표적·조준)이 피어마다 달라져 다시 어긋난다).

import { EMPTY_INPUT, INPUT_BYTES, Input, cloneInput, readInput, writeInput } from '../core/input'
import { RoomLink } from './room'

const REDUNDANCY = 8
/** 내 입력은 이만큼(30초) 남겨 둔다 — 늦게 붙는 피어에게 몰아 보내기 위해 */
const KEEP_MINE = 1800

const wireBuf = new DataView(new ArrayBuffer(INPUT_BYTES))
/**
 * 입력을 **전선에 실리는 모양 그대로** (2026-11-12 버그 검사): 내 판은 내가 만든 입력을, 남의 판은 10바이트로 줄인 입력을 쓴다 —
 * 바이트에 안 담기는 값(명령 인자 255 초과 · 조준 1023 초과)이 있으면 내 판만 달라져 어긋난다(줍기 명령의 전리품 번호가 그랬다).
 * 내 것도 한 번 싣고 풀어서 쓴다
 */
export function wireInput(i: Input): Input {
  writeInput(wireBuf, 0, i)
  return readInput(wireBuf, 0)
}

/**
 * 핑에 맞는 입력 지연(틱). 내 입력은 상대가 그 틱을 돌기 전에 닿아야 한다 — 한쪽 길(왕복의 절반)에 여유 3틱(흔들림 · 16ms 타이머 어긋남).
 * 방에 나 혼자면(손님을 기다리는 방장) 기다릴 상대가 없으니 가장 짧게. 상한 12틱(0.2초) — 그보다 느린 망은 판이 느려지는 쪽이 낫다(조작이 너무 늦다)
 */
export function wantDelay(peers: number, rttMs: number): number {
  if (peers <= 0) return 2
  return Math.max(4, Math.min(12, Math.ceil(rttMs / 2 / 16.7) + 3))
}

export class Lockstep {
  /** 플레이어별 틱 → 입력 */
  private inputs: Map<number, Input>[] = []
  private dropped: boolean[] = []
  /** 이 자리에서 패킷을 하나라도 받았는가 (난입자를 판에 넣기 전에 회선이 진짜 뚫렸는지 본다) */
  private heard: boolean[] = []
  /** 자리별로 받은 가장 앞선 틱 (난입자가 판을 따라잡았는지 본다) */
  private latestOf: number[] = []
  /** 봇 자리 — 호스트가 입력을 대신 보낸다 */
  private bots: boolean[] = []
  latestRemoteTick = -1

  /** 입력 지연(틱) — 게임 중에도 핑에 맞춰 바뀐다 (setDelay). 사람마다 달라도 된다: 저마다 "내 입력을 몇 틱 뒤에 쓸지" 일 뿐이다 */
  delay: number

  constructor(
    private link: RoomLink,
    delay: number,
    private me: number,
    /** 피어 id → 플레이어 인덱스 */
    private peerIndex: Map<string, number>,
    count: number,
    /** 시작 틱. 재접속으로 경기 도중에 합류하면 0 이 아니다 */
    private startTick = 0,
  ) {
    this.delay = delay
    for (let i = 0; i < count; i++) {
      const m = new Map<number, Input>()
      // 처음 delay 틱은 아직 아무도 입력을 못 보냈으므로 빈 입력으로 채운다 — **판을 처음부터 같이 시작할 때만**.
      // 도중에 들어온 사람(난입 · startTick > 0)이 이렇게 채우면, 그 틱에 남들이 실제로 누른 입력(곧 몰아 받는다)을 버리고 빈 입력으로
      // 돌려 들어오자마자 판이 어긋났다 (2026-11-12 멀티 계측: 방장이 걷는 중에 난입하면 리싱크 1번 — 판 200 KB 를 한 번 더 받았다)
      if (startTick === 0) for (let t = 0; t < delay; t++) m.set(t, cloneInput(EMPTY_INPUT))
      this.inputs.push(m)
      this.dropped.push(false)
      this.heard.push(false)
      this.latestOf.push(-1)
      this.bots.push(false)
    }
    link.onInput((buf, from) => this.receive(buf, from))
  }

  /** 틱 t 에서 샘플한 입력을 t+delay 에 배정하고 전송. 그 틱에 이미 입력이 있으면(상대 입력을 기다리며 같은 틱을 다시 돎) 버리고 false */
  pushLocal(t: number, input: Input): boolean {
    const target = t + this.delay
    const fresh = this.put(this.me, target, input)
    // 지연을 막 줄였으면 target 이 이미 보낸 틱보다 뒤일 수 있다 — 보내는 것은 늘 가장 앞선 틱부터 (겹쳐 싣는 창이 뒤로 가지 않게)
    this.send(Math.max(target, this.latestLocal))
    return fresh
  }

  /**
   * 자리 idx 의 target 틱에 입력을 넣는다 (이미 있으면 false). 지연을 한 틱 늘린 직후에는 target 앞 틱이 비어 있다 —
   * 같은 이동 · 버튼으로 메운다(명령은 한 번만 가야 하니 뺀다). 비워 두면 그 틱에서 모두가 영영 기다린다
   */
  private put(idx: number, target: number, input: Input): boolean {
    const m = this.inputs[idx]
    if (m.has(target)) return false
    const w = wireInput(input)
    let g = target - 1
    while (g > target - REDUNDANCY && g >= this.startTick && !m.has(g)) g--
    if (m.has(g)) for (let k = g + 1; k < target; k++) m.set(k, { ...w, cmd: 0, arg: 0 })
    m.set(target, w)
    return true
  }

  /**
   * 입력 지연을 n 쪽으로 바꾼다 (세션이 핑을 보고 부른다). 올릴 때는 한 번에(겹쳐 싣는 창 안에서 — 건너뛴 틱은 put 이 메운다),
   * 내릴 때는 한 틱씩: 다음 입력 하나가 이미 보낸 틱과 겹쳐 버려진다(pushLocal 이 false — 세션이 명령을 되돌려 넣는다).
   * 판의 결과는 "어느 틱에 어떤 입력" 뿐이라 모두에게 같다 — 따로 알릴 것이 없다
   */
  setDelay(n: number): void {
    const want = Math.max(1, Math.min(30, Math.round(n)))
    this.delay = want > this.delay ? Math.min(want, this.delay + REDUNDANCY - 2) : Math.max(want, this.delay - 1)
  }

  /** 내가 보낸 가장 앞선 틱 · 봇 자리마다 보낸 가장 앞선 틱 */
  private latestLocal = -1
  private latestBot: number[] = []

  private send(latest: number): void {
    this.latestLocal = Math.max(this.latestLocal, latest)
    this.link.sendInput(this.pack(this.me, latest, Math.min(REDUNDANCY, latest - this.startTick + 1)))
  }

  /** 이 자리는 봇이다 (호스트가 입력을 대신 보낸다). 호스트·게스트 모두 표시해 둔다 */
  setBot(idx: number): void {
    if (idx >= 0 && idx < this.bots.length) this.bots[idx] = true
  }

  isBot(idx: number): boolean {
    return this.bots[idx] === true
  }

  /** 호스트: 봇 자리 idx 의 틱 t 입력을 t+delay 에 배정하고 자리 패킷으로 전송 */
  pushBot(idx: number, t: number, input: Input): void {
    if (!this.bots[idx] || this.me !== 0) return
    const target = t + this.delay
    this.put(idx, target, input)
    const latest = Math.max(target, this.latestBot[idx] ?? -1)
    this.latestBot[idx] = latest
    this.link.sendInput(this.pack(idx, latest, Math.min(REDUNDANCY, latest - this.startTick + 1)))
  }

  /**
   * latest 부터 거슬러 count 틱의 입력을 한 패킷으로.
   * 내 자리는 [latest u32][count u8][입력…], 봇 자리는 앞에 [0xFF][자리 u8] 를 붙인다
   * (틱은 2^24 안이라 첫 바이트가 0xFF 인 일반 패킷은 없다)
   */
  private pack(idx: number, latest: number, count: number): Uint8Array {
    const src = this.inputs[idx]
    const slot = idx !== this.me
    const off = slot ? 2 : 0
    const buf = new ArrayBuffer(off + 5 + count * INPUT_BYTES)
    const v = new DataView(buf)
    if (slot) {
      v.setUint8(0, 0xff)
      v.setUint8(1, idx)
    }
    v.setUint32(off, latest)
    v.setUint8(off + 4, count)
    for (let i = 0; i < count; i++) {
      const inp = src.get(latest - i) ?? EMPTY_INPUT
      writeInput(v, off + 5 + i * INPUT_BYTES, inp)
    }
    return new Uint8Array(buf)
  }

  /**
   * 늦게 연결된 피어에게 지난 입력을 전부 몰아 보낸다.
   * 평소에는 최근 8틱만 겹쳐 보내므로, 난입자와 어떤 게스트의 연결이 8틱 넘게 늦으면
   * 그 사이 틱이 영영 비어 둘 다 멈춘다(실제 망에서는 피어마다 연결되는 시점이 다르다).
   * 메시가 완성되는 순간 이걸 부르면 그 구멍이 메워진다. 패킷 한 개에 최대 255틱.
   */
  resendTo(peerId: string): void {
    if (this.latestLocal < 0) return
    const from = Math.max(this.startTick, this.latestLocal - KEEP_MINE + 1)
    // 내 자리 + (호스트면) 봇 자리들
    const slots = [this.me]
    if (this.me === 0) for (let i = 0; i < this.bots.length; i++) if (this.bots[i]) slots.push(i)
    for (const idx of slots) {
      let hi = this.latestLocal
      while (hi >= from) {
        const count = Math.min(255, hi - from + 1)
        this.link.sendInput(this.pack(idx, hi, count), peerId)
        hi -= count
      }
    }
  }

  private receive(raw: Uint8Array | ArrayBuffer, from: string): void {
    const sender = this.peerIndex.get(from)
    if (sender === undefined || sender === this.me) return
    const buf = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
    if (buf.byteLength < 5) return
    let idx = sender
    let off = 0
    // 봇 자리 패킷: 호스트(0번)가 보낸 것만, 봇으로 표시된 자리만 받는다
    if (buf[0] === 0xff) {
      if (sender !== 0 || buf.byteLength < 7) return
      idx = buf[1]
      if (idx === this.me || !this.bots[idx]) return
      off = 2
    }
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    const latest = v.getUint32(off)
    const count = v.getUint8(off + 4)
    this.heard[idx] = true
    if (latest > this.latestOf[idx]) this.latestOf[idx] = latest
    const m = this.inputs[idx]
    for (let i = 0; i < count; i++) {
      const t = latest - i
      if (t < 0 || m.has(t)) continue
      m.set(t, readInput(v, off + 5 + i * INPUT_BYTES))
    }
    if (latest > this.latestRemoteTick) this.latestRemoteTick = latest
  }

  /** 모두의 입력이 있는가 (이탈자는 제외) */
  hasAll(t: number): boolean {
    for (let i = 0; i < this.inputs.length; i++) {
      if (this.dropped[i]) continue
      if (!this.inputs[i].has(t)) return false
    }
    return true
  }

  /** 틱 t 의 입력이 아직 없는 자리들 (계측 · 진단용 — `__bd.waitingOn()`) */
  missing(t: number): number[] {
    const out: number[] = []
    for (let i = 0; i < this.inputs.length; i++) if (!this.dropped[i] && !this.inputs[i].has(t)) out.push(i)
    return out
  }

  /** 틱 t 의 입력을 플레이어 순서대로 */
  get(t: number): Input[] {
    return this.inputs.map((m, i) => (this.dropped[i] ? EMPTY_INPUT : (m.get(t) ?? EMPTY_INPUT)))
  }

  /** 이탈: 이후 그 사람 입력은 기다리지 않는다 */
  drop(idx: number): void {
    if (idx >= 0 && idx < this.dropped.length) this.dropped[idx] = true
  }

  /**
   * 재접속: fromTick 부터 그 사람 입력을 다시 기다린다.
   * fromTick 이전은 빈 입력으로 메워, 이미 지나간 틱에서 멈추지 않게 한다.
   */
  rejoin(idx: number, fromTick: number): void {
    if (idx < 0 || idx >= this.dropped.length) return
    this.dropped[idx] = false
    const m = this.inputs[idx]
    for (let t = Math.max(0, fromTick - 600); t < fromTick; t++) if (!m.has(t)) m.set(t, cloneInput(EMPTY_INPUT))
  }

  isDropped(idx: number): boolean {
    return this.dropped[idx] === true
  }

  heardFrom(idx: number): boolean {
    return this.heard[idx] === true
  }

  /** 그 자리에서 받은 가장 앞선 틱 (-1 = 아직 없음) */
  latestFrom(idx: number): number {
    return this.latestOf[idx] ?? -1
  }

  /** 그 자리에서 받은 가장 앞선 입력 (없으면 undefined) — 방장이 난입자의 화면이 아직 덮여 있는지(BTN_LOADING) 본다 */
  latestInput(idx: number): Input | undefined {
    return this.inputs[idx]?.get(this.latestOf[idx] ?? -1)
  }

  /**
   * 난입자를 fromTick 부터 판에 넣는다. rejoin 과 달리 **fromTick 이전은 전부 빈 입력으로 덮어쓴다** —
   * 난입자는 관전하는 동안에도 입력을 보내고 있었는데, 그걸 누구는 쓰고 누구는 안 쓰면 판이 어긋난다
   * (리싱크가 지난 틱을 다시 돌릴 때 특히). 모두가 같은 틱부터, 그 전은 모두 빈 입력.
   */
  activate(idx: number, fromTick: number): void {
    if (idx < 0 || idx >= this.dropped.length) return
    this.dropped[idx] = false
    const m = this.inputs[idx]
    for (const k of [...m.keys()]) if (k < fromTick) m.delete(k)
    for (let t = Math.max(0, fromTick - 600); t < fromTick; t++) m.set(t, cloneInput(EMPTY_INPUT))
  }

  /** 오래된 입력 정리 (남의 것은 리싱크용으로 600틱, 내 것은 몰아 보내기용으로 KEEP_MINE 틱) */
  prune(currentTick: number): void {
    for (let i = 0; i < this.inputs.length; i++) {
      const cut = currentTick - (i === this.me || this.bots[i] ? KEEP_MINE : 600)
      if (cut <= 0) continue
      const m = this.inputs[i]
      for (const k of m.keys()) if (k < cut) m.delete(k)
    }
  }
}
