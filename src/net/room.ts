// Trystero 기반 방 목록·방 생성·참가. 서버 없이 공개 Nostr 릴레이(기본)로 시그널링한다.
// - 로비 방('lobby'): 접속 중인 모든 사람이 모이는 공용 방. 호스트가 방 정보를 방송하고, 다른 사람은 목록으로 본다.
// - 게임 방(code): 호스트 + 게스트 최대 3명 (정원 MAX_PLAYERS). 풀 메시라 모두가 모두에게 보낸다.
//   방 상태(멤버 순서·준비·팀)는 호스트가 'room' 메시지로 방송하는 것이 정본이다.
// 게임 로직은 모른다. 메시지와 피어 이벤트만 다룬다.

import { joinRoom, selfId, type Room } from 'trystero'
import { MAX_PLAYERS } from '../core/state'
import type { Sheet } from '../core/items'

/** 프로토콜이 바뀌면 올린다 (다른 버전 클라이언트와 섞이지 않게) */
// 배도라지 덕('bedorage-duck-v3')과 다른 값이어야 로비 방송·방이 섞이지 않는다 (같은 릴레이를 쓴다)
export const APP_ID = 'bedorage-rpg-v1'
const LOBBY_ID = 'lobby'
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * Nostr 중계 수. Trystero 는 기본 18곳 중 앱 ID 로 섞은 앞 5곳을 쓰는데, 이 앱에 뽑힌 5곳 중 3곳이 죽어 있었다
 * (2026-09-19: nostr.vulpem.com · relay.nostrdice.com 접속 실패 · relay.nostromo.social "not on white-list").
 * 실제로 두 곳으로만 신호를 주고받아 방 참가가 20~40초씩 걸렸다 → 10곳. 앞 5곳은 그대로라 옛 버전 손님과도 만난다
 */
const RELAYS = { relayRedundancy: 10 }

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
}

export type RoomMode = 'ffa' | 'teams'
export const ROOM_MODE_LABEL: Record<RoomMode, string> = { ffa: '개인전', teams: '2v2 팀전' }

export function makeRoomCode(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return s
}

// ---------- 방 목록 (로비) ----------

export interface RoomInfo {
  code: string
  hostChar: string
  /** 방장 닉네임 (없으면 캐릭터 이름으로 보여 준다). 목록에 "○○의 방" — 2026-09-06 */
  hostName?: string
  map: string
  targetKills: number
  mode: RoomMode
  /** 현재 인원 / 정원 */
  count: number
  max: number
  /** 죽음 규칙 (0 없음 · 1 소실 · 2 하드코어). 방장이 정한다 */
  deathRule?: number
  /** 난이도 (0 보통 · 1 악몽 · 2 지옥) */
  tier?: number
  /** 판 종류: dungeon(협동) · arena(투기장 PvP) */
  kind?: string
  /** 방 사람들의 평균 레벨 · 평균 템 수준 (2026-09-20 — 목록에서 내게 맞는 방을 고르라고) */
  lv?: number
  gs?: number
  /** open = 참가 가능, full = 정원 참, playing = 게임 중 */
  state: 'open' | 'full' | 'playing' | 'closed'
  /** 수신 시각 (로컬) */
  seenAt: number
  /** 방송한 피어 */
  peerId: string
}

export type RoomAnnounce = Omit<RoomInfo, 'seenAt' | 'peerId'>

export interface LobbyLink {
  /** 목록이 바뀔 때마다 (만료 포함) */
  onRooms(cb: (rooms: RoomInfo[]) => void): void
  /** 호스트: 내 방 정보를 방송 (2초마다 자동 재방송) */
  announce(info: RoomAnnounce | null): void
  onlineCount(): number
  leave(): void
}

export function openLobby(): LobbyLink {
  const room: Room = joinRoom({ appId: APP_ID, rtcConfig: RTC_CONFIG, ...RELAYS }, LOBBY_ID)
  const [sendRoom, onRoom] = room.makeAction<RoomAnnounce | null>('room')
  const rooms = new Map<string, RoomInfo>()
  let mine: RoomAnnounce | null = null
  let cb: ((rooms: RoomInfo[]) => void) | null = null
  let peers = 0

  const emit = () => {
    const now = performance.now()
    for (const [k, r] of rooms) if (now - r.seenAt > 7000 || r.state === 'closed') rooms.delete(k)
    cb?.([...rooms.values()].sort((a, b) => a.code.localeCompare(b.code)))
  }
  onRoom((info, peerId) => {
    if (!info) {
      rooms.delete(peerId)
    } else {
      rooms.set(peerId, { ...info, seenAt: performance.now(), peerId })
    }
    emit()
  })
  room.onPeerJoin(() => {
    peers++
    if (mine) void sendRoom(mine)
  })
  room.onPeerLeave((id) => {
    peers = Math.max(0, peers - 1)
    rooms.delete(id)
    emit()
  })
  const timer = setInterval(() => {
    if (mine) void sendRoom(mine)
    emit()
  }, 2000)

  return {
    onRooms(f) {
      cb = f
      emit()
    },
    announce(info) {
      mine = info
      void sendRoom(info)
    },
    onlineCount() {
      return peers + 1
    },
    leave() {
      clearInterval(timer)
      if (mine) void sendRoom(null)
      setTimeout(() => void room.leave(), 200)
    },
  }
}

// ---------- 게임 방 ----------

/** 방 멤버. 배열 순서 = 플레이어 인덱스 (호스트가 0) */
export type Member = {
  id: string
  char: string
  ready: boolean
  team: number
  /** 닉네임 (비어 있으면 캐릭터 이름을 쓴다) */
  name: string
  /** 봇 자리 (호스트가 빈 자리를 봇으로 채웠다). 호스트가 입력을 대신 만들어 보낸다 */
  bot?: boolean
  /** 캐릭터 기록 (레벨·장비·가방) — 시작할 때 모두가 같은 기록으로 판을 만든다 */
  sheet?: Sheet
}

export type CtlMessage =
  /** 내 상태 (캐릭터·준비·팀). 모두에게 */
  | { t: 'hello'; char: string; ready: boolean; team: number; name: string; sheet?: Sheet }
  /** 호스트 → 모두: 방 상태 정본 */
  | { t: 'room'; mode: RoomMode; targetKills: number; map: string; members: Member[]; size: number; fillBots?: boolean; deathRule?: number; tier?: number; kind?: string }
  /** 호스트 → 정원 초과로 들어온 피어 */
  | { t: 'full' }
  /** 호스트 → 모두: 시작. players 순서가 플레이어 인덱스 */
  | { t: 'start'; seed: number; targetKills: number; delay: number; map: string; scale: number; mode: RoomMode; players: Member[]; botDiff?: string; deathRule?: number; tier?: number; kind?: string }
  | { t: 'ping'; s: number }
  | { t: 'pong'; s: number }
  | { t: 'hash'; tick: number; h: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { t: 'resync'; tick: number; state: any }
  /** 호스트 → 모두: 플레이어 p 를 tick 에 제거 (이탈) */
  | { t: 'drop'; p: number; tick: number }
  /** 팀 신호: 같은 편에게 "여기" 를 찍는다. sim 밖(렌더 전용)이라 결정론과 무관하다 */
  | { t: 'mark'; p: number; x: number; y: number }
  /** 빠른 감정 표현 (ㅋㅋ · 굿 · 미안). sim 밖 */
  | { t: 'emote'; p: number; id: number }
  /** 텍스트 채팅 (Enter). sim 밖 — 받는 쪽이 보낸 사람 자리 · 길이를 다시 본다 */
  | { t: 'chat'; p: number; text: string }
  /**
   * 난입 (진행 중인 방에 새로 들어가기). 순서:
   *   1. 게스트 → 호스트 joinAsk. 호스트는 자리를 잡아 두고 곧바로 resume(판 전체)을 보낸다.
   *   2. 난입자는 그 판으로 세션을 열되 **관전 상태**다 — 자기 자리는 아직 판에 없고, 모두의 락스텝도 그 자리를 기다리지 않는다.
   *   3. 난입자가 모든 피어와 연결되면 joinReady. 호스트가 그 사람 입력까지 실제로 받고 있으면 joinLive 를 방송한다.
   *   4. joinLive 의 tick 에 모두가 같은 틱에 자리를 채우고, 그때부터 그 사람 입력을 기다린다.
   *   준비가 늦으면(8초) 호스트가 joinCancel 로 자리를 되돌리고 그 사람을 돌려보낸다(rejoinNo).
   * 기존 사람들은 3·4 사이에도 그 자리를 기다리지 않으므로 **난입 때문에 멈추는 일이 없다.**
   */
  | { t: 'joinAsk'; char: string; name: string; sheet?: Sheet }
  /** 난입자 → 호스트: 모두와 연결됐다 (호스트가 준 피어 목록 기준) */
  | { t: 'joinReady' }
  /**
   * 호스트 → 모두: 자리 p 에 tick 부터 사람이 들어온다. **id 는 난입자의 피어 id 다.**
   * 이게 없으면 호스트가 아닌 사람은 난입자의 입력이 누구 것인지 몰라서 통째로 버리고,
   * 그 자리 입력을 영원히 기다리다 모두가 멈춘다(2026-09-06 제보).
   */
  | { t: 'joinLive'; p: number; tick: number; char: string; team: number; name: string; id: string; sheet?: Sheet }
  /**
   * 호스트 → 모두: 자리 p 에 들어오기로 한 사람(id)의 배정을 물린다 (앉기 전에 나갔거나 준비가 늦었다).
   * 이게 없으면 그 자리에 유령이 소환되고 모두가 그 입력을 기다리다 멈춘다.
   */
  | { t: 'joinCancel'; p: number; id: string }
  /** 아무나 → 모두: 지난 입력을 다시 보내 달라 (난입자가 세션을 연 직후 — 그 전에 온 패킷은 받을 곳이 없었다) */
  | { t: 'inputsPlease' }
  /** 호스트 → 모두: 팀전에서 누가 나가 경기를 끝낸다 (p = 나간 사람). 받은 쪽은 그 자리에서 결과를 띄운다 */
  | { t: 'abort'; p: number }
  /** 호스트 → 돌아온 사람에게만: 그 시점의 판 전체 (이걸로 이어서 시작한다) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { t: 'resume'; p: number; tick: number; state: any; cfg: any }
  /** 호스트 → 돌아온 사람: 자리가 없다 */
  | { t: 'rejoinNo'; why: string }
  | { t: 'rematch'; seed: number }
  | { t: 'leave' }

/** 재접속한 사람이 세션을 다시 만들 때 필요한 설정 (맵·인원·닉네임 등) */
export interface ResumeCfg {
  chars: string[]
  teams?: number[]
  names: string[]
  targetKills: number
  seed: number
  map: string
  scale: number
  delay: number
  peerIds: string[]
}

export interface RoomLink {
  code: string
  role: 'host' | 'guest'
  selfId: string
  /** 연결된 피어 id */
  peers: Set<string>
  /** 피어별 왕복 시간 */
  rtts: Map<string, number>
  /** 가장 느린 피어의 왕복 시간 */
  readonly rtt: number
  /** to 를 생략하면 모두에게 */
  sendCtl(m: CtlMessage, to?: string | string[]): void
  /** to 를 주면 그 피어에게만 (늦게 연결된 피어에게 지난 입력을 몰아 보낼 때) */
  sendInput(buf: Uint8Array, to?: string): void
  onCtl(cb: (m: CtlMessage, from: string) => void): void
  onInput(cb: (buf: Uint8Array, from: string) => void): void
  onPeerJoin(cb: (id: string) => void): void
  onPeerLeave(cb: (id: string) => void): void
  /** 음성: 마이크 스트림을 지금·나중에 붙는 모든 피어에게 보낸다 (null = 거두기) */
  setVoice(stream: MediaStream | null): void
  onVoice(cb: (stream: MediaStream, from: string) => void): void
  leave(): void
}

export const ROOM_MAX = MAX_PLAYERS

/** 우리가 나간 방 객체. Trystero 는 leave 가 끝나기 전(또는 중간에 멈추면 영영) 같은 방 id 로 옛 객체를 돌려준다 */
const leftRooms = new WeakSet<Room>()

export function openRoom(code: string, role: 'host' | 'guest'): RoomLink {
  const room: Room = joinRoom({ appId: APP_ID, rtcConfig: RTC_CONFIG, ...RELAYS }, `room-${code}`)
  if (leftRooms.has(room)) {
    // 나간 방을 다시 받았다: 릴레이 구독·방송은 살아 있고 피어 연결은 아래 leave 가 끊어 두었으므로, 상대가 다시 제안하면 이 객체로도 붙는다.
    // (2026-09-06 사용자 제보: 나갔다가 같은 방에 난입하면 "연결되지 않았습니다" — 새로고침 전까지 재현. 원인 후보라 기록만 남긴다)
    console.warn(`[room] ${code}: Trystero 가 나갔던 방 객체를 다시 돌려줬다 (leave 미완료)`)
    leftRooms.delete(room)
  }
  const [sendCtlRaw, onCtlRaw] = room.makeAction<CtlMessage>('ctl')
  const [sendInRaw, onInRaw] = room.makeAction<Uint8Array>('in')
  const peers = new Set<string>()
  const rtts = new Map<string, number>()
  // Trystero 는 훅마다 리스너를 하나만 갖는다 (나중 등록이 덮어씀). 여기서 한 번만 등록하고 여러 콜백에 나눠 준다.
  const joinCbs: ((id: string) => void)[] = []
  const leaveCbs: ((id: string) => void)[] = []
  const ctlCbs: ((m: CtlMessage, from: string) => void)[] = []
  const inCbs: ((buf: Uint8Array, from: string) => void)[] = []
  const voiceCbs: ((s: MediaStream, from: string) => void)[] = []
  let voice: MediaStream | null = null

  const link: RoomLink = {
    code,
    role,
    selfId,
    peers,
    rtts,
    get rtt() {
      let m = 0
      for (const v of rtts.values()) m = Math.max(m, v)
      return m
    },
    sendCtl(m, to) {
      if (to !== undefined) {
        const list = Array.isArray(to) ? to.filter((p) => peers.has(p)) : peers.has(to) ? [to] : []
        if (list.length > 0) void sendCtlRaw(m, list)
      } else if (peers.size > 0) {
        void sendCtlRaw(m)
      }
    },
    sendInput(buf, to) {
      if (to !== undefined) {
        if (peers.has(to)) void sendInRaw(buf, to)
      } else if (peers.size > 0) void sendInRaw(buf)
    },
    onCtl(cb) {
      ctlCbs.push(cb)
    },
    onInput(cb) {
      inCbs.push(cb)
    },
    onPeerJoin(cb) {
      joinCbs.push(cb)
    },
    onPeerLeave(cb) {
      leaveCbs.push(cb)
    },
    setVoice(stream) {
      if (voice) {
        try {
          room.removeStream(voice)
        } catch {
          /* 이미 끊긴 피어 */
        }
      }
      voice = stream
      if (stream && peers.size > 0) for (const p of room.addStream(stream)) void p.catch(() => {})
    },
    onVoice(cb) {
      voiceCbs.push(cb)
    },
    leave() {
      voiceCbs.length = 0
      clearInterval(pingTimer)
      joinCbs.length = 0
      leaveCbs.length = 0
      ctlCbs.length = 0
      inCbs.length = 0
      leftRooms.add(room)
      const conns = Object.values(room.getPeers())
      ;(room.leave() as Promise<void>).catch(() => {})
      // 나가기 메시지가 나갈 짬(0.5초)을 주고 **연결을 직접 끊는다**. Trystero 의 leave 는 피어마다 메시지를 보낸 뒤에야 연결을 닫는데,
      // 보낼 게 밀려 있거나 죽은 피어가 남아 있으면 거기서 멈추거나 실패해 연결이 열린 채 남는다. 그러면 상대 Trystero 는 우리가 아직
      // 붙어 있는 줄 알고 같은 피어 id 의 재입장 신호를 무시한다 → 같은 방에 다시 난입하면 "연결되지 않았습니다"(2026-09-06 사용자 제보).
      // 연결이 실제로 끊기면 상대 쪽이 정리하므로, 그 뒤의 재입장은 새 연결로 붙는다
      setTimeout(() => {
        for (const pc of conns) {
          try {
            if (pc.connectionState !== 'closed') pc.close()
          } catch {
            /* 이미 닫힘 */
          }
        }
      }, 500)
    },
  }

  // 혹시 이미 붙어 있던 방(Trystero 캐시)이면 지금 있는 피어를 "방금 들어온 것" 으로 알려 준다 — 안 그러면 joinAsk 를 보낼 계기가 없다.
  // 끊긴 연결(닫는 중·실패)은 뺀다 — 죽은 피어에게 joinAsk 를 보내 봐야 답이 없고, 진짜 연결은 곧 onPeerJoin 으로 온다
  setTimeout(() => {
    for (const [id, pc] of Object.entries(room.getPeers())) {
      if (peers.has(id) || pc.connectionState !== 'connected') continue
      peers.add(id)
      for (const cb of [...joinCbs]) cb(id)
    }
  }, 0)
  room.onPeerJoin((id) => {
    peers.add(id)
    // 음성을 켜 둔 채면 새로 붙은 사람에게도 보낸다
    if (voice) for (const p of room.addStream(voice, id)) void p.catch(() => {})
    for (const cb of [...joinCbs]) cb(id)
  })
  room.onPeerStream((stream, id) => {
    for (const cb of [...voiceCbs]) cb(stream, id)
  })
  room.onPeerLeave((id) => {
    peers.delete(id)
    rtts.delete(id)
    for (const cb of [...leaveCbs]) cb(id)
  })
  onCtlRaw((m, from) => {
    if (m.t === 'ping') {
      link.sendCtl({ t: 'pong', s: m.s }, from)
      return
    }
    if (m.t === 'pong') {
      rtts.set(from, Math.round(performance.now() - m.s))
      return
    }
    for (const cb of [...ctlCbs]) cb(m, from)
  })
  onInRaw((buf, from) => {
    for (const cb of [...inCbs]) cb(buf as Uint8Array, from)
  })
  const pingTimer = setInterval(() => {
    if (peers.size === 0) return
    link.sendCtl({ t: 'ping', s: performance.now() })
  }, 1000)
  return link
}
