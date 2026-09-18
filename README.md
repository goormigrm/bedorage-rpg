# 배도라지RPG

배도라지 크루 오리들이 어두운 던전을 쓸고 다니는 **쿼터뷰 슈팅 RPG**(디아블로류). 혼자 또는 **최대 4인 협동**.
서버 없이 브라우저끼리 WebRTC 로 붙는다(무료). [배도라지 덕](https://github.com/goormigrm/bedorage-duck)(PvP 슈터)의 코드를 바탕으로 만든다.

- 플레이: https://goormigrm.github.io/bedorage-rpg/
- PvP 는 배도라지 덕에서: https://goormigrm.github.io/bedorage-duck/

> 비공식 팬 프로젝트 · 비상업. 문의 시 즉시 삭제합니다.

## 개발

```bash
npm ci
npm run dev      # http://localhost:5173/bedorage-rpg/
npm test         # vitest
npm run build    # tsc --noEmit + vite build → dist/
```

필요한 것은 Node.js 20 이상(24 권장)과 git 뿐이다. 계정·키·환경변수가 없다. `main` 에 푸시하면 GitHub Pages 로 배포된다.

## 문서

| 문서 | 내용 |
|---|---|
| [HANDOVER.md](HANDOVER.md) | 개발 상태의 정본 · 다음 할 일 · 작업 규칙 |
| [docs/PLAN.md](docs/PLAN.md) | 전체 계획 · 확정된 결정과 근거 · 마일스톤 |
| [docs/DESIGN.md](docs/DESIGN.md) | 게임 설계 정본 (규칙·수치·넷코드) |
| [CHANGELOG.md](CHANGELOG.md) | 변경 이력 |
