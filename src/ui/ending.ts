// 엔딩 (GUIDE 10장 — 4막 끝): 심연의 군주가 쓰러지면 짧은 글 장면. 게임은 뒤에서 계속 돈다(마을로 돌아가 정리할 수 있다).
// 캐릭터·전리품은 그대로 남는다. 악몽 난이도는 D7.

const LINES = [
  '성당 종이 멈춘 밤, 누군가 심연의 옥좌에서 종을 울렸다.',
  '시체는 들판으로 기어 나왔고, 부패는 숲을 삼켰고, 도시 아래에서는 의식이 이어졌다.',
  '그리고 오늘 — 오리들이 그 옥좌까지 내려가 종을 멈췄다.',
  '종소리가 그친 땅 위로, 오랜만에 아침이 온다.',
]

const NEXT = ['악몽 난이도가 열렸다 — 같은 세계, 더 깊은 어둠', '지옥 난이도가 열렸다 — 마지막 어둠', '지옥까지 모두 끝냈다 — 전설이 되었다']

export function showEnding(parent: HTMLElement, tier: number, onClose: () => void): void {
  if (parent.querySelector('.ending')) return
  const el = document.createElement('div')
  el.className = 'ending'
  el.innerHTML = `<div class="ending-box">
    <h2>심연이 닫혔다</h2>
    ${LINES.map((t, i) => `<p style="animation-delay:${1 + i * 1.6}s">${t}</p>`).join('')}
    <p class="ending-sub" style="animation-delay:${1 + LINES.length * 1.6}s">배도라지RPG · 끝 — 끝까지 함께해 줘서 고마워요.</p>
    <p class="ending-hint" style="animation-delay:${1.6 + LINES.length * 1.6}s">${NEXT[Math.max(0, Math.min(2, tier))]} · 캐릭터와 전리품은 그대로 남는다</p>
    <button class="btn ending-go" style="animation-delay:${2 + LINES.length * 1.6}s">계속하기</button>
  </div>`
  parent.appendChild(el)
  el.querySelector<HTMLButtonElement>('.ending-go')!.onclick = () => {
    el.remove()
    onClose()
  }
}
