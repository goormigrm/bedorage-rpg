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

  constructor(
    private link: RoomLink,
    readonly delay: number,
    private me: number,
    /** 피어 id → 플레이어 인덱스 */
    private peerIndex: Map<string, number>,
    count: number,
    /** 시작 틱. 재접속으로 경기 도중에 합류하면 0 이 아니다 */
    private startTick = 0,
  ) {
    for (let i = 0; i < count; i++) {
      const m = new Map<number, Input>()
      // 처음 delay 틱은 아직 아무도 입력을 못 보냈으므로 빈 입력으로 채운다
      for (let t = startTick; t < startTick + delay; t++) m.set(t, cloneInput(EMPTY_INPUT))
      this.inputs.push(m)
      this.dropped.push(false)
      this.heard.push(false)
      this.latestOf.push(-1)
      this.bots.push(false)
    }
    link.onInput((buf, from) => this.receive(buf, from))
  }

  /** 틱 t 에서 샘플한 입력을 t+delay 에 배정하고 전송 */
  pushLocal(t: number, input: Input): void {
    const target = t + this.delay
    const mine = this.inputs[this.me]
    if (!mine.has(target)) mine.set(target, cloneInput(input))
    this.send(target)
  }

  /** 내가 보낸 가장 앞선 틱 */
  private latestLocal = -1

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
    const m = this.inputs[idx]
    if (!m.has(target)) m.set(target, cloneInput(input))
    this.link.sendInput(this.pack(idx, target, Math.min(REDUNDANCY, target - this.startTick + 1)))
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
