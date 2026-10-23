// 첫 입구 (2026-10-23 사용자: "최초 치지직 로그인하면 방이 나가지고 다시 방을 만들어야 — 이어지도록"):
// 치지직 로그인은 작은 창에서 한다(net/chzzk.ts startLogin). 치지직이 code 를 들고 이 주소로 돌려보낸 그 작은 창이면
// 원래 창에 넘기고(BroadcastChannel — 다른 사이트를 거치며 window.opener 가 끊겨도 된다) 닫는다 — 게임은 띄우지 않는다. 아니면 게임(main.ts).
const q = new URLSearchParams(location.search)
const code = q.get('code')
const state = q.get('state')
let popup = false
try {
  popup = !!code && !!state && localStorage.getItem('brpg.chzzk.popup') === state
} catch {
  /* 저장소 없음 */
}
if (popup) {
  const ch = new BroadcastChannel('brpg-chzzk')
  ch.postMessage({ code, state })
  ch.close()
  window.close()
  // 브라우저가 닫기를 막으면 안내만 남긴다
  document.body.innerHTML = '<p style="font:600 16px sans-serif;color:#e8dcc4;text-align:center;margin-top:40vh">치지직 로그인 완료 — 이 창은 닫아도 됩니다</p>'
} else void import('./main')
