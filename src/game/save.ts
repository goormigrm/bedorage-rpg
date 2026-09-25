// 세이브: 캐릭터 = 세이브 칸 (PLAN 4.5). 캐릭터마다 레벨·경험치·골드·장비·가방을 브라우저(localStorage)에 둔다.
// 계정·서버가 없으니 **파일로 내보내기/가져오기**가 메인 PC ↔ 노트북 이동과 백업의 유일한 길이다.
// 쓰기 전에 직전 세이브를 한 벌 보관해 둔다(쓰다가 깨져도 되살릴 수 있게) — 치트 방지가 아니라 사고 방지.

import { CharacterId, CHARACTERS } from '../core/characters'
import { Sheet, emptySheet, sanitizeSheet } from '../core/items'
import { PlayerState } from '../core/state'

const KEY = 'brpg.save.v1'
const BACKUP = 'brpg.save.v1.bak'
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
function mirrorPut(json: string): void {
  void idb().then((db) => {
    if (!db) return
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(json, KEY)
      tx.oncomplete = () => db.close()
      tx.onerror = () => db.close()
    } catch {
      db.close()
    }
  })
}
function mirrorGet(): Promise<string | null> {
  return idb().then(
    (db) =>
      new Promise<string | null>((res) => {
        if (!db) return res(null)
        try {
          const r = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(KEY)
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
  const cur = read(KEY) ?? read(BACKUP)
  if (cur) {
    mirrorPut(JSON.stringify(cur))
    return false
  }
  const json = await mirrorGet()
  if (!json) return false
  try {
    const d = JSON.parse(json) as SaveData
    if (!d || d.v !== 1 || typeof d.chars !== 'object') return false
    localStorage.setItem(KEY, json)
    return true
  } catch {
    return false
  }
}

/**
 * 백업 알림 글 (없으면 null): 캐릭터를 조금이라도 키웠는데(5레벨 이상) 파일로 내보낸 적이 없거나 7일이 지났으면.
 * 사이트 데이터를 지우면 localStorage · IndexedDB 가 같이 지워진다 — 파일만 남는다
 */
export function backupNag(now = Date.now()): string | null {
  const d = loadSave()
  const grown = Object.values(d.chars).some((c) => (c?.level ?? 1) >= 5)
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

export function loadSave(): SaveData {
  return read(KEY) ?? read(BACKUP) ?? { v: 1, chars: {}, updated: 0 }
}

function write(d: SaveData): void {
  try {
    const prev = localStorage.getItem(KEY)
    if (prev) localStorage.setItem(BACKUP, prev)
    d.updated = Date.now()
    const json = JSON.stringify(d)
    mirrorPut(json)
    localStorage.setItem(KEY, json)
  } catch {
    /* 저장소가 막혀 있으면(시크릿 창 등) 이번 판만 남는다 — IndexedDB 거울은 먼저 적어 두었다 */
  }
}

/** 캐릭터의 기록 (없으면 1레벨 맨몸) */
export function sheetOf(char: CharacterId): Sheet {
  const d = loadSave()
  // 보관함은 캐릭터 밖에 두고, 판에 들어갈 때 내 기록에 실어 간다
  return sanitizeSheet({ ...(d.chars[char] ?? emptySheet()), stash: d.stash ?? [], stashMax: d.stashMax })
}

/** 판의 플레이어 상태를 세이브에 적는다. 퀘스트는 그 판의 난이도 칸에 (보통 = quests · 악몽·지옥 = tq[난이도]) */
export function commitSheet(p: PlayerState, tier = 0, played?: { act: number; sec: number }[]): void {
  const d = loadSave()
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
  d.chars[p.char] = sanitizeSheet({ level: p.level, xp: p.xp, gold: p.gold, equip: p.equip, bag: p.bag, bagMax: p.bagMax, gpity: p.gpity, stats: p.stats, stashMax: p.stashMax, wps: tier > 0 ? (prev?.wps ?? 0) : p.wps, twps, potMax: p.potMax, build: p.build, attr: p.attr, quests: tier > 0 ? (prev?.quests ?? []) : p.quests, tq, playSec })
  delete d.chars[p.char]!.stash
  delete d.chars[p.char]!.stashMax
  const shared = sanitizeSheet({ stash: p.stash, stashMax: p.stashMax })
  d.stash = shared.stash
  d.stashMax = shared.stashMax
  write(d)
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
  a.download = `bedorage-rpg-save-${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}.json`
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
