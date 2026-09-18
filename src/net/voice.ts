// 음성 대화 (2026-09-18 사용자: "버튼을 눌러서 4명까지 음성 대화"). 게임은 이미 WebRTC 로 서로 직접 붙어 있으니
// 마이크 스트림을 같은 연결(Trystero addStream)에 얹기만 하면 된다 — 서버·비용 없음.
// 방식 둘 (사용자 추가 요청 — "버튼 눌러서 일시적으로도, 설정에 따라 계속도"):
//   · 눌러서 말하기(ptt): 마이크는 켜 두되 **버튼이나 B 를 누르고 있는 동안만** 소리가 나간다 (트랙 enabled)
//   · 계속 켜기(open): 한 번 켜면 계속 나간다 (B · 버튼으로 켜고 끈다)
// 지금 연결된 사람과 나중에 들어오는 사람 모두에게 내 마이크를 보낸다. 끄면 트랙을 멈추고 거둔다. 방식은 브라우저에 기억한다.
// 받는 쪽은 사람마다 <audio> 하나. 말하는지는 AnalyserNode 로 소리 크기를 재서 파티 창에 표시한다.
// sim·락스텝과 무관하다 (입력 패킷이 아니라 별도의 미디어 트랙).

import { RoomLink } from './room'

interface Remote {
  audio: HTMLAudioElement
  analyser: AnalyserNode | null
  buf: Uint8Array
}

export type VoiceMode = 'ptt' | 'open'

export class Voice {
  private stream: MediaStream | null = null
  /** 방식 (brpg.voice 에 기억) */
  mode: VoiceMode = 'ptt'
  /** 눌러서 말하기: 지금 누르고 있나 */
  private holding = false
  private remotes = new Map<string, Remote>()
  private ctx: AudioContext | null = null
  private mine: { analyser: AnalyserNode; buf: Uint8Array } | null = null
  private busy = false

  constructor(private link: RoomLink) {
    link.onVoice((stream, from) => this.addRemote(stream, from))
    link.onPeerLeave((id) => this.dropRemote(id))
    try {
      this.mode = localStorage.getItem('brpg.voice') === 'open' ? 'open' : 'ptt'
    } catch {
      /* 저장소 없음 */
    }
  }

  /** 마이크를 잡고 있나 */
  get on(): boolean {
    return this.stream !== null
  }

  /** 지금 내 소리가 나가고 있나 */
  get live(): boolean {
    return this.stream !== null && (this.mode === 'open' || this.holding)
  }

  setMode(m: VoiceMode): void {
    this.mode = m
    try {
      localStorage.setItem('brpg.voice', m)
    } catch {
      /* 저장소 없음 */
    }
    this.syncTrack()
  }

  /** 눌러서 말하기: 누름/뗌. 마이크가 아직 없으면 처음 누를 때 권한을 묻는다 */
  async hold(down: boolean): Promise<boolean> {
    this.holding = down
    if (down && !this.stream) await this.toggle()
    this.syncTrack()
    return this.on
  }

  private syncTrack(): void {
    if (!this.stream) return
    const live = this.mode === 'open' || this.holding
    for (const t of this.stream.getAudioTracks()) t.enabled = live
  }

  /** 마이크 켜기/끄기. 켤 때 권한을 묻는다 (거절하면 false) */
  async toggle(): Promise<boolean> {
    if (this.busy) return this.on
    this.busy = true
    try {
      if (this.stream) {
        for (const t of this.stream.getTracks()) t.stop()
        this.link.setVoice(null)
        this.stream = null
        this.mine = null
        return false
      }
      if (!navigator.mediaDevices?.getUserMedia) return false
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      this.stream = s
      this.syncTrack()
      this.link.setVoice(s)
      const an = this.analyse(s)
      if (an) this.mine = { analyser: an, buf: new Uint8Array(an.fftSize) }
      return true
    } catch {
      return false
    } finally {
      this.busy = false
    }
  }

  /** 지금 말하고 있나 (peerId = null 이면 나 — 소리가 나가고 있을 때만) */
  speaking(peerId: string | null): boolean {
    if (peerId === null && !this.live) return false
    const a = peerId === null ? this.mine : this.remotes.get(peerId)
    if (!a || !a.analyser) return false
    a.analyser.getByteTimeDomainData(a.buf as Uint8Array<ArrayBuffer>)
    let peak = 0
    for (let i = 0; i < a.buf.length; i += 4) peak = Math.max(peak, Math.abs(a.buf[i] - 128))
    return peak > 10
  }

  /** 이 사람의 음성을 받고 있나 */
  hears(peerId: string): boolean {
    return this.remotes.has(peerId)
  }

  private audioCtx(): AudioContext | null {
    if (this.ctx) return this.ctx
    try {
      this.ctx = new AudioContext()
    } catch {
      this.ctx = null
    }
    return this.ctx
  }

  private analyse(stream: MediaStream): AnalyserNode | null {
    const ctx = this.audioCtx()
    if (!ctx) return null
    try {
      const src = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser()
      an.fftSize = 256
      src.connect(an)
      return an
    } catch {
      return null
    }
  }

  private addRemote(stream: MediaStream, from: string): void {
    this.dropRemote(from)
    const audio = new Audio()
    audio.srcObject = stream
    audio.autoplay = true
    void audio.play().catch(() => {})
    const analyser = this.analyse(stream)
    this.remotes.set(from, { audio, analyser, buf: new Uint8Array(analyser?.fftSize ?? 32) })
  }

  private dropRemote(id: string): void {
    const r = this.remotes.get(id)
    if (!r) return
    r.audio.pause()
    r.audio.srcObject = null
    this.remotes.delete(id)
  }

  dispose(): void {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop()
    this.stream = null
    try {
      this.link.setVoice(null)
    } catch {
      /* 링크가 이미 닫힘 */
    }
    for (const id of [...this.remotes.keys()]) this.dropRemote(id)
    void this.ctx?.close().catch(() => {})
    this.ctx = null
  }
}
