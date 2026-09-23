// socket.io-client v2 에는 자체 타입 선언이 없어 치지직 세션에 쓰는 만큼만 선언한다 (먹방 룰렛과 같다)
declare module 'socket.io-client' {
  export interface ChzzkSocket {
    on(event: string, cb: (data: unknown) => void): void
    disconnect(): void
    connected: boolean
  }
  function io(url: string, opts?: Record<string, unknown>): ChzzkSocket
  export default io
}
