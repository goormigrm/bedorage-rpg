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
