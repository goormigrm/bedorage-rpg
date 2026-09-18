// 카메라 상수와 화면 기준 이동 변환. Three 를 import 하지 않아 입력 쪽에서도 가볍게 쓴다.
// 카메라는 피치 55° 고정, 요(수평 회전) 45° 고정 → 맵의 벽이 대각선으로 보인다(덕코프식).
// 이렇게 하면 화면 위/아래로 볼 수 있는 거리가 맵 축과 어긋나지 않아 위에서 내려오는 쪽과 올라가는 쪽의 시야 차이가 줄어든다.

export const PITCH = (55 / 180) * Math.PI
export const YAW = Math.PI / 4

/** 지면 위 카메라 전방 단위벡터 (sim 좌표: x 오른쪽, y=z 아래) */
export function cameraForward(): { x: number; y: number } {
  return { x: -Math.sin(YAW), y: -Math.cos(YAW) }
}

/** 지면 위 카메라 오른쪽 단위벡터 */
export function cameraRight(): { x: number; y: number } {
  return { x: Math.cos(YAW), y: -Math.sin(YAW) }
}

/**
 * 화면 기준 입력(sx: 오른쪽 +, sy: 아래 +, 각 -1/0/1) → 월드 8방향 입력(mx, my).
 * 요가 45° 배수이면 8방향이 8방향으로 정확히 대응한다.
 */
export function moveDirFromScreen(sx: number, sy: number): { mx: number; my: number } {
  if (sx === 0 && sy === 0) return { mx: 0, my: 0 }
  const f = cameraForward()
  const r = cameraRight()
  const wx = sx * r.x + -sy * f.x
  const wy = sx * r.y + -sy * f.y
  const a = Math.atan2(wy, wx)
  const oct = Math.round(a / (Math.PI / 4))
  const ca = Math.cos((oct * Math.PI) / 4)
  const sa = Math.sin((oct * Math.PI) / 4)
  return { mx: ca > 0.3 ? 1 : ca < -0.3 ? -1 : 0, my: sa > 0.3 ? 1 : sa < -0.3 ? -1 : 0 }
}

/** 월드 방향 → 화면 기준 방향 (조준선 표시용) */
export function worldDirToScreen(wx: number, wy: number): { x: number; y: number } {
  const f = cameraForward()
  const r = cameraRight()
  const det = r.x * -f.y - -f.x * r.y
  return {
    x: (-f.y * wx + f.x * wy) / det,
    y: (-r.y * wx + r.x * wy) / det,
  }
}
