// 플레이어 입력. 한 틱에 한 개. 네트워크 패킷과 봇 출력이 모두 이 형태.

export const BTN_FIRE = 1 << 0
export const BTN_ADS = 1 << 1
export const BTN_RELOAD = 1 << 2
export const BTN_DASH = 1 << 3
/** 캐릭터 교체 요청 (죽어서 대기 중이거나 리스폰 3초 안일 때만 유효) */
export const BTN_SWAP = 1 << 4
/** 달리기 (Shift). 누르고 있는 동안 기력을 쓰며 빨라진다 */
export const BTN_SPRINT = 1 << 5
/** 상호작용 (F): 쓰러진 동료 일으키기 · (M3~) 줍기·계단 */
export const BTN_USE = 1 << 6
/** 스킬 Q · E · 궁극기 X (2026-09-18 — 버튼이 8비트를 넘어 16비트로 늘렸다) */
export const BTN_SKILL1 = 1 << 7
export const BTN_SKILL2 = 1 << 8
export const BTN_ULT = 1 << 9
/** 스킬 번호(0·1·2) → 버튼 */
export const SKILL_BTNS = [BTN_SKILL1, BTN_SKILL2, BTN_ULT]

export interface Input {
  /** -1, 0, 1 */
  mx: number
  /** -1, 0, 1 */
  my: number
  /** 조준 각도 0..1023 */
  aim: number
  /**
   * 조준점(커서)까지의 거리, 4px 단위 0..255 (최대 1020px). 생략하면 0 = 조준점 없음.
   * 헤드샷은 **커서가 상대 위에 있을 때**만 나므로 각도만으로는 모자라다 (2026-09-05).
   */
  aimDist?: number
  /** BTN_* 비트 */
  buttons: number
  /** 캐릭터 선택 확정: 0 = 없음, n = CHARACTER_LIST[n-1] */
  char: number
}

export const EMPTY_INPUT: Input = { mx: 0, my: 0, aim: 0, buttons: 0, char: 0, aimDist: 0 }

export function cloneInput(i: Input): Input {
  return { mx: i.mx, my: i.my, aim: i.aim, buttons: i.buttons, char: i.char, aimDist: i.aimDist ?? 0 }
}

export function inputEquals(a: Input, b: Input): boolean {
  return a.mx === b.mx && a.my === b.my && a.aim === b.aim && a.buttons === b.buttons && a.char === b.char && (a.aimDist ?? 0) === (b.aimDist ?? 0)
}

/** 8바이트 직렬화 (2026-09-18: 버튼 16비트 — 스킬 셋 · APP_ID bedorage-rpg-v1) */
export const INPUT_BYTES = 8

export function writeInput(view: DataView, offset: number, i: Input): void {
  view.setInt8(offset, i.mx)
  view.setInt8(offset + 1, i.my)
  view.setUint16(offset + 2, i.aim & 1023)
  view.setUint16(offset + 4, i.buttons & 0xffff)
  view.setUint8(offset + 6, i.char & 255)
  view.setUint8(offset + 7, (i.aimDist ?? 0) & 255)
}

export function readInput(view: DataView, offset: number): Input {
  return {
    mx: view.getInt8(offset),
    my: view.getInt8(offset + 1),
    aim: view.getUint16(offset + 2) & 1023,
    buttons: view.getUint16(offset + 4),
    char: view.getUint8(offset + 6),
    aimDist: view.getUint8(offset + 7),
  }
}
