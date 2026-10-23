// 도구의 브라우저를 진짜 GPU 로 연다: Windows 는 D3D11, WSL(원격 개발 PC)은 Mesa d3d12 를 거친 GL — WSL 에서 d3d11 옵션은
// SwiftShader(CPU)가 잡혀 셰이더 컴파일 · 덮개 시간이 몇 배로 나왔다 (2026-10-23 — 덮개 9초가 실제 GPU 로는 4초)
import { existsSync } from 'node:fs'

export const gpuLaunch = (...args) =>
  existsSync('/dev/dxg')
    ? { channel: 'chrome', args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', ...args], env: { ...process.env, GALLIUM_DRIVER: 'd3d12' } }
    : { channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', ...args] }
