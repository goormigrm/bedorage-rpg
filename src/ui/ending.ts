// 도입과 엔딩 (GUIDE 10장): 새 캐릭터로 처음 마을에 서면 **왜 여기 있는지**를 짧게 보여 주고(2026-09-20 사용자
// "스토리적으로는 전혀 없는 것 같다 — 배도라지가 갑자기 어느 마을에 떨어져서 벗어나기 위해 벌어지는 에피소드"),
// 심연의 군주가 쓰러지면 끝 장면을 보여 준다. 게임은 뒤에서 계속 돈다(마을로 돌아가 정리할 수 있다).
// 캐릭터·전리품은 그대로 남는다. 악몽 난이도는 D7.

const LINES = [
  '성당 종이 멈춘 밤, 오리들은 아무 이유 없이 이 땅에 떨어졌다.',
  '몸통은 거미 여왕의 실에, 혀는 관리인의 열쇠 꾸러미에, 소리는 심연의 목구멍에 있었다.',
  '셋을 모두 되찾아 성당에 걸자, 오래 멈췄던 종이 울렸다.',
  '종소리가 퍼진 땅 위로 아침이 오고 — 그 소리를 따라, 오리들은 집으로 돌아갔다.',
]

const NEXT = ['악몽 난이도가 열렸다 — 같은 세계, 더 깊은 어둠', '지옥 난이도가 열렸다 — 마지막 어둠', '지옥까지 모두 끝냈다 — 전설이 되었다']

export function showEnding(parent: HTMLElement, tier: number, onClose: () => void): void {
  if (parent.querySelector('.ending')) return
  const el = document.createElement('div')
  el.className = 'ending'
  el.innerHTML = `<div class="ending-box">
    <h2>종이 울렸다</h2>
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

/** 도입: 새 캐릭터로 처음 마을에 섰을 때 한 번 (어쩌다 이 땅에 떨어졌는가) */
const INTRO = [
  '그날 밤도 배도라지 크루는 평소처럼 떠들고 있었다.',
  '어디선가 <b>종소리</b>가 한 번 울렸고 — 눈을 떠 보니 낯선 모닥불 곁이었다.',
  '순례자 야영지. 성당 종이 멈춘 뒤로 죽은 것들이 걸어 다니는 땅.',
  '촌장 카인이 말했다. "돌아가려면, 그 종을 다시 울려야 하오."',
]

export function showIntro(parent: HTMLElement, onClose: () => void): void {
  if (parent.querySelector('.ending')) return
  const el = document.createElement('div')
  el.className = 'ending intro'
  el.innerHTML = `<div class="ending-box">
    <h2>종이 멈춘 밤</h2>
    ${INTRO.map((t, i) => `<p style="animation-delay:${0.6 + i * 1.3}s">${t}</p>`).join('')}
    <p class="ending-hint" style="animation-delay:${0.6 + INTRO.length * 1.3}s">마을에서 <b>촌장 카인(F)</b> 에게 말을 걸면 할 일을 알려 줍니다 · <b>M</b> 으로 지도를 봅니다</p>
    <button class="btn ending-go" style="animation-delay:${0.9 + INTRO.length * 1.3}s">시작하기</button>
  </div>`
  parent.appendChild(el)
  const close = () => {
    el.remove()
    onClose()
  }
  el.querySelector<HTMLButtonElement>('.ending-go')!.onclick = close
}
