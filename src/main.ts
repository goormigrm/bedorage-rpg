// 게임 본편 진입점. 로비 ↔ 게임 세션 전환.

import { Session, SessionConfig } from './game/session'
import { setFavicon } from './ui/favicon'
import { openLobby } from './net/room'
import { Lobby } from './ui/lobby'

const app = document.getElementById('app')!
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
      app.innerHTML = ''
      session = new Session(app, { ...cfg, onExit: showLobby })
      // 스크린샷·GIF 를 뜰 때(?shot=1)만 세션을 밖에 내놓는다 — 장면 연출용(자리 옮기기, 조준점 계산). 평소엔 없다
      if (location.search.includes('shot=1')) (window as unknown as { __session: Session }).__session = session
    },
  })
}

setFavicon()
showLobby()
