// 게임 본편 진입점. 로비 ↔ 게임 세션 전환.

import { Session, SessionConfig } from './game/session'
import { setFavicon } from './ui/favicon'
import { restoreFromMirror } from './game/save'
import { openLobby } from './net/room'
import { Lobby } from './ui/lobby'
import { connect, handleOAuthRedirect, hasToken } from './net/chzzk'
import { loadStreamCfg, saveStreamCfg } from './game/stream'
import { installDevKey } from './game/devmode'

const app = document.getElementById('app')!
// 개발자 모드 (Ctrl + Shift + D — 치지직 창의 시험 단추)
installDevKey()
/**
 * 공용 로비 통로는 **페이지가 사는 동안 하나만** 연다(2026-09-06). 전에는 세션이 끝날 때 통로를 닫고(200ms 뒤 leave) 새 로비가 곧바로
 * 다시 열었는데, Trystero 가 같은 방을 캐시하고 있어 늦게 도는 leave 가 새 통로까지 죽였다 → 판이 끝나고 다시 만든 방이
 * 남에게 안 보였다(방 지키기에서 발견). 닫지 않고 돌려 쓰면 그 일이 없다.
 */
const lobbyLink = openLobby()
let lobby: Lobby | null = null
let session: Session | null = null

function showLobby(): void {
  session?.dispose()
  session = null
  // 게임에서 돌아왔으면 주소의 #room= 을 지운다. 남겨 두면 로비가 초대 링크로 알고 이전 방에 다시 들어가
  // "방 상태" 가 보여서 헷갈린다(2026-09-05 제보). 로비에 오면 방 목록부터.
  if (session === null && location.hash.startsWith('#room=')) history.replaceState(null, '', location.pathname + location.search)
  app.innerHTML = ''
  document.body.style.cursor = ''
  lobby = new Lobby(app, {
    lobbyLink,
    onStart: (cfg: Omit<SessionConfig, 'onExit'>) => {
      lobby?.dispose()
      lobby = null
      startSession(cfg)
    },
  })
  // 소개 영상은 캐릭터 고르는 화면(모닥불)부터 뜬다 (?shot=1 일 때만 — tools/trailer.js)
  if (location.search.includes('shot=1')) (window as unknown as { __lobby: Lobby }).__lobby = lobby
}

/** 게임 세션 열기 — 로비에서, 그리고 "혼자 이어하기"(호스트가 나갔을 때 지금 판 그대로)에서 */
function startSession(cfg: Omit<SessionConfig, 'onExit' | 'onRestart'>): void {
  app.innerHTML = ''
  session = new Session(app, { ...cfg, onExit: showLobby, onRestart: startSession })
  // 스크린샷·GIF 를 뜰 때(?shot=1)만 세션을 밖에 내놓는다 — 장면 연출용(자리 옮기기, 조준점 계산). 평소엔 없다
  if (location.search.includes('shot=1')) (window as unknown as { __session: Session }).__session = session
}

setFavicon()
// 세이브 거울(IndexedDB): localStorage 가 비었으면 되살린 뒤 로비를 연다 (2026-09-25 — 캐릭터가 통째로 사라지지 않게)
void restoreFromMirror()
  .catch(() => false)
  .then((restored) => {
    showLobby()
    if (restored) console.info('[세이브] 브라우저 저장소가 비어 있어 IndexedDB 의 한 벌로 되살렸습니다')
  })

// 치지직 방송 연동 (2026-09-23): 로그인에서 돌아왔으면(?code=) 토큰으로 바꾸고 연결, 전에 연결해 두었으면 다시 연결
void (async () => {
  const back = await handleOAuthRedirect()
  if (back) {
    const c = loadStreamCfg()
    c.auto = true
    saveStreamCfg(c)
  }
  if (hasToken() && loadStreamCfg().auto) await connect()
})()
