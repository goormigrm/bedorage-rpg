// 게임 본편 진입점. 로비 ↔ 게임 세션 전환.

import { Session, SessionConfig } from './game/session'
import { setFavicon } from './ui/favicon'
import { restoreFromMirror } from './game/save'
import { openLobby } from './net/room'
import { Lobby } from './ui/lobby'
import { connect, handleOAuthRedirect, hasToken } from './net/chzzk'
import { loadStreamCfg, saveStreamCfg } from './game/stream'
import { installDevKey } from './game/devmode'
import { installErrorReport } from './ui/errorReport'
import { installKoBreak } from './ui/koBreak'

// 오류 보고 단추 (2026-10-08 — 잡히지 않은 오류가 나면 화면 아래에 · ui/errorReport.ts)
installErrorReport()
// 한국어 줄바꿈: 가운뎃점 · 줄표가 줄 머리에 오지 않게 (ui/koBreak.ts)
installKoBreak()

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

/**
 * 글꼴을 받고 시작한다 (2026-10-08 퀄리티 2차 1단계): 전에는 기본 글꼴로 그렸다가 웹 글꼴이 오면 바뀌어(깜빡임) 캔버스 HUD 는
 * 처음 몇 프레임을 엉뚱한 글꼴로 그렸다. 한글 글꼴은 글자 묶음별로 나뉘어 있어 자주 쓰는 낱말로 그 묶음들을 부른다. 늦으면 3초에서 그냥 간다
 */
async function fontsReady(): Promise<void> {
  if (!document.fonts?.load) return
  const sample = '배도라지 알PG 게임 만들기 방 목록 설정 가방 스킬 능력치 퀘스트 지도 체력 집중 골드 레벨 마을 던전 상인 대장장이 0123456789'
  const want = ['400 16px "Black Han Sans"', '800 16px "Nanum Myeongjo"', '700 16px "Nanum Myeongjo"', '500 16px "IBM Plex Sans KR"', '600 16px "IBM Plex Sans KR"', '700 16px "IBM Plex Sans KR"', '500 12px "IBM Plex Mono"']
  await Promise.race([Promise.all(want.map((f) => document.fonts.load(f, sample).catch(() => []))), new Promise((r) => setTimeout(r, 3000))])
}

/** 첫 화면(index.html #boot)을 걷는다 — 0.35초 흐려지며 */
function hideBoot(): void {
  const boot = document.getElementById('boot')
  if (!boot) return
  boot.classList.add('done')
  setTimeout(() => boot.remove(), 400)
}
// 무슨 일이 있어도 첫 화면이 게임을 막지 않게
setTimeout(hideBoot, 8000)

setFavicon()
// 세이브 거울(IndexedDB): localStorage 가 비었으면 되살린 뒤 로비를 연다 (2026-09-25 — 캐릭터가 통째로 사라지지 않게)
const bootMsg = document.getElementById('boot-msg')
if (bootMsg) bootMsg.textContent = '글꼴 · 세이브 준비 중…'
void Promise.all([restoreFromMirror().catch(() => false), fontsReady().catch(() => undefined)])
  .then(([restored]) => {
    showLobby()
    if (restored) console.info('[세이브] 브라우저 저장소가 비어 있어 IndexedDB 의 한 벌로 되살렸습니다')
  })
  // rAF 가 아니라 타이머로 — 창이 가려져 있으면 rAF 가 돌지 않아 8초 안전 시간까지 첫 화면이 남았다 (배포 확인 2026-10-08)
  .finally(() => setTimeout(hideBoot, 60))

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
