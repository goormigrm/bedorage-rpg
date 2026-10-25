// 세이브: 캐릭터 = 세이브 칸 (PLAN 4.5). 캐릭터마다 레벨·경험치·골드·장비·가방을 브라우저(localStorage)에 둔다.
// **세이브 칸 셋** (2026-10-17 사용자: "캐릭터를 30레벨 다 찍고 나면 다시 1레벨부터 친구랑 하고 싶을 수도 있는데 방법이 없다 — 3개의 슬롯을"):
// 칸마다 캐릭터 열둘 · 보관함이 따로 있다. 칸 1 은 예전 세이브 그대로(같은 열쇠). 로비에서 고르고, 내보내기 · 가져오기는 고른 칸에.
// 계정·서버가 없으니 **파일로 내보내기/가져오기**가 메인 PC ↔ 노트북 이동과 백업의 유일한 길이다.
// 쓰기 전에 직전 세이브를 한 벌 보관해 둔다(쓰다가 깨져도 되살릴 수 있게) — 치트 방지가 아니라 사고 방지.

import { CharacterId, CHARACTERS } from '../core/characters'
import { Sheet, emptySheet, sanitizeSheet } from '../core/items'
import { PlayerState } from '../core/state'

/** 세이브 칸 수 */
export const SAVE_SLOTS = 3
/** 고른 칸 (1 ~ SAVE_SLOTS) */
const SLOT_KEY = 'brpg.save.slot'
/** 칸의 열쇠 — 칸 1 은 예전 열쇠 그대로 (옛 세이브가 칸 1 이 된다) */
const keyOf = (slot: number): string => (slot === 1 ? 'brpg.save.v1' : `brpg.save.v1.s${slot}`)
const backupOf = (slot: number): string => `${keyOf(slot)}.bak`

/** 지금 고른 세이브 칸 (1 ~ SAVE_SLOTS) */
export function activeSlot(): number {
  try {
    const n = Number(localStorage.getItem(SLOT_KEY))
    return Number.isInteger(n) && n >= 1 && n <= SAVE_SLOTS ? n : 1
  } catch {
    return 1
  }
}

/** 세이브 칸을 고른다 (로비에서만 — 판 · 방 안에서는 바꾸지 않는다) */
export function setActiveSlot(slot: number): void {
  if (!(Number.isInteger(slot) && slot >= 1 && slot <= SAVE_SLOTS)) return
  try {
    localStorage.setItem(SLOT_KEY, String(slot))
  } catch {
    /* 저장소가 막혀 있으면 이번 화면만 */
  }
}
/** 마지막으로 파일로 내보낸 시각 (백업 알림 — 2026-09-25) */
const EXPORTED = 'brpg.save.exported'

/**
 * 세이브를 **IndexedDB 에도 한 벌** (2026-09-25 사용자 고른 개선 10 — "사이트 데이터를 지우면 캐릭터가 통째로 사라진다").
 * localStorage 만 지워지는 경우(저장소 정리 · 확장 프로그램 · 용량 초과)에 되살린다. 둘 다 지우면 파일 내보내기만 남는다.
 */
const IDB_NAME = 'brpg'
const IDB_STORE = 'save'
function idb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      if (typeof indexedDB === 'undefined') return res(null)
      const r = indexedDB.open(IDB_NAME, 1)
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE)
      r.onsuccess = () => res(r.result)
      r.onerror = () => res(null)
    } catch {
      res(null)
    }
  })
}
function mirrorPut(json: string, key: string): void {
  void idb().then((db) => {
    if (!db) return
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(json, key)
      tx.oncomplete = () => db.close()
      tx.onerror = () => db.close()
    } catch {
      db.close()
    }
  })
}
function mirrorGet(key: string): Promise<string | null> {
  return idb().then(
    (db) =>
      new Promise<string | null>((res) => {
        if (!db) return res(null)
        try {
          const r = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key)
          r.onsuccess = () => {
            res(typeof r.result === 'string' ? r.result : null)
            db.close()
          }
          r.onerror = () => {
            res(null)
            db.close()
          }
        } catch {
          db.close()
          res(null)
        }
      }),
  )
}

/**
 * 시작할 때 한 번: localStorage 에 세이브가 없는데 IndexedDB 에 있으면 되살린다. 되살렸으면 true.
 * 있으면 거울을 지금 것으로 맞춘다 (거울을 만들기 전의 세이브도 한 벌 생기게)
 */
export async function restoreFromMirror(): Promise<boolean> {
  let restored = false
  for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
    const key = keyOf(slot)
    const cur = read(key) ?? read(backupOf(slot))
    if (cur) {
      mirrorPut(JSON.stringify(cur), key)
      continue
    }
    const json = await mirrorGet(key)
    if (!json) continue
    try {
      const d = JSON.parse(json) as SaveData
      if (!d || d.v !== 1 || typeof d.chars !== 'object') continue
      localStorage.setItem(key, json)
      restored = true
    } catch {
      /* 거울이 깨졌으면 그 칸은 건너뛴다 */
    }
  }
  return restored
}

/**
 * 백업 알림 글 (없으면 null): 캐릭터를 조금이라도 키웠는데(5레벨 이상) 파일로 내보낸 적이 없거나 7일이 지났으면.
 * 사이트 데이터를 지우면 localStorage · IndexedDB 가 같이 지워진다 — 파일만 남는다
 */
export function backupNag(now = Date.now()): string | null {
  const grown = Array.from({ length: SAVE_SLOTS }, (_, i) => loadSave(i + 1)).some((d) => Object.values(d.chars).some((c) => (c?.level ?? 1) >= 5))
  if (!grown) return null
  let last = 0
  try {
    last = Number(localStorage.getItem(EXPORTED)) || 0
  } catch {
    last = 0
  }
  const days = Math.floor((now - last) / 86400000)
  if (last > 0 && days < 7) return null
  return last > 0 ? `세이브를 내보낸 지 ${days}일 — 가끔 파일로 받아 두세요` : '세이브를 파일로 받아 두세요 — 브라우저 데이터를 지우면 캐릭터가 사라집니다'
}

interface SaveData {
  v: 1
  chars: Partial<Record<CharacterId, Sheet>>
  /** 보관함 — 캐릭터끼리 공유 (GUIDE 9장) */
  stash?: Sheet['stash']
  /** 보관함 칸 수 — 보관함과 같이 캐릭터 밖에 둔다 (한 캐릭터가 늘리면 모두가 쓴다, 2026-09-25) */
  stashMax?: number
  updated: number
}

function read(key: string): SaveData | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const d = JSON.parse(raw) as SaveData
    if (!d || d.v !== 1 || typeof d.chars !== 'object') return null
    return d
  } catch {
    return null
  }
}

export function loadSave(slot = activeSlot()): SaveData {
  return read(keyOf(slot)) ?? read(backupOf(slot)) ?? { v: 1, chars: {}, updated: 0 }
}

function write(d: SaveData, slot = activeSlot()): void {
  try {
    const key = keyOf(slot)
    const prev = localStorage.getItem(key)
    if (prev) localStorage.setItem(backupOf(slot), prev)
    d.updated = Date.now()
    const json = JSON.stringify(d)
    mirrorPut(json, key)
    localStorage.setItem(key, json)
  } catch {
    /* 저장소가 막혀 있으면(시크릿 창 등) 이번 판만 남는다 — IndexedDB 거울은 먼저 적어 두었다 */
  }
}

/** 로비의 칸 단추에 쓰는 한 줄: 가장 높은 캐릭터 · 키운 캐릭터 수 (빈 칸이면 null) */
export function slotSummary(slot: number): { top: string; level: number; count: number } | null {
  const d = loadSave(slot)
  let top: CharacterId | null = null
  let level = 0
  let count = 0
  for (const [id, sh] of Object.entries(d.chars) as [CharacterId, Sheet | undefined][]) {
    if (!sh || !(id in CHARACTERS)) continue
    const lv = sh.level ?? 1
    if (lv <= 1 && (sh.xp ?? 0) <= 0) continue
    count++
    if (lv > level) {
      level = lv
      top = id
    }
  }
  return top ? { top: CHARACTERS[top].name, level, count } : null
}

/**
 * 세이브 칸을 비운다 (캐릭터 열둘 · 보관함 — 다시 1레벨부터). 바로 앞 세이브는 백업 열쇠에 한 벌 남는다
 * (write 가 덮어쓰기 전에 옮겨 둔다 — 실수로 비웠으면 가져오기 파일이나 백업으로)
 */
export function clearSlot(slot: number): void {
  write({ v: 1, chars: {}, updated: 0 }, slot)
}

/** 캐릭터의 기록 (없으면 1레벨 맨몸) */
export function sheetOf(char: CharacterId): Sheet {
  const d = loadSave()
  // 보관함은 캐릭터 밖에 두고, 판에 들어갈 때 내 기록에 실어 간다
  return sanitizeSheet({ ...(d.chars[char] ?? emptySheet()), stash: d.stash ?? [], stashMax: d.stashMax })
}

/** 판의 플레이어 상태를 세이브에 적는다. 퀘스트는 그 판의 난이도 칸에 (보통 = quests · 악몽·지옥 = tq[난이도]) */
/** 판 위의 캐릭터 → 기록 한 벌 (저장 · 투기장 다시 하기가 같이 쓴다 — 하나라도 빠지면 다음 판에 그만큼 잃는다) */
export function playerSheet(p: PlayerState): Sheet {
  return { level: p.level, xp: p.xp, gold: p.gold, equip: p.equip, bag: p.bag, bagMax: p.bagMax, gpity: p.gpity, stats: p.stats, stash: p.stash, stashMax: p.stashMax, wps: p.wps, potMax: p.potMax, build: p.build, attr: p.attr, mlv: p.mlv, mxp: p.mxp, mst: p.mst, rift: p.riftBest, quests: p.quests }
}

export function commitSheet(p: PlayerState, tier = 0, played?: { act: number; sec: number }[], slot = activeSlot()): void {
  const d = loadSave(slot)
  const prev = d.chars[p.char]
  const tq = (prev?.tq ?? []).slice()
  const twps = (prev?.twps ?? []).slice()
  if (tier > 0) {
    tq[tier] = p.quests
    twps[tier] = p.wps
  }
  for (let i = 0; i < twps.length; i++) twps[i] = twps[i] ?? 0
  // 플레이 시간: 막마다 쌓는다 (악몽·지옥은 4~6 칸, 보통은 0~3 — 보통 한 바퀴 시간을 따로 보려고)
  const playSec = (prev?.playSec ?? []).slice()
  for (const x of played ?? []) {
    const k = Math.min(7, Math.max(0, x.act + (tier > 0 ? 4 : 0)))
    playSec[k] = (playSec[k] ?? 0) + Math.round(x.sec)
  }
  for (let i = 0; i < playSec.length; i++) playSec[i] = playSec[i] ?? 0
  d.chars[p.char] = sanitizeSheet({ ...playerSheet(p), wps: tier > 0 ? (prev?.wps ?? 0) : p.wps, twps, quests: tier > 0 ? (prev?.quests ?? []) : p.quests, tq, playSec })
  delete d.chars[p.char]!.stash
  delete d.chars[p.char]!.stashMax
  const shared = sanitizeSheet({ stash: p.stash, stashMax: p.stashMax })
  d.stash = shared.stash
  d.stashMax = shared.stashMax
  write(d, slot)
}

/** 로비 표시용: 캐릭터의 플레이 시간 ("3시간 12분") — 없으면 빈 글 */
export function playTimeOf(char: CharacterId): string {
  const sec = (sheetOf(char).playSec ?? []).reduce((a, b) => a + b, 0)
  if (sec < 60) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

/** 로비 표시용: 캐릭터별 레벨 */
export function levelOf(char: CharacterId): number {
  return sheetOf(char).level
}

/** 세이브를 파일로 내려받는다 */
export function exportSave(): void {
  const d = loadSave()
  const blob = new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const t = new Date()
  a.download = `bedorage-rpg-save${activeSlot() > 1 ? `-slot${activeSlot()}` : ''}-${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  try {
    localStorage.setItem(EXPORTED, String(Date.now()))
  } catch {
    /* 무시 */
  }
}

/** 파일에서 세이브를 가져온다. 캐릭터마다 검사해서 말이 되는 것만 받는다. 반환 = 받은 캐릭터 수 */
export async function importSave(file: File): Promise<number> {
  const text = await file.text()
  const raw = JSON.parse(text) as Partial<SaveData>
  if (!raw || typeof raw.chars !== 'object' || raw.chars === null) throw new Error('세이브 파일이 아닙니다')
  const d: SaveData = { v: 1, chars: {}, updated: Date.now() }
  let n = 0
  for (const [id, sh] of Object.entries(raw.chars)) {
    if (!(id in CHARACTERS)) continue
    d.chars[id as CharacterId] = sanitizeSheet(sh)
    delete d.chars[id as CharacterId]!.stash
    delete d.chars[id as CharacterId]!.stashMax
    n++
  }
  const shared = sanitizeSheet({ stash: raw.stash, stashMax: raw.stashMax })
  d.stash = shared.stash
  d.stashMax = shared.stashMax
  write(d)
  return n
}
