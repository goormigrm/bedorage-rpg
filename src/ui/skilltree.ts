// 스킬 창 (K — GUIDE 8장, D4): 캐릭터마다 10칸(액티브 다섯 · 궁극기 · 패시브 넷). 레벨마다 포인트 하나.
// 3·5랭크에서 변형 둘 중 하나를 고르고, 배운 액티브를 Q · E · 1 · 2 칸에 건다. 마을에서는 골드로 재분배.
// 상태를 직접 바꾸지 않는다 — CMD_SKILL_* 만 넣는다.

import { keyLabel, skillKeyLabel } from '../game/keymap'
import { CMD_RESPEC, CMD_SKILL_MOD, CMD_SKILL_SLOT, CMD_SKILL_UP } from '../core/input'
import { CHAR_SKILLS, MAX_RANK, PASSIVES, SKILLS, SkillId, TREE_ACTIVE, ULT_NODE, freePoints, modNames } from '../core/skills'
import { PlayerState } from '../core/state'
import { isTown } from '../core/world'

const SLOT_LABEL = ['Q', 'E', '1', '2']

/**
 * 스킬 한 줄 (2026-10-22 사용자: "자세한 설명은 잘 읽지 않으니까 정말 간단하게만 어떤 효과의 스킬인지만") — 자세한 수치는 마우스를 올리면(title).
 * 없는 스킬(새로 더한 것)은 설명의 첫 마디로
 */
const SHORT: Partial<Record<SkillId, string>> = {
  ironwall: '받는 피해 절반 · 괴물이 나를 노림',
  barrage: '휘두르기 2배 빠르게',
  roar: '둘레 큰 피해 · 기절 · 동료 보호',
  pierce: '다음 6발 관통 · 피해 +30%',
  grenade: '던져서 범위 피해 · 기절',
  composure: '모든 탄 치명타 · 연사 빠르게',
  broadcast: '괴물을 드러내고 약하게',
  fanfire: '부채꼴로 8발',
  spotlight: '무대 — 괴물 느리게 · 약하게',
  firstaid: '나와 동료 체력 회복',
  flame: '앞으로 불 · 밀쳐 냄',
  surgery: '쓰러진 동료 일으키기 · 모두 회복',
  pancharge: '공격 · 이동 빠르게',
  oil: '둘레 피해 · 느리게',
  kitchen: '돌면서 둘레 연속 피해',
  catstep: '이동 빠르게 · 다음 한 발 2배',
  railshot: '모두 꿰뚫는 저격 한 발',
  ninelives: '연사 3배 · 관통',
  flash: '둘레 기절',
  mirror: '받는 피해 줄이고 되돌려 줌',
  supernova: '둘레 큰 피해 · 기절 · 동료 회복',
  stunt: '뒤로 구르며 부채꼴 사격',
  curtain: '둘레 기절 · 느리게 · 약하게',
  redcarpet: '구를 때마다 둘레 피해',
  overdrive: '뇌절 가득 · 연사 빠르게',
  shout: '앞으로 밀치기 · 뇌절 충전',
  kingrage: '탄 관통 · 피해 +30%',
  advice: '괴물이 나를 노림 · 약하게',
  cluck: '둘레 피해 · 맞힌 만큼 회복',
  kenwang: '오래 버티기 · 괴물이 나를 노림',
  snack: '나와 동료 회복 · 연사 빠르게',
  trap: '덫 — 밟으면 터지며 기절',
  angelshot: '모두 꿰뚫는 큰 한 발 · 동료 회복',
  catwalk: '이동 · 공격 빠르게',
  flashbulb: '범위 기절 · 드러냄',
  encore: '다른 스킬 대기 끝 · 공격 빠르게',
  cm_bulldoze: '공격 · 이동 빠르게',
  cm_mortar: '던져서 범위 피해 · 기절',
  cm_steel: '나와 동료 체력 회복',
  chim_volley: '부채꼴로 8발',
  chim_mark: '괴물을 드러내고 약하게',
  chim_fallback: '이동 빠르게 · 다음 한 발 2배',
  dg_cut: '이동 빠르게 · 다음 한 발 2배',
  dg_spill: '둘레 피해 · 느리게',
  dg_replay: '다음 6발 관통 · 피해 +30%',
  mg_cast: '받는 피해 절반 · 괴물이 나를 노림',
  mg_xray: '괴물을 드러내고 약하게',
  mg_flask: '던져서 범위 피해 · 기절',
  sw_lid: '받는 피해 절반 · 괴물이 나를 노림',
  sw_torch: '앞으로 불 · 밀쳐 냄',
  sw_chop: '휘두르기 2배 빠르게',
  ok_claw: '다음 6발 관통 · 피해 +30%',
  ok_hairball: '둘레 피해 · 느리게',
  ok_knead: '부채꼴로 8발',
  jp_prism: '부채꼴로 빛줄기 8발',
  jp_overheat: '연사 2배',
  jp_glare: '둘레 피해 · 느리게',
  uw_lead: '괴물을 드러내고 약하게',
  uw_exit: '이동 빠르게 · 다음 한 발 2배',
  uw_ng: '부채꼴로 8발',
  gy_rant: '다음 6발 관통 · 피해 +30%',
  gy_tantrum: '던져서 범위 피해 · 기절',
  gy_glare: '범위 기절 · 드러냄',
  pw_heat: '앞으로 불 · 밀쳐 냄',
  pw_breeze: '나와 동료 체력 회복',
  pw_gale: '공격 · 이동 빠르게',
  td_drumstick: '모두 꿰뚫는 한 발',
  td_flap: '이동 빠르게 · 다음 한 발 2배',
  td_crow: '괴물을 드러내고 약하게',
  jw_pose: '둘레 피해 · 느리게',
  jw_turn: '둘레 괴물 날리기 · 기절',
  jw_finale: '둘레 기절 · 느리게 · 약하게',
}
const short = (id: SkillId): string => SHORT[id] ?? SKILLS[id].desc.split(/[.—]/)[0].trim()

export class SkillPanel {
  readonly el: HTMLElement
  open = false
  private sig = ''

  constructor(
    parent: HTMLElement,
    private me: () => PlayerState,
    private send: (cmd: number, arg: number) => void,
    private onToggle: (open: boolean) => void,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'tp wide skp'
    this.el.hidden = true
    parent.appendChild(this.el)
  }

  toggle(open = !this.open): void {
    this.open = open
    this.el.hidden = !open
    this.sig = ''
    if (open) this.render()
    this.onToggle(open)
  }

  refresh(): void {
    if (!this.open) return
    const p = this.me()
    const sig = JSON.stringify([p.build, p.level, p.gold, p.area])
    if (sig !== this.sig) this.render()
  }

  private render(): void {
    const p = this.me()
    const b = p.build
    this.sig = JSON.stringify([b, p.level, p.gold, p.area])
    const free = freePoints(p.level, b, p.spBonus)
    // 큰 + 단추 (2026-10-22 사용자: "버튼 자체를 더 크게 해서 전투 중에도 간단하게 찍을 수 있게")
    const plus = (n: number) => `<button class="sk-up big" data-cmd="${CMD_SKILL_UP}" data-arg="${n}" title="한 랭크 올리기" ${free > 0 && b.r[n] < MAX_RANK ? '' : 'disabled'}>+</button>`
    const pips = (n: number) => `<span class="sk-r">${'◆'.repeat(b.r[n])}${'◇'.repeat(MAX_RANK - b.r[n])}</span>`
    // 칸의 변형 이름: 3랭크는 공통(위력 · 신속), 5랭크는 스킬 갈래마다(범위 · 강화 · 회복 · 사격 — core/skills.ts VARIANT_NAMES)
    const mods = (n: number, id: SkillId) => {
      const out: string[] = []
      for (const [tier, need, arr] of [[0, 3, b.m3], [1, 5, b.m5]] as const) {
        if (b.r[n] < need) continue
        const cur = arr[n]
        out.push(
          `<span class="sk-m">${need}랭크: ${[0, 1]
            .map((c) => `<button data-cmd="${CMD_SKILL_MOD}" data-arg="${n * 4 + tier * 2 + c}" class="${cur === c + 1 ? 'on' : ''}" ${cur ? 'disabled' : ''}>${modNames(id, tier)[c]}</button>`)
            .join('')}</span>`,
        )
      }
      return out.join('')
    }
    const actives = (TREE_ACTIVE[p.char] ?? CHAR_SKILLS[p.char]).map((id, n) => {
      const def = SKILLS[id]
      const own = n < 2
      const slots = SLOT_LABEL.map((l, k) => `<button data-cmd="${CMD_SKILL_SLOT}" data-arg="${k * 16 + n}" class="${b.s[k] === n ? 'on' : ''}" ${b.r[n] > 0 ? '' : 'disabled'}>${l}</button>`).join('')
      return `<div class="sk-row"><div class="sk-h"><b>${def.name}</b>${own ? '' : '<small>배우는 스킬</small>'}${pips(n)}${plus(n)}</div>
        <div class="sk-d" title="${def.desc}">${short(id)}</div><div class="sk-f"><span class="sk-slots">칸 ${slots}</span>${mods(n, id)}</div></div>`
    })
    const ult = SKILLS[CHAR_SKILLS[p.char][2]]
    const ultRow = `<div class="sk-row ult"><div class="sk-h"><b>${ult.name}</b><small>궁극기 · R</small>${pips(ULT_NODE)}${plus(ULT_NODE)}</div><div class="sk-d" title="${ult.desc}">${short(CHAR_SKILLS[p.char][2])}</div><div class="sk-f">${mods(ULT_NODE, CHAR_SKILLS[p.char][2])}</div></div>`
    const passives = PASSIVES.map((ps, k) => `<div class="sk-row pas"><div class="sk-h"><b>${ps.name}</b>${pips(6 + k)}${plus(6 + k)}</div><div class="sk-d">${ps.desc}</div></div>`).join('')
    const respec = isTown(p.area) ? `<button class="btn" data-cmd="${CMD_RESPEC}" data-arg="0" ${p.gold >= 50 * p.level ? '' : 'disabled'}>재분배 · ${50 * p.level} 골드</button>` : '<span class="tp-note">재분배는 마을에서</span>'
    this.el.innerHTML = `<div class="tp-head"><b>스킬</b><span class="tp-gold">남은 포인트 ${free}</span><button class="inv-x" data-x>✕</button></div>
      <p class="tp-line">＋ 를 눌러 배운다 · 칸 단추로 ${skillKeyLabel(0)} · ${skillKeyLabel(1)} · ${skillKeyLabel(3)} · ${skillKeyLabel(4)} 에 건다 (궁극기 ${skillKeyLabel(2)})</p>
      <div class="sk-grid"><div>${actives.join('')}</div><div>${ultRow}${passives}<div class="sk-respec">${respec}</div></div></div>
      <p class="tp-hint">${keyLabel('skills')} · Esc 로 닫기</p>`
    this.el.querySelector<HTMLButtonElement>('[data-x]')!.onclick = () => this.toggle(false)
    this.el.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((btn) => {
      btn.onclick = () => this.send(Number(btn.dataset.cmd), Number(btn.dataset.arg))
    })
  }
}
