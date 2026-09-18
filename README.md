# 배도라지RPG

배도라지 크루 12명이 성당 아래로 내려가는 **쿼터뷰 슈팅 RPG**(디아블로류). 혼자 또는 **최대 4인 협동**.
마을에서 시작해 이어진 세계를 걸어서 내려간다 — 4막 · 36지역 · 막 보스 넷 · 퀘스트 · 개인 전리품 · 스킬 트리 · 악몽/지옥. 재장전 없이 꾹 눌러 쏜다.
서버 없이 브라우저끼리 WebRTC 로 붙는다(무료). [배도라지 덕](https://github.com/goormigrm/bedorage-duck)(PvP 슈터)의 코드를 바탕으로 만든다.

- 플레이: https://goormigrm.github.io/bedorage-rpg/
- 처음 하는 사람: [플레이 가이드](docs/플레이-가이드.md)
- PvP: 게임 안의 **투기장**(키운 캐릭터로 덕의 대전 규칙)

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
| [docs/GUIDE.md](docs/GUIDE.md) | 게임 방향의 정본 (디아블로 일곱 기둥 · D1~D7) |
| [docs/PLAN.md](docs/PLAN.md) | 전체 계획 · 확정된 결정과 근거 · 마일스톤 |
| [docs/플레이-가이드.md](docs/플레이-가이드.md) | 처음 하는 사람을 위한 안내 (조작 · 마을 · 전투 · 성장 · 같이 하기) |
| [docs/공지글-모음.md](docs/공지글-모음.md) | 게시판에 올릴 공지글 (덕 공지 형식) |
| [docs/DESIGN.md](docs/DESIGN.md) | 게임 설계 정본 (규칙·수치·넷코드) |
| [CHANGELOG.md](CHANGELOG.md) | 변경 이력 |
