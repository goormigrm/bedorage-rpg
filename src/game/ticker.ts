// 백그라운드 탭에서도 멈추지 않는 틱 타이머.
// requestAnimationFrame 은 탭이 뒤로 가면 멈추고 setInterval 은 1초로 느려지지만,
// 전용 Web Worker 의 타이머는 그렇게 조여지지 않는다. 워커가 16ms 마다 신호를 보낸다.

const WORKER_SRC = `
let id = null
onmessage = (e) => {
  if (e.data === 'start') { if (id === null) id = setInterval(() => postMessage(0), 16) }
  else if (e.data === 'stop') { if (id !== null) { clearInterval(id); id = null } }
}
`

export class Ticker {
  private worker: Worker | null = null
  private fallback = 0

  constructor(private cb: () => void) {}

  start(): void {
    try {
      const blob = new Blob([WORKER_SRC], { type: 'application/javascript' })
      this.worker = new Worker(URL.createObjectURL(blob))
      this.worker.onmessage = () => this.cb()
      this.worker.postMessage('start')
    } catch {
      this.fallback = window.setInterval(() => this.cb(), 16)
    }
  }

  stop(): void {
    if (this.worker) {
      this.worker.postMessage('stop')
      this.worker.terminate()
      this.worker = null
    }
    if (this.fallback) {
      clearInterval(this.fallback)
      this.fallback = 0
    }
  }
}

/**
 * 그리기 횟수 맞추기 (2026-10-17 성능 · 네트워크 검토): 판은 1초에 60번 움직이는데(TICK_MS) 120 · 144Hz 모니터는 화면 신호(rAF)를
 * 그만큼 보내 1초에 120 · 144번 그렸다. 한 번 그리는 데 CPU 가 7 ~ 10ms 들어(장면 · 그림자 · 후처리) 메인 스레드가 거의 쉬지 못했고,
 * 그러면 입력을 보내는 틱 처리(워커 신호)가 늦어져 락스텝이 그 사람을 기다렸다 — 넷 모두 멈칫.
 * 지난 그리기에서 1/60초가 다 되기 전(신호 간격의 절반만큼 일찍까지 봐준다)이면 이번 신호는 건너뛴다 →
 * 60Hz 는 그대로 · 120 → 60 · 144 → 72 · 240 → 60 · 165 → 55 fps (고르게 건너뛴다)
 */
export function shouldDraw(sinceLastDraw: number, rafInterval: number): boolean {
  return sinceLastDraw >= 1000 / 60 - rafInterval / 2
}
