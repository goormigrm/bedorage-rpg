// 보기 설정 중 색에 관한 것 (2026-10-08 퀄리티 2차 5단계 — 색약 모드). 판(sim)과는 상관없고 그리는 쪽만 읽는다.
// 색약 모드: 초록(우리 편 좋은 효과 · 세트 아이템)이 빨강(적의 범위)과 헷갈리지 않게 파랑 · 하늘색으로 바꾼다.

export const palette = { colorblind: false }

/** 우리 편 좋은 효과 색 (보통 초록 · 색약 모드 파랑) */
export const allyGood = (): number => (palette.colorblind ? 0x4aa8ff : 0x5aff8a)
export const allyTagCss = (): string => (palette.colorblind ? '#8cc8ff' : '#8dffb0')
/** 세트 아이템 색 (보통 초록 · 색약 모드 하늘색) */
export const setItemCss = (): string => (palette.colorblind ? '#38d8ff' : '#5ce07a')
