// 세이브: 캐릭터 = 세이브 칸 (PLAN 4.5). 캐릭터마다 레벨·경험치·골드·장비·가방을 브라우저(localStorage)에 둔다.
// 계정·서버가 없으니 **파일로 내보내기/가져오기**가 메인 PC ↔ 노트북 이동과 백업의 유일한 길이다.
// 쓰기 전에 직전 세이브를 한 벌 보관해 둔다(쓰다가 깨져도 되살릴 수 있게) — 치트 방지가 아니라 사고 방지.

import { CharacterId, CHARACTERS } from '../core/characters'
import { Sheet, emptySheet, sanitizeSheet } from '../core/items'
import { PlayerState } from '../core/state'

const KEY = 'brpg.save.v1'
const BACKUP = 'brpg.save.v1.bak'

interface SaveData {
  v: 1
  chars: Partial<Record<CharacterId, Sheet>>
  /** 보관함 — 캐릭터끼리 공유 (GUIDE 9장) */
  stash?: Sheet['stash']
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
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    /* 저장소가 막혀 있으면(시크릿 창 등) 이번 판만 남는다 */
  }
}

/** 캐릭터의 기록 (없으면 1레벨 맨몸) */
export function sheetOf(char: CharacterId): Sheet {
  const d = loadSave()
  // 보관함은 캐릭터 밖에 두고, 판에 들어갈 때 내 기록에 실어 간다
  return sanitizeSheet({ ...(d.chars[char] ?? emptySheet()), stash: d.stash ?? [] })
}

/** 판의 플레이어 상태를 세이브에 적는다 */
export function commitSheet(p: PlayerState): void {
  const d = loadSave()
  d.chars[p.char] = sanitizeSheet({ level: p.level, xp: p.xp, gold: p.gold, equip: p.equip, bag: p.bag, wps: p.wps, potMax: p.potMax, build: p.build })
  delete d.chars[p.char]!.stash
  d.stash = sanitizeSheet({ stash: p.stash }).stash
  write(d)
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
    n++
  }
  d.stash = sanitizeSheet({ stash: raw.stash }).stash
  write(d)
  return n
}
