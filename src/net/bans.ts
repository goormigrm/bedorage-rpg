// 방장이 내보낸 사람 명단 (2026-09-25 사용자 고른 방송 개선 2 — 방장 강퇴). 대기실(ui/lobby.ts)과 게임(game/session.ts)이 함께 쓴다

/**
 * 방장이 내보낸 사람 (2026-09-25 방송 개선 2 — 방송을 보고 찾아와 방해하는 사람). 이 방(코드)이 열려 있는 동안 — 대기실 → 게임 → 대기실 —
 * 다시 받지 않는다. 피어 id 는 페이지를 새로 열면 바뀌므로 닉네임도 함께 막는다(빈 닉네임은 빼고). 방을 새로 열면 비운다
 */
const bans = { code: '', ids: new Set<string>(), names: new Set<string>() }

export function banPeer(code: string, id: string | undefined, name: string | undefined): void {
  if (bans.code !== code) {
    bans.code = code
    bans.ids.clear()
    bans.names.clear()
  }
  if (id) bans.ids.add(id)
  const n = (name ?? '').trim()
  if (n) bans.names.add(n)
}

export function isBanned(code: string, id: string, name: string | undefined): boolean {
  if (bans.code !== code) return false
  const n = (name ?? '').trim()
  return bans.ids.has(id) || (n !== '' && bans.names.has(n))
}
