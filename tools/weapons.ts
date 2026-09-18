// 무기 표 (2026-09-19 재장전을 없앤 뒤의 밸런스 기준): 계열 · 변형 · 한 마리 지속 DPS · 거리별 · 관통 · 폭발.
// 레벨·장비 배율 전의 값이다. 여럿을 꿰뚫거나 터지는 무기는 "무리" 줄에서 몇 배로 커지는지 본다.
//
//   npx vite-node tools/weapons.ts
import { WEAPONS, WeaponId, falloff, weaponDps } from '../src/core/weapons'

const ids = Object.keys(WEAPONS) as WeaponId[]
const fams = [...new Set(ids.map((id) => WEAPONS[id].family))]
const pad = (s: string | number, n: number) => String(s).padStart(n)
console.log('계열        무기          초당(가까이)  초당(400px)  관통  폭발   사거리(px)  이동')
for (const f of fams) {
  for (const id of ids.filter((k) => WEAPONS[k].family === f)) {
    const w = WEAPONS[id]
    const near = weaponDps(w) * 60
    const far = w.melee ? 0 : ((w.damage * w.pellets * falloff(w, 400) * (w.boom ? 1 + w.boom.mul : 1)) / w.fireInterval) * 60
    const reach = w.melee ? w.meleeRange ?? 0 : w.speed * w.life
    console.log(
      `${WEAPONS[f].name.padEnd(8)}  ${w.name.padEnd(9)}  ${pad(near.toFixed(0), 10)}  ${pad(reach < 400 ? '-' : far.toFixed(0), 10)}  ${pad(w.pierce ?? 0, 4)}  ${pad(w.boom ? w.boom.r : '-', 4)}   ${pad(Math.round(reach), 9)}  ${w.moveMul}`,
    )
  }
}
