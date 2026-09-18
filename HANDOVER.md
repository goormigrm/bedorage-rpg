# HANDOVER — 세션 인수인계

> 새 세션에서 이 문서만 읽으면 이어서 개발할 수 있어야 한다. **개발 상태의 정본.**
> 커밋마다 "현재 상태"와 "다음 할 일"을 갱신한다. 변경 이력은 [CHANGELOG.md](CHANGELOG.md), 설계는 [docs/DESIGN.md](docs/DESIGN.md), 계획·결정 근거는 [docs/PLAN.md](docs/PLAN.md).

## 프로젝트 한 줄

배도라지 크루 오리들이 어두운 던전을 쓸고 다니는 **쿼터뷰 슈팅 RPG**(디아블로류). 혼자 ~ 최대 4인 협동. 서버 없이 WebRTC P2P(락스텝). GitHub Pages 배포.
[배도라지 덕](https://github.com/goormigrm/bedorage-duck) v1.11.1 의 코드를 바탕으로 만든다(2026-09-18 시작).

- 저장소: https://github.com/goormigrm/bedorage-rpg
- 배포: https://goormigrm.github.io/bedorage-rpg/
- 작업 폴더: 메인 PC `C:\Users\tkdrm\OneDrive\Desktop\bedorage-rpg` (덕 `철FPS` 옆). OneDrive 안이라 커밋 직후 푸시.

## 다른 PC 에서 이어받기

```bash
git clone https://github.com/goormigrm/bedorage-rpg.git   # 이미 있으면 git pull
cd bedorage-rpg
npm ci
npm run dev        # http://localhost:5173/bedorage-rpg/
```

Node.js 20 이상(24 권장)과 git 뿐. 계정·키·`.env` 없음. 새 Claude 세션이라면 **"HANDOVER.md 읽고 이어서 진행해줘"** 한 줄이면 된다.

## 실행

```bash
npm run dev        # 개발 서버 (덕과 같은 5173 — 둘을 동시에 띄우지 말 것)
npm test           # vitest
npm run build      # tsc --noEmit + vite build → dist/
```

## 현재 상태 (2026-09-18 · v0.1.0 — M0 저장소 준비)

| 영역 | 상태 | 비고 |
|---|---|---|
| 저장소·배포 | ✅ | 덕 코드 복사, 이름·경로·APP_ID 분리, GitHub Pages(Actions) |
| 게임 내용 | ⏳ 덕 그대로 | 아직 PvP 슈터다. M1 에서 몬스터 전투로 바꾼다 |

## 확정된 결정 (2026-09-18, 자세한 근거는 PLAN 10장)

1. 이름 **배도라지RPG**, 새 저장소. 2. **WASD + 마우스 조준.** 3. **락스텝 유지.**
4. **1차 6명**: 철면덕(기관총)·침착덕(소총)·단군덕(권총)·매직덕(산탄총)·승빠덕(후라이팬)·옥냥덕(저격총) — 무기가 전부 다르다.
5. 마을 = **대기실 화면**(모닥불 야영지). 6. 전리품 = **디아블로 3·4 방식**(개인 전리품 · 스마트 루트 85% · 주웠다 버리면 파티원에게 보임).
7. 죽음 규칙은 **방장이 방을 만들 때** 고른다: 없음 · 소실(골드 20%·경험치 10%) · 하드코어(한 번 죽으면 그 원정 끝, 원정 중 얻은 것 잃음, 세이브는 안 지움).
8. 몬스터는 **어두운 괴물형**(구울·해골·부푼 시체·강령술사·도살자). 9. **시야 제한 유지.** 10. PvP 는 **배도라지 덕으로 연결**(서로 가는 버튼·닉네임 공유). 11. PC 먼저.

사용자가 2026-09-18 "결정할 게 있어도 임의로 정해서 모두 진행" 을 맡겼다 → 이후 개발 중 정한 것은 아래 "핵심 설계 결정" 과 CHANGELOG 에 남긴다.

## 핵심 설계 결정 (바꾸려면 DESIGN.md 도 같이 수정)

덕 HANDOVER 의 1~24 중 PvP 전용(모래주머니·힐팩·팀전·후라이팬 막기·관전 제한)이 아닌 것은 그대로 유효하다. 특히:

1. **`src/core/` 는 결정론.** + **몬스터·스킬·아이템의 기억·추첨은 전부 `GameState` 안**(DESIGN 2장 6).
2. **호스트 = 플레이어 0.** 방 상태·시작·이탈·리싱크·난입을 호스트가 정한다.
3. **카메라 피치 55°·요 45° 고정.** WASD 는 화면 기준.
4. **유료·카드 등록 서비스 금지.** TURN 배제.
5. **인원은 4명까지.** 자리는 정원만큼 미리 잡는다(난입은 빈 자리를 채운다).
6. **닉네임 키 `bd.nick` 은 덕과 공유**, 나머지 저장 키는 `brpg.*`.

## 코드 지도

덕과 같다(덕 HANDOVER "코드 지도"). RPG 로 바뀌는 파일은 마일스톤마다 여기에 적는다.

## 작업 규칙 (덕과 같다)

- 작업 순서를 반드시 지킨다. 작은 변경도 예외 없다:
  1. 개발 → 2. `npm test` + `npm run build` → 3. 브라우저로 눈으로 확인 → 4. **확인 후 서버·탭 닫기**(`preview_stop` + `tabs_close` — 배경음이 계속 난다)
  5. 문서 갱신: `CHANGELOG.md` · `HANDOVER.md` (규칙이 바뀌면 `docs/DESIGN.md`, 결정이 바뀌면 `docs/PLAN.md`) → 6. 커밋 → 7. 푸시 → 8. `gh run list` 로 배포 확인
- 커밋 메시지·주석·문서는 **한국어**, 주석은 '무엇을' 이 아니라 '왜'. 커밋 메시지 끝에 `Co-Authored-By: <세션이 지정한 모델명> <noreply@anthropic.com>`.
- Bash heredoc 은 8191자 제한 → 큰 파일은 Write 도구, 여러 곳 수정은 scratchpad 의 python 스크립트.
- 밸런스 계측은 **보통 난이도 봇**, 최종 수치는 `seeds=5`(덕과 같은 원칙).
- 보안 설정은 바꾸지 말고 안내만. 도구 설치는 승인 후 winget.
- UI 톤: 남색 유리 패널 · 금색 선 · 초록 유리 버튼(덕 로비 그대로, `src/ui/style.css`).

## 다음 할 일

마일스톤(PLAN 8장): **M1 몬스터 전투** → M2 4인 협동 검증 → M3 아이템·세이브 → M4 던전 → M5 스킬 → M6 마을 → M7 콘텐츠 → M8 마감.
