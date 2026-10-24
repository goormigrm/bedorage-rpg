# HANDOVER — 세션 인수인계

> 새 세션에서 이 문서만 읽으면 이어서 개발할 수 있어야 한다. **개발 상태의 정본.**
> 커밋마다 "현재 상태"와 "다음 할 일"을 갱신한다. 변경 이력은 [CHANGELOG.md](CHANGELOG.md), 설계는 [docs/DESIGN.md](docs/DESIGN.md), 계획·결정 근거는 [docs/PLAN.md](docs/PLAN.md).
> **게임 방향의 정본은 [docs/GUIDE.md](docs/GUIDE.md)** — 무엇을 만들지 헷갈리면 거기 2장(일곱 기둥)과 15장(개발 규칙)부터 읽는다.
> **⚠ 사용자에게 하는 모든 말은 한국어로** — 답 · 진행 중 짧은 안내 · 마지막 보고 · 질문 전부(코드 식별자 · 파일 이름 · 명령어만 원문). 세션이 요약된 뒤에도 같다.
> (2026-09-25 사용자: "한글로 설명해 — 왜 갑자기 규칙 어기고 영어로 설명하는 거야". 커밋 · 주석 · 문서만 한국어라고 적혀 있어 대화가 빠졌었다.)
> **⚠ 알고 있는 수정 · 당연한 동작은 묻지 말고 바로 고친다** — 결함이나 어색한 동작을 알게 되면 같은 작업 안에서 고치고 "고쳤다"로 보고한다. "원하시면 바꾸겠습니다"로 미루지 않는다. 묻는 것은 사용자만 정할 수 있는 선택(방향 · 취향 · 돈 · 되돌리기 어려운 것)일 때만.
> (2026-09-26 사용자: "마을로 갈 때는 당연히 안 따라오는 거겠지? 알고 있는 수정 사항은 바로 진행해 — 당연한 걸 다시 묻고 개발 진행하지 말고 HANDOVER 에 작성해 놔". 응원 아군이 마을까지 따라간다는 것을 알고도 보고에만 적었다.)
> **같은 폴더에서 세션 둘이 동시에 고치지 말 것** — 커밋 안 된 변경이 있으면 누가 만든 것인지(`ListAgents`) 먼저 보고 사용자에게 누가 이어받을지 묻는다.
> 정리 전 원문(지난 세션 인계 · 플레이 피드백 · 계측 · 옛 할 일)은 [docs/HANDOVER-지난기록.md](docs/HANDOVER-지난기록.md) — 2026-10-17 정리.

## 🔖 타격감 · 아이템 · 대장장이 모루 · 스위치 · 후원 표 · 3인칭 · 최적화 · 패치 플레이 영상 (2026-10-24 · 원격 개발 PC — v1.10.8 ~ v1.10.20 배포)

- **v1.10.18**: 시점 스위치 글자 오른쪽에 단축키 `<kbd>`(`session.syncViewBtn` · 키 설정이 바뀌면 `refreshKeyLabels` 가 다시 씀 · style.css `.skin-sw .sw-cap kbd`).
- **v1.10.19 무기 모양**: `character3d buildGun` — 무기 id 마다 `GUNS` 모양 함수(부품 `box` · `tube` · `rod` · 툰 재질만 — 셰이더가 늘지 않는다) · 손에 든 총 `GUN_HOLD` 1.4배(1인칭 손 총은 따로 0.6) · 웍 `buildWok` · 무기를 바꾸면 옛 지오메트리 · 재질을 치운다. 고기 악기 `MEAT_LOOK`(소 · 닭 · 오리) ← `items.ts meatOf`(아이템 uid % 3 · 이름 `baseName` "닭고기 바이올린") ← 렌더러 `updateRig` 가 `p.equip[0]` 으로. 확인 페이지 `.frames/guns*.html` + `.frames/guns.mjs [top|side|char|meat]`(이 PC 에만 — 개발 서버가 .frames 의 html 을 캐시하므로 고치면 이름을 바꿔 연다).
- **배포를 빌드 · 올리기만으로(2026-10-24 사용자: "PC 에서 진행하고 깃허브에는 올리는 것만") — 아직 못 올림**: 바꾼 deploy.yml(단위 · 화면 시험은 `workflow_dispatch` 의 `check` 를 켤 때만)은 로컬 가지 `ci-fast` 에 있다. 이 PC 의 gh 토큰에 `workflow` 권한이 없어 워크플로 파일을 푸시하면 거절된다 — 사용자가 `gh auth refresh -h github.com -s workflow`(브라우저 로그인)로 권한을 주면 `git cherry-pick ci-fast` 후 푸시. 그 뒤로는 푸시 전 이 PC 시험이 유일한 관문이다.
- **멈춘 자리**: v1.10.19 까지 main 에 올렸다(`gh run list -L 3`). 패치 플레이 영상(다시 뜬 것)은 `docs/img/patch-2026-10-24/patch_1024_play(_hq).webm` · 공지는 `docs/공지글-모음.md` 맨 위 6차(짧게). 다음 세션은 사용자의 새 요청을 받는다.
- **v1.10.17(사용자: "3인칭에서 캐릭터가 혼자 몹 쪽으로 뒤돈다")**: `renderer3d fpsAim` — 괴물 후보는 시선 앞쪽 반평면 + `AIM_CONE`(0.45 rad) 안만 · 하늘을 보면(카메라 방향 y > -0.02) 시선 쪽 멀리 · 땅에 맞은 자리가 2칸 안이면 2칸 앞. 예전에는 어깨 너머 카메라라 캐릭터 옆 · 뒤 괴물이 화면 가운데를 덮으면 그쪽을 겨눴다(169°). `tools/uitest.mjs` 시련 지역에서 곁 · 뒤 괴물로 30° 안인지 본다(예전 코드면 실패함을 확인). 정조준(1인칭) 때 내 총알 꼬리는 눈앞 1.5칸을 비운다(`updateBullets` — 화면 구석에서 띠가 뻗어 보였다).
- **공지 문체(2026-10-24 사용자: "너무 AI 가 쓴 글 같다 — '상점 UI 를 개선했습니다' 정도로 간단하게")**: 업데이트 공지는 바뀐 것 이름만 한 줄씩 · 묶음 · 부제 · 설명 없이(공지글-모음 "쓰는 법" 맨 위 · 6차가 기준).
- **v1.10.15(사용자 요청 셋)**: 스위치 줄 `.swcol`(session — 퀘스트 칸 아래 끝 `renderer.hud.d4.trackerBottom` 을 따라 `top` · RenderOptions `belowTracker` 만큼 퀘스트 줄을 덜 쓴다) · 스킬 단축창 판 +10px · 글자 맞춤(d4hud drawBottom) · 경험치 띠 8px.
- **v1.10.16(사용자: 1인칭이 낮고 좁다 → 배틀그라운드처럼)**: 시점 이름은 "3인칭"(내부 이름은 그대로 `fps` · `fpsPlayer`). 렌더러 3인칭 카메라 `TPP_DIST` 3.2 · `TPP_SIDE` 0.6 · 머리 위 0.45 · 벽 검사 둘레 0.4칸 · `fpsFirst`(정조준 = 1인칭 — 내 몸 숨김 · 손에 든 총) · `tppDist` 1.1 아래면 내 몸 숨김. 입력은 화면 가운데 자리로 겨눈다(`fpsAim` → 각). 창을 닫으면 `syncUi` · `hideOverlay` 가 `lockPointer`(Promise 거절은 삼킨다) · 풀려 있으면 조준점이 커서 자리. 확인 `.frames/fpsview.mjs` · `.frames/relock.mjs`.
- **이어받는 세션이 알아야 할 것**: ① 요청 하나가 끝나면 검증(시험 · `tsc` · `uicheck` 1920 먼저 → 여섯 크기 0건 · 빌드 · `uitest` — 빌드 → `npx vite preview --port 4173`) 뒤 **묻지 말고** 판 번호(package.json · package-lock 두 곳 · CHANGELOG 맨 위)를 올려 커밋 · 푸시(= 배포). ② 개발 서버는 `npx vite --port 5173 --strictPort` — 이 환경의 백그라운드 명령은 2시간에 꺼지니 오래 걸릴 일(영상) 전에 새로 띄운다. ③ 브라우저 도구는 `tools/gpu.mjs gpuLaunch`(WSL 은 d3d12 GPU — 안 주면 CPU 렌더러라 시간이 몇 배). ④ `pkill -f '…vite preview…'` 는 제 셸 명령줄까지 잡아 셸이 죽는다(종료 코드 144) — `ps … | awk` 로 pid 를 골라 끈다.
- **패치 플레이 영상(2026-10-24 — 세 번째 · v1.10.20)**: 사용자: "침착란은 공속이 느려 끊겨 보인다 · 30fps 이하 느낌 — 최대 프레임 · hq 는 용량 상관없이 제대로" · "참고 영상(덕코프 출시 트레일러 — https://youtu.be/sSlRUkJx050 · 60fps · 글 없음 · 쉬지 않고 쏘며 움직임 · 10 ~ 15초마다 다른 장소)에 비해 긴장감 · 타격감 · 영상미가 떨어진다" → `tools/trailer.js` `mode: 'patch24'`: `FPS` 60(다른 모드는 30) · 고화질 1080p60 VP9 24 Mbps(`webm.js muxWebM` 의 `codec` — `V_VP9`) · 720p60 은 20 MB 안 · SMG 주펄란 · `P24_AREAS` [1, 11, 22, 29] 장면마다 다른 맵 · `kindsOf`(그 맵 괴물 — sim areaKinds 와 같게) · 쿼터뷰 `qmover`(괴물 반대쪽으로 비켜 걷기) · `tap('Space')` 구르기 · `equipWeapon('flamer')` 바꿔 끼기 · 마지막 Q · E · R. `god` 은 P24 면 체력 45% 아래로만 막는다(맞으면 실제로 줄어듦 · 괴물 공격력 그대로) · `punch` · `kick` 은 남긴다(흔들림 `shake` 는 0). 3인칭 조준 `tppAimer` 의 한 장 회전량은 `30 / FPS` 배. 나오는 것 `docs/img/patch-2026-10-24/patch_1024_play.webm`(720p60 · 16.8 MB) · `_hq.webm`(1080p60 VP9 · 131 MB) — 52.9초 · 4분쯤 걸린다. 확인 `.frames/vidcheck.mjs`(VP9 · 60fps 도 읽는다) · 참고 영상 장면 뽑기 `.frames/refsheet.mjs`(탐색이 안 되는 파일이라 재생하며 뽑는다 — 이 PC 에만).
  - **버벅임 원인 · 고침**: 녹화 루프가 인코더가 밀릴 때(8장)만 쉬어, 그 사이 장들이 같은 그림으로 담겼다(정적인 장면에서 8 ~ 9장마다 한 번만 움직임 · 움직임이 많은 장면은 덜 티 남). 이제 장마다 `setTimeout 0` 으로 한 번 쉰다 — 모든 영상 모드에 해당. 확인은 `.frames/vidcheck.mjs <webm>`(이 PC 에만 — 장마다 앞 장과의 차이 · 초마다 멈춘 장 수 · `DUMP=장번호,…` 사진 · `GRID=시작-끝` 화면 칸별 변화).
  - 짧게 확인: `MODE=patch24 MAXSEC=12 OUTDIR=patch-0000-1 node tools/patchvideo.mjs`(docs/img/patch-0000-1 — 이름은 patch- · release- + 숫자만 받는다) · `DIAG=3`(녹화 없이 장마다 판 틱 · 봇 · 카메라). 녹화 중에는 src 를 고치지 말 것(개발 서버가 다시 불러온다).

- 사용자 요청 넷(순서대로): ⓐ 타격감(덕코프 영상 참고 — 에임 효과 · 타격음 · 체력 게이지) ⓑ 신화가 전설보다 낮게 재지는 "좋은 장비 끼기" · 아이템 레벨 올릴 수단 · 강화한 것을 재료로 쓰면 더 좋아야 하지 않나 — 검토해서 아이템 개선 ⓒ 🌙 ↔ ☀ 단추가 바꾸는 단추인지 상태 표시인지 모르겠다 → 슬라이더나 누가 봐도 바꾸는 단추로 ⓓ 후원 이벤트 창 글씨 크기 · 정렬 · 자간(폰으로 보는 시청자). 그 뒤 지난 ⑥ 쿼터뷰 ↔ 1인칭 검토.
- **ⓐ 끝(v1.10.8)**: 참고 영상은 `yt-dlp`(pipx · `--js-runtimes node:~/work/node/bin/node` 를 줘야 형식이 나온다)로 받아 크롬으로 장면을 뽑아 봤다(ffmpeg 없음 — 스크래치 도구는 git 밖). 히트마커 `hud.ts slashes`(두 줄 · 빛 번짐 · 어두운 테두리 · 반동) · 처치 X `renderer3d drawKillXs`(`KILLX_LIFE`) · 체력 잔상 `render/hpGhost.ts`(열쇠마다 — 칸마다 열쇠를 따로: m · top · orb · party · head. 같은 사람을 다른 값으로 부르면 매 프레임 번쩍인다) · 확인음 `sfx.ts hitTick` · 처치 `killThump`. 확인: `.frames/hitfx.mjs [dark|bright] [캐릭터]`(이 PC 에만 — 가까운 괴물을 겨눠 쏘며 조준점 둘레를 찍는다 · `ORB_ONLY=1` 은 체력 구슬만).
- **ⓑ 끝(v1.10.9)**: `itemScore`(items.ts) = 옵션 값 ÷ per + 기본 피해 ÷ 0.8 + 기본 방어 ÷ 0.25 를 부위마다 `SCORE_FIT`(평균 전설 = a × 레벨 + b — `.frames/scorefit.ts` 로 부위마다 수천 개 굴려 맞춤)로 "레벨 + 6" 눈금에. 옵션 · 등급 · 균형을 바꾸면 다시 맞춘다(시험 itemlevel.test.ts 가 평균 전설 30 = 34.5 ~ 37.5 를 본다). 레벨 올리기 `CMD_RELEVEL`(35 — 대장장이 · `relevelTo` = 레벨 + 난이도 lvl · `relevelPrice` · `relevel`). 강화 이어받기 `upgradeResult` · `upgradeMaterials`(이어받을 것 하나를 앞으로 — 한 단계 위면 아낀다) · 벼리기는 sim 에서 `carry`.
  - 대장장이 창 = 모루 하나(사용자: "하나를 끌고 와서 강화 — 어떤 걸 강화하는지 명확하지 않다"): `TownPanel.smithUid` · `pickSmith(uid)` ← 가방 창 `Inventory.onSmith`(BagMode `'smith'` — 가방 · 장비 칸 클릭 · 끌어다 놓기). 대장장이 창 뿌리가 `data-drop="smith"`. 장비 칸도 `makeDraggable`(DragFrom `'eq'` — 가방에 놓으면 벗기). dockBag 이 대장장이도 가방을 같이 연다. uicheck 장면 '대장장이 · 모루에 올림'. 확인 `.frames/smithui.mjs`(끌어다 놓기 · 레벨 올리기).
- **ⓒ ⓓ 끝 + 잡템만 팔기(v1.10.10)**: 스위치 `session.syncSkinBtn`(처음 한 번 틀을 만들고 class `on` 만 바꿔 손잡이가 미끄러진다 · style.css `.skin-sw`). 후원 표 `.dontable` 묶음(style.css "폰으로 보는 시청자도 읽게") · `drawDonTable` 의 맞춤(`fit` — 체력 오브 앞 · 화면 60% · 하한 0.75). 확인 `.frames/hudui.mjs [WxH]`(stream.tried 로 표를 띄운다). 잡템 단추 `.sell-junk`.
- **⑥ 끝(v1.10.11 — 쿼터뷰 ↔ 1인칭)**: 판은 `analog`(|mx|·|my| > 1 = ×100 방향 → 길이 1 · 이동 · 구르기 — 시험 fpsmove.test.ts). 입력 `LocalInput.fps · yaw · pitch · lockPointer`(포인터 잠금 — mousemove 의 movementX/Y · 잠금이 풀린 채 누르면 다시 가두기만 · WASD 를 시선 기준 ×100). 렌더러 `fpsPlayer · fpsYaw · fpsPitch`(session 이 프레임마다) · `updateCamera` 앞 갈래(눈높이 = 키 × 0.82 · 시야각 72 / 정조준 50 / 조준경 28 · near 0.08 · far 72) · `fpsPrep`(들어갈 때 장면 compileAsync + 텍스처 — 끝날 때까지 쿼터뷰 · setMap 에서 다시) · `fpsAim`(가운데에 걸린 괴물 — 머리 30% 면 가운데 · 몸이면 앞쪽 · 아니면 땅) · `hitDirAngle` · `worldToScreen` 이 카메라 뒤를 화면 밖으로. 세션 `toggleView` · `syncSwitch`(스위치 둘이 같이 쓴다) · `loadViewPref`(skin.ts · brpg.view) · 키 `view`(B — V 는 신호). 확인 `.frames/fpsview.mjs [dark|bright]` · `.frames/fpsperf.mjs`(시점별 프레임 · 들어갈 때 프레임마다 셰이더 수).
  - 남은 것(1인칭): 손에 든 총 · 먼 이름표는 v1.10.14 에 했다. 팔은 없다 · 쿼터뷰용 바닥 길 안내 · 땅 원(예고)이 눈높이에서는 납작하다.
- **최적화(v1.10.12 — 사용자: "전체적인 최적화까지 마무리")**: 괴물 거르기 `monsterView.update(…, inView)` ← 렌더러 `cullFrustum`(지난 프레임 카메라 + 여유 1.5 · 보통 2.5 · 거대 9 — 카메라는 괴물 갱신 뒤에 움직인다). `worldToScreen` · `screenToWorld` 벡터 다시 쓰기 · `uiRects` 0.2초. 계측 도구: 삼각형 나누기 `.frames/tris.mjs [bright|dark] [지역]`(이 PC 에만 — 물체별 삼각형 × 인스턴스). 이 PC 의 화면 간격 95% 33ms 는 WSL d3d12 화면 출력 탓(CPU · GPU 는 2 ~ 3ms · 60Hz 에서 제한기는 건너뛰지 않는다 — 문턱 8.3ms).
  - (v1.10.14) 맵 소품 구역 나누기 `world3d chunkInstances`(buildDark 끝 · 삼각형 2만 넘는 묶음만 · 12칸 · 모래주머니 `bags` · 던전 구조물 `coverMeshes` 는 칸 번호로 붙잡으니 뺀다 — 시험 chunks.test.ts). 1인칭 총 `renderer3d updateViewGun`(`buildGun` 을 내보냄 · 0.6배 · 근접 무기 빼고) · 먼 괴물 이름표 14칸.
  - 쓰러질 때 셰이더(entrycheck 17)는 재질 투명이 아니었다(쓰러뜨려 재 보니 새 셰이더 0 · `.frames/deathcheck.mjs`) — 내 등불이 꺼져 빛 수가 4 · 0 으로 바뀐 몫으로 보인다(덮개 뒤에서는 12 · 16 · 8 만 데운다). 다음 후보: 지역 9 바닥 투명 무늬 하나 · 빛 4 · 0 데우기를 마을에서 마저.

## 🔖 들판 문 · 괴물 · 상자 크기 · 🌙 ↔ ☀ 단추 · 벼리기 장인 · 도박 확률 (2026-10-23 · 원격 개발 PC — v1.10.7 배포 · 남은 것 ⑥)

- **배포**: ① ~ ⑤ 를 v1.10.7 로 올렸다(시험 418 · tsc · 빌드 · uicheck 여섯 크기 0건 · 로컬 uitest 통과 뒤). 사용자 규칙(첫 세션 지시): "끝나는 대로 버전 올려 커밋 · 푸시 — 검증 뒤 묻지 말고 main 푸시(=배포)". 이 PC 는 `gh` 2.45 로그인(goormigrm · `gh auth setup-git` · 토큰 `~/.config/gh/hosts.yml` 평문 600)으로 푸시된다. 배포 확인 `gh run list -L 2`.
- **이 PC 환경**(WSL dev): 저장소 `~/work/bedorage-rpg`(`\\wsl.localhost\Ubuntu-24.04\home\dev\work\bedorage-rpg`) · Node 24 는 `~/work/node/bin`(PATH 앞에 넣는다 — 시스템 node 18 은 npm 이 없다) · Google Chrome · Playwright 크로미움 깔림 · 배포 확인은 `gh run list -L 2`. uicheck 한 바퀴(여섯 크기)가 3분쯤 걸린다(실제 GPU — 아래 tools/gpu.mjs).
- **사용자 규칙(2026-10-23)**: "실제 플레이어는 대부분 1920×1080" → 화면 검사는 **`node tools/uicheck.mjs 1920x1080` 먼저**, `SHOT=1` 사진으로 글씨를 본 뒤 나머지 크기.
- **끝낸 것**(시험 63 파일 418 통과 · `tsc --noEmit` · `npm run build` · uicheck 여섯 크기 0건 · uitest 통과):
  - uicheck 5건 → 0건: 1280×720 에서 가방 머리가 두 줄이 되어(좋은 장비 끼기) 맨 아래 안내 글이 창 밖으로 밀리고 조작 안내 띠에 가려졌다 → `.inv` max-height 의 아래 몫 200 → 160px(스킬 바 위 끝 142px 는 비운다 · style.css 맨 끝). 1280×720 만 다시 돌려 0건.
  - ① 들판 문 → `gateTarget(town, wps)`(world.ts): 이 막에서 웨이포인트를 연 가장 뒤 지역(레벨 기준 · 보스 방 포함 · 길에서 뺀 곳 빼고), 없으면 첫 맵. sim 출구에서 `how: 'wp'` 로 그 웨이포인트 앞에. 이름표 · 작은 지도 글도 그곳 이름, 퀘스트 길 안내는 들판 문이 다른 곳으로 가면 성문으로. **지난 타운 포털**: 웨이포인트를 새로 열 때(`wpFound` — 두 곳에서 쓰던 것을 합침) 그보다 앞 지역(레벨 낮음)에 둔 **내** 포털을 닫는다. 이미 앞서 간 뒤 일부러 뒤에 연 포털은 남는다(연 순간만 본다). 시험 world.test.ts 셋.
  - ② 괴물 그림 1.3배(`MOB_VIEW` — monsters3d viewScale · 보스 방 거대 보스 빼고 · 맞는 크기 r 은 그대로) · 상자(보통 · 금빛 · 저주) 1.45배 · 이름표 높이. 1920 사진(☀ 1 · 🌙 2)으로 봤다.
  - ③ **끝냄(화면 확인함)**: 오른쪽 아래 `#btn-skin`(소리 위 · "🌙 무서운 모드" / "☀ 철면수심 모드" — 지금 분위기) → `session.switchSkin`: setSkin · saveSkinPref · 맵 테마 · 렌더러를 새로 만듦(`makeRenderer(this.renderer)` — **GL 맥락은 넘겨받는다**) · setMap(덮개 → BTN_LOADING) · `prepStarted = false` + 로딩 화면(다음 프레임이 prepareStart) · `CMD_SKIN`(34 — sim 이 `arriveT` 를 지금으로, 들어선 지 12초가 지나도 덮개 동안 보호). **내 화면만** 바뀐다(판은 분위기를 모른다) · 방장이 바꾸면 `cfg.skin` · 방 목록 분위기도. 시험 loading.test.ts 하나.
    - **GL 맥락 넘겨받기**(`new Renderer3D(stage, map, prev)`): 새 맥락이면 셰이더 캐시가 비어 첫 판처럼 다 다시 컴파일했다(6 ~ 8.5초). 앞 렌더러의 재질은 새 렌더러의 덮개가 걷힐 때 `retired.dispose(true)`(keepGl — 맥락 · 캔버스는 남김) — 먼저 치우면 쓰는 재질이 없는 셰이더를 three 가 지운다. HUD 캔버스는 바로 뗀다. 판을 나갈 때의 dispose 는 예전대로 `forceContextLoss`.
    - **덮개 동안 셰이더 여덟 개씩 함께**(`WARM_PAR` — prepStep · `warmBusy`): 하나씩 기다리면 75개 × 60ms. 덮개 밖(마을 미리 준비)은 예전대로 하나씩. 걷힘 조건은 `warmBusy === 0`.
    - 잰 것(이 PC 실제 GPU · `.frames/skinswitch.mjs` · `tools/entrycheck.mjs`): 바꾸기 4번 2 ~ 5.6초 · 무적 90 · 이동 0 ~ 10px(누르기 전 입력 지연) · 캔버스 2 · 오류 0. 지역 1 덮개 ☀ 7.5 → 4.2초 · 🌙 6.7 → 3.9초 · 걷힌 뒤 새 셰이더 48 · 43 → 2 · 0 · 덮개 동안 이동 0 · 맞음 0.
- **이 PC 도구는 실제 GPU 로**(`tools/gpu.mjs gpuLaunch` — entrycheck · perf · uicheck · patchshots · patchvideo): WSL 에서 예전 `--use-angle=d3d11` 은 SwiftShader(CPU)가 잡혀 덮개가 9초(상한)로 나왔다. `/dev/dxg` 가 있으면 `--use-gl=angle --use-angle=gl-egl` + `GALLIUM_DRIVER=d3d12`(RTX 4080 SUPER · 병렬 컴파일 됨). uicheck 여섯 크기 5분 → 3분쯤. uitest 는 일부러 SwiftShader 그대로.
  - ④ **끝냄**: 벼리기 장인 `forger`(브란 · ☀ 조립 박사 브란) — 대장장이 천막 앞 네 칸 곁(캠프 26,8 · 숲 19,8 · 지하도 16,8 · 심연 25,6 — 심연은 25,7 이 포털 25,10 과 3칸이라 world.test 포털 간격 110px 에 걸렸다). 대장장이는 강화만(`CMD_UPGRADE`), 벼리기는 `CMD_FORGE && npc === 'forger'`. town.ts 탭(smithTab · data-stab)을 없앴고 창 폭은 둘 다 `.tp.smith`. 그림 npc3d(보안경 · 집게 · 도가니 — 빛 없이 스스로 빛나는 색) · 초상 · 작은 지도 점 `#7ae0e0` · uicheck 장면 '벼리기 장인' · 플레이 가이드 표.
  - ⑤ **끝냄**: 사용자 "도박꾼: 드롭률에 비해 높은 등급이 너무 쉽게 나온다" → `DROP_TABLE.gamble` [0, 0.55, 0.35, 0.095, 0.005](보스 한 개와 같았다) → [0, 0.8, 0.17, 0.028, 0.002](금빛 상자 쯤). 천장 `GAMBLE_PITY` 30 은 그대로(사용자가 고른 기능) — 천장까지 셈하면 전설 약 10번 → 약 20번에 하나. 시험 items.test.ts 하나.
- **남은 할 일**(사용자 요청 순): ⑥ 쿼터뷰 ↔ 1인칭 검토 · 적용(모드 전환처럼). 끝나면 v1.10.8(package.json · package-lock 두 곳 · CHANGELOG) → uicheck 1920 먼저 · 전체 0건 · 빌드 · `uitest`(빌드 → `npx vite preview --port 4173` — Actions 와 같은 시험) → 커밋 · 푸시 → Actions 확인.

## 🔖 좀비 떼 · 닉네임 · 좋은 장비 끼기 · 방송용 글씨 (2026-10-23 · 노트북 — v1.10.6)

- 자세한 것은 CHANGELOG v1.10.6. **좀비 떼** `HORDE_SIZE` 10 · `HORDE_HP` 1.5 · 종류는 `areaKinds(p.area)`(populate 와 같은 무리) · 레벨 `max(지역, 부른 사람)` + 1 — 다른 소환은 그대로 지역 레벨. `MARCH_SIZE` 24 · 세션 자리 검사(`canRunDonation` size)에 좀비 떼 10.
- **아이템 견주기는 `itemScore`**(items.ts — `gearScore` 의 칸 값). 가방 칸 표 `cmpMark`(inventory.ts — 차이 1 까지 "-") · 좋은 장비 끼기 `CMD_EQUIP_BEST`(33 — 판 명령이라 칸 번호가 밀리지 않는다).
- **방송용 글씨**: 창 크기는 건드리지 않고 글씨만(사용자: GUI 자체는 키우지 말 것). style.css 맨 끝 "방송 화면에서 글씨가 눈에 들어오게" 묶음 · 캔버스 HUD 는 d4hud.ts(아래 가운데 · 추적 칸 `QL_ROW` 20). 남은 포인트 알약은 `.tp-gold .pts.on`. 고치면 `SHOT=1 node tools/uicheck.mjs 1920x1080` 사진을 **확대 없이** 읽히는지 본다.
- **1막 투구 안 나옴 — 버그 아님**(`npx vite-node tools/slotdrops.ts -- seeds=3 min=5`: 1막 아이템 529개 중 투구 22.3% · 부위는 `rollItem` 의 `randInt(0, 5)` 고르게 · 줍기 · 자동 줍기 · 도박 · 벼리기에 부위 거름 없음). 투구 바탕 넷 중 셋이 "두건 · 모자" 라 바닥 이름으로는 투구로 안 보일 수 있다.
- **멈춘 자리(2026-10-23 노트북 — 사용자가 다른 컴퓨터로 옮김)**: v1.10.6 배포가 화면 시험 "설명 풍선이 뜬다"에서 실패했다 — 가방 머리 단추(좋은 장비 끼기 추가)가 1366 창에서 59px 넘쳐 가방 창이 옆으로 굴렀고, 굴림(scroll) 때 풍선을 닫는다. `.bag-h { flex-wrap: wrap }` 로 고쳐 푸시(21e5373 — 배포 결과는 확인 못 함 · `gh run list -L 1`). 그 뒤 uicheck 5건은 1280×720 가방 안내 글이었다 — 위 절에서 고침(배포 성공 확인).
- (위 절로 넘김) 남은 할 일(사용자 요청 순): 마을 가운데 들판 문 → 가장 먼 웨이포인트 지역 · 다음 지역 웨이포인트를 열었으면 타운 포털 닫기 · 상자 · 괴물 기본 크기 키우기 · 오른쪽 아래 단추로 🌙 ↔ ☀ 바꾸기(덮개 · 무적 · 이동 막음) · 강화 · 벼리기 NPC 둘로 · 도박꾼 확률 낮추기 · 쿼터뷰 ↔ 1인칭 바꾸기 검토.

## 🔖 지역을 옮길 때 덮개 동안 멈춤 · 첫 싸움 끊김 · 치지직 작은 창 로그인 (2026-10-23 · 노트북 — v1.10.4 · v1.10.5)

- 사용자: "첫 진입 끊김으로 몬스터가 공격해서 죽을 뻔" · "무적이 문제가 아니라 덮개가 있는 동안은 이동이 안 되게". 자세한 것은 CHANGELOG v1.10.4.
- **덮개 = 판에 알린다**: 덮개(`renderer3d.covering` — 컴파일 · 준비 중)는 내 화면만 덮고 판은 모두가 같이 돈다 → 세션이 덮개 동안 입력을 비우고 `BTN_LOADING`(입력 14번 비트)을 싣는다. 판(`sim.ts`): 무적 붙듦 · `p.cover`(잠든 괴물이 못 알아챔) · `arriveT` 뒤 `ARRIVE_QUIET` 12틱도 못 알아챔 · 따라다니는 봇 · 용병 입력을 비움 · `LOADING_MAX` 12초. 덮개 상한 `HOLD_MAX` 9초는 `LOADING_MAX` 보다 짧아야 한다.
- **셰이더 미리 만들기 규칙**: 컴파일은 실제로 그리는 곳(`post.target`)을 대상으로(`renderer3d.compileAsync`) — 화면에 대고 하면 열쇠가 달라 못 쓴다. 준비 줄 일(`warm`)은 열쇠 `k` 를 들고, 치워진 물체의 일은 열쇠를 돌려준다.
- **확인 도구** `node tools/entrycheck.mjs [bright|dark] [지역]`(개발 서버 5173): 덮개 동안 움직인 거리 0 · 덮개 안 맞음 0 · 걷힐 때 깬 괴물 0, 걷힌 뒤 새 셰이더는 열쇠 차이로 적는다. 노트북에서는 워크스페이스 launch.json `bedorage-rpg-tools`(5173)로 띄운다.
- **v1.10.5**: 남았던 첫 이펙트 끊김의 원인은 첫 타격 때 만들던 바닥 핏자국 묶음(`blood.ts` — 이제 `setMap` 에서 장면에 넣는다) · 법선 없는 이펙트(견본 `warmKit` 에 더함). 덮개는 던전 빛 수(`WARM_HOLD` 12 · 16 · 8)의 데우기만 끝나면 걷힌다(`holdNeeds`). 보스 방 0.17초는 `BOSS=1 node tools/entrycheck.mjs bright 9`(보스 앞 5칸으로 데려가 깨움)로 재현되지 않는다 — 67ms 이하. **새 이펙트 재질을 만들면** entrycheck 의 "새 셰이더를 만든 물체"를 보고 견본에 갈래를 더한다.
- **치지직 로그인은 작은 창**(v1.10.5 — `chzzk.ts startLogin` → `window.open`): 돌아온 작은 창은 `src/entry.ts` 가 알아보고(`brpg.chzzk.popup` = state) code 를 `BroadcastChannel('brpg-chzzk')` 로 넘긴 뒤 닫는다 — 게임(main.ts)은 띄우지 않는다. index.html 의 입구는 `src/entry.ts`.

## 🔖 창 크기 되돌림 · 넘침 검사 · 보스 등장 · 경직 · 즉사기 · 천 원마다 후원 · 용병 값 (2026-10-22 · 메인 PC — v1.10.0)

- v1.9.0 바로 뒤 사용자 요청 열둘 — 자세한 것은 CHANGELOG v1.10.0.
- **v1.10.3**: 처음 로비에 온 사람에게 한 번 치지직 연동을 묻는다(`lobby.ts askCzOnce` · `brpg.czAsked` · 로그인했거나 `?shot=1` 이면 안 묻는다 — 사용자: "아예 모르고 플레이하더라"). **첫 배포 공지**(새로 올리는 곳 — 파일당 20 MB · webm 여러 개)는 `docs/공지글-모음.md` 맨 위 · 첨부는 한 편짜리 소개 영상 `docs/img/release-2026-10-22/intro_{bright,dark}.webm`(49초 · 18.9 MB — `MODE=trailer PART=3 DIR=release-2026-10-22 [SKIN=dark] node tools/patchvideo.mjs`) + 썸네일 `thumbnail.jpg`(☀ 영상 첫 화면). **보스 경직 · 즉사기 · 등장 장면은 어떤 영상에도 넣지 않는다**(사용자: "영상으로 먼저 봐 버리면 게임의 흥미가 떨어진다") — 공지 본문에서도 뺐다.
- **v1.10.2**: 가방이 열리면 다른 창은 왼쪽으로 비킨다(`:has` · `--inv-w`) · 가방은 열 때마다 정렬 · 끄는 아이템의 장비 칸 테두리 · 스킬 창 큰 ＋ · 한 줄 설명(`skilltree.ts SHORT` — 새 스킬을 더하면 여기도) · 길 안내 점은 지역마다 한 번 정해 고정(`navPath`).
- **가방 창만은 크게**(v1.10.1 — 사용자: "정렬 · 칸 늘리기 단추가 너무 작다 · 가방 창 자체를 더 키워도"): 560 ~ 780px(46vw) · 칸 66px · 단추 15px — style.css 맨 끝 묶음.
- **창 크기는 원래대로**(사용자: "기본 해상도 자체를 줄인 느낌 — GUI 크기 자체는 원래대로"): `--uiz` 는 작게 · 보통 1 · 크게만 1.15 · HUD 0.85 / 1 / 1.2. 글씨 하한 12px · 짧은 글은 남겼다. **다시 창을 크게 키우자고 하지 말 것.**
- **칸 넘침 · 겹침은 `node tools/uicheck.mjs [WxH …]` 로 본다**(사용자: "적어도 칸을 튀어나오거나 겹쳐서 안 보이는 건 없게"): 여섯 화면 크기 × 장면 열일곱 · 자기 시험 · 0건이어야 한다. UI 를 고치면 돌린다(`SHOT=1` 이면 `.frames/shots/ui-*.png`).
- **보스**: 깨는 틱에 `bossCut`(sim — 다른 괴물 `hold` 2.2초 · 렌더러는 이 이벤트로 카메라 · 안개 걷기 · 빛 2.4배 · 등장 대사 `BOSS_HELLO` + `voice/boss_<번호>_in(_b).wav`). 경직 `STAGGER_HP` 0.6 · 즉사기 12초 · 32 / 26 / 22초 · `GIANT_HP` 1.2 — `tools/bossfight.ts` 가 경직 · 즉사기 횟수를 적는다(4인 · 사람 수준: 경직 0.5 ~ 1 · 즉사기 2 ~ 2.8 · 4막 1/4 판 · 잘 피하면 4/4).
- **즉사기는 구르기로 못 피한다** — 구르기 무적 몫은 `PlayerState.rollInv` 로 따로 센다(`killOutright` 는 그보다 긴 무적만 봐준다). 새 무적을 만들 때 `invuln` 만 늘리면 즉사기도 버틴다(의도한 것만).
- **후원**: 1천 좀비 떼 · 2천 흔들림 · 3천 정예 · 4천 거꾸로(5초) · 5천 막 보스 · 6천 총잡이 여섯 · 7천 중간보스(호위 다섯) · 8천 시야 축소(20초) · 9천 대행진 · 1만 봉인 · 2만 광폭화 · 3만 지옥문. 이벤트 번호 16 이상은 `CMD_DONATE_HI`(arg 한 바이트) — 새 이벤트는 번호 17 부터.
- **남은 괴물 몰려오기** `rushLeft`(25%) · **용병 값** `mercPrice(level, have)` · 시청자 난입은 용병 자리로(`joinSeat`) · **자동 줍기** 처음 희귀 이상 · 길 안내는 점 · 엔딩 크레딧 맨 위 **구르미소미(제작 · 기획 · 개발 · 유지보수 — 1인 개발)**.
- **패치 영상**(사용자: "오늘 업데이트 내역이 잘 보이게 동영상으로도 — 오프닝 · 엔딩 빼고 · 1개 · 화질 좋게"): `node tools/patchvideo.mjs` → `docs/img/patch-2026-10-22/patchnote.webm`(☀ 52초 · 160 MB) · `SKIN=dark` → `patchnote_dark.webm`(🌙 49초 · 151 MB — 🌙 스크린샷 `*_dark.png`) · 1080 · 24 Mbps. `tools/trailer.js` `mode: 'notes'` — 창은 HTML 이라 영상에 안 담겨 그날 스크린샷(`SLIDE_FILES` · `NOTES_DIR`)을 화면 가득 다가가며 · 나머지는 실제 플레이(`notesScenes`). 다음 패치 영상은 이 둘과 장면을 그날 것으로 바꾼다. 즉사기는 보이지 않는다(스포일러). 녹화 중에는 코드 파일을 고치지 말 것.
- 배운 것: 4인 방에서 용병이 자리를 다 채우면 방 목록이 '정원 참'이 되고 난입도 막혔다 · 용병이 있는 판에 난입한 사람은 용병 자리 입력을 기다려 방을 세웠다(둘 다 고침). prettier 는 이 저장소에 맞춰져 있지 않다 — 파일에 돌리지 말 것(전체가 다시 줄 바뀐다). 헤드리스 녹화에서 큰 영상을 한 번에 `/__save` 로 보내면 Playwright 가 요청 본문을 통째로 받다 512 MB 문자열 한도로 죽었다 → 16 MB 조각(`&append=1`).

## 🔖 큰 글씨 · 최적화 · 난이도 · 길 안내 · 용병 셋 (2026-10-22 · 메인 PC — v1.9.0)

- 사용자 요청 열여섯 + "기본 난이도 20~30% 올려" — 자세한 것은 CHANGELOG v1.9.0. **가장 중요한 것은 글씨**("40세 아저씨가 하는 게임 — 크고 간결하게").
- **글씨**: 창 배율 `--uiz`(`settings.ts uiZoom · applyUiZoom`)를 `.game-ui` · `.game-load` · `.lobby > :not(canvas)` · 새 판 띠에 CSS `zoom` 으로 건다 — v1.9.0 은 1 ~ 1.7(창 높이 / 800)이었고 **v1.10.0 에서 작게 · 보통 1 · 크게 1.15 로 되돌렸다**(위).
  - ⚠ **확대된 안에서는 vw · vh 도 커진다** — 새 CSS 에서 vw · vh 를 쓰면 `calc(Nvw / var(--z, 1))`. 화면 아래 스킬 바는 캔버스(확대 밖)라, 창 높이 상한은 `calc(100% - 위 - 200px / var(--z, 1))` 꼴(가방 창).
  - 글을 더할 때는 **짧게** — 조작 안내는 한 줄(키 8개) · 0 인 능력치는 감춘다 · 촌장 창은 할 일 · 보상 한 줄(대사는 J 기록).
- **최적화**(🌙 · ☀ 모두 60fps — 아래 "그래픽 · 성능" 의 새 규칙 넷): 빈 괴물 메시 숨김 · 빛 수 내려갈 때 1초 늦게 · 인스턴스 몫 그림자 깊이 재질 · 후처리 MSAA → FXAA. 계측은 `node tools/perf.mjs [bright|dark] [지역…] [prof=1 | why=1 | exp=1]`.
- **난이도**: 보통 `TIERS[0]` hp 1.2 · pow 0.94. 총소리 16칸 · 탱커 어그로 3초. 봇 캠페인 — 혼자 죽음 26.5 → 43 · 4인 0 → 0.5.
- **길 · 퀘스트**: 바닥 금빛 화살표(`drawFloorNav` — 퀘스트 목표 · 괴물 비우기면 `forwardExit`) · 들어서면 웨이포인트 · 깬 막 잠금(`actLocked` — 촌장 · 웨이포인트 · 퀘스트 맡기) · 촌장 모두 받기(`QUEST_ALL` 99).
- **용병**: 빈 자리마다 · `botSheet` 로 내 레벨 · 장비 수준 · 능력치 · 스킬 · 이름은 고용 때 다시 짓는다(`computeNames` — `merc >= 0` 이면 캐릭터 이름). **음성 대화는 뺐다**(`net/voice.ts` 지움) — 다시 넣지 말 것.
- **후원 처음 금액** 1천 ~ 5천(괴물) · 1만 봉인 · 2만 광폭화 · 3만 지옥문 · !응원 1천 · 2천 · 3천 · 5천. 예전 처음 값 저장은 `stream.ts OLD_DEFAULTS · OLD_CHEERS` 가 새 값으로 바꾼다.
- **패치 영상 대신 스크린샷**: `node tools/patchshots.mjs` → `docs/img/patch-<날짜>/` 아홉 장(`qa` 를 앞에 붙이면 `.frames/shots/qa-*` 확인용 · 장면 이름을 붙이면 그것만). 공지 5차 첨부.
- 배운 것: playwright 가 받은 크로미움은 이 PC 에서 `spawn UNKNOWN` — **깔린 Chrome**(`channel: 'chrome'`)으로 띄운다. 앱 안 브라우저 패널은 창이 화면에 없으면 배경 페이지라 rAF · 시간 수치를 믿을 수 없다. 첫 판 소개 글(시작하기)이 덮인 채로 재면 그 창까지 그린다 — 도구는 닫고 시작한다.

## 🔖 같은 날 투기장 시작 · 던전 구조물 (2026-10-17 · 메인 PC — v1.7.7 · v1.7.8)

- v1.7.7 사용자: "투기장 방에서 혼자 빈 자리 봇으로 채우기 하고 준비해도 시작을 안 한다". 투기장은 사람 둘을 요구했다 — 봇 채우기면 혼자도 시작(`room.ts arenaStartBlock` · 시작과 안내가 같은 규칙) · 못 시작하면 까닭 안내 · 팀전 빈 자리는 사람이 적은 팀(`seatTeam`).
- v1.7.8 사용자: "덕의 모래주머니처럼 — 붙으면 나는 안 맞고 상대를 쏘고, 멀리서 쏘면 부서지다 없어지고, 헤드샷이면 통과. 던전의 벽이 아닌 구조물(선물 상자 같은 것)은 모양은 그대로 모래주머니처럼". → 던전 지역 맵(`world.ts buildAreaMap` — 마을 빼고)에 `GameMap.crateIdx` 를 켜면 상자 타일이 모래주머니 규칙(`map.ts rayCast` · `nearSandbag`)을 따른다.
  - 내구도는 **지역별 · 판 내내**: `GameState.cover[지역][타일] = 남은 ‰`(0 = 부서짐). 깎기 `sim damageCover`(플레이어 탄 · 괴물 탄 — 240 × 지역 레벨 체력 배율) · 타일 맞추기 `syncCover`(`ensureArea` 에서 매 틱 — 재접속 · 리싱크로 맵을 새로 만들어도 맞다). 헤드샷 넘김 = `aimsAtHead` 에 던전 치명타 대상(`critMon`)을 더했다.
  - 그림: `world3d coverParts` — 구조물 조각을 인스턴스 자리로 타일마다 묶어 깎이면 어둡게 · 부서지면 숨긴다(`breakSandbag` · `setSandbagHealth` 가 둘 다 처리). 렌더러 `updateSandbags` 가 판의 `cover` 를 보고 맞춘다(리싱크 뒤에도).
  - 고르지 않은 것: ☀ 랜드마크(미끄럼틀 · 정글짐 — 벽 덩어리)와 벽은 그대로(시야를 가리는 벽이라 부수면 맵이 바뀐다) · 투기장 · 마을 상자도 그대로.
  - v1.8.0: 🌙 안개 덮개(`vision.ts` — 타일마다 네모)가 부서진 자리에 남던 것 → 부서지면 `refreshStructures` 로 다시 만든다(`break` 이벤트 · `updateSandbags`).
- 배운 것: `TaskStop` 으로 백그라운드 vite 를 멈춰도 node 가 남아 포트 · 폴더를 잡는다 → `Get-CimInstance Win32_Process` 로 명령줄을 보고 `Stop-Process`. 숨은 창에서는 화면 크기가 0 이라 마우스 조준이 안 된다 — 확인할 때는 `renderer.aimPoint` 를 잠깐 바꿔 겨눈다.

## 🔖 같은 날 세이브 칸 셋 (2026-10-17 · 메인 PC — v1.7.6)

- 사용자: "캐릭터를 30레벨 다 찍고 나면 다시 1레벨부터 친구랑 하고 싶을 수도 있는데 방법이 없다 — 세이브 내보내기 · 가져오기 말고 3개의 슬롯을 주거나". → **세이브 칸 셋**: 칸마다 캐릭터 열둘 · 보관함이 따로(`save.ts SAVE_SLOTS` · `activeSlot` · `setActiveSlot` · `slotSummary` · `clearSlot`). 칸 1 은 옛 열쇠(`brpg.save.v1`) 그대로라 예전 세이브가 칸 1 이 된다 · 칸 2 · 3 은 `.s2` · `.s3`(백업 `.bak` · IndexedDB 거울도 칸마다).
- 로비 세이브 단추 아래 칸 단추(가장 높은 캐릭터 · 레벨 · 키운 수) · **칸 비우기**(두 번 — 바로 앞 세이브는 `.bak` 에 한 벌). 방 안에서는 바꾸지 않는다. 내보내기 · 가져오기는 고른 칸(파일 이름에 `-slot2`). 판은 **판을 연 때의 칸**에 적는다(`Session.saveSlot`).
- 고르지 않은 것: 캐릭터마다 칸(같은 캐릭터 둘)은 하지 않았다 — 칸 전체를 나누는 쪽이 보관함까지 깨끗하게 새로 시작된다(1레벨에 30레벨 장비를 바로 꺼내 쓰지 않게).

## 🔖 같은 날 "권고대로 끝까지" 인계 (2026-10-17 · 메인 PC — v1.6.8 ~ v1.7.4)

> 사용자: "남은 작업은 검토 끝났으니 권고 결정사항대로 결정하고, 질문 · 멈춤 없이 계속 진행". 그래서 HANDOVER 다음 할 일 중 **사람 없이 할 수 있는 것**을 다 했다. 남은 것은 사람의 플레이 · 방송 · 다른 PC 확인과 의견이 필요한 것뿐(다음 할 일 0 · 1 · 3 · 4 · 5 · 8).

- v1.6.9 **퀘스트 전설 보상 부위 고르기 · 상인 10분 재입고** · v1.7.1 창 다듬기(작은 창) · v1.7.2 안내(로딩 도움말 · 플레이 가이드). ❌ **v1.6.8 방송 개선 여섯 · v1.7.0 소켓 · 룬(v1.7.3 보호 포함)은 v1.7.4 에서 뺐다**(2026-10-17 사용자: "소켓, 룬, 방송 개선 여섯은 하지 않을 거야") — 다시 제안하지 말 것.
- 투기장 수치는 v1.7.5 에서 맞췄다(사용자: "나머지는 개발 진행"). 시련 밸런스는 하지 않는다(사용자가 뺐다).
- 확인 요령: 개발 서버는 작업 폴더마다 `vite.<이름>.config.ts`(커밋 안 함 — `cacheDir` 를 scratchpad 로 · 다른 포트)로 띄운다 — 원래 폴더 `node_modules/.vite` 를 건드리지 않게. 숨은 창에서 긴 기다림은 `setTimeout` 대신 MessageChannel 로(타이머가 늦어진다) · 한 번의 `javascript_tool` 은 45초 안에. 창(HTML)은 1024 × 768 · 1280 × 720 둘 다 본다. 실제 화면 오래 돌리기: `?autopilot=1` + 지역 순간 이동 + 오류 모으기(12지역 0건).
- 배운 것: 파이썬 고치기 스크립트 다음 줄에 `git add` 를 `&&` 없이 이으면, 스크립트가 멈춰도 반쯤 고친 채 커밋된다(v1.7.1 에서 한 번 — 바로 뒤 커밋으로 채웠다). package-lock 에는 같은 판 번호 글자가 의존성에도 있을 수 있다 — 맨 위 두 줄(3 · 9행)만 바꾼다.

## 🔖 같은 날 총잡이 인계 (2026-10-17 · 메인 PC — v1.6.7 · 총 쏘는 괴물 넷 · 지역 옮길 때 오류 · 봇 머뭇거림)

- 사용자: "몬스터들도 다양한 총을 사용하고 레벨에 맞게 총의 연사속도나 데미지를 조정해서 총 쏘는 몬스터를 추가". 괴물 16 ~ 19: 해골 소총수(1막 · 소총) · 사냥꾼 구울(2막 · 산탄 다섯) · 지하도 경비병(3막 · 기관단총 끊어 쏘기) · 심연 저격수(4막 · 저격) — ☀ 물총 진행요원 넷.
- **총은 `MonsterDef.gun`**(`weapon` 소리 · `pellets` 산탄 · `spread` · `burst` · `gap`) — `attack: 'ranged'` 위에 얹었다(sim `resolveAttack` 의 ranged 갈래). 연발은 예고 없이 `MS_WINDUP` 에 머물며 gap 틱마다(`Monster.burst` 남은 발). 레벨: `gunCooldown`(30레벨 1.5배 빠르게) · `gunBurst`(gap 이 있는 총은 12레벨마다 +1) · 피해는 levelPow 그대로.
- 모습은 있는 모델을 다시 쓴다(`monsterModels` 16 ~ 19 · 방패병 칼은 `hide`). 총 부품은 도형(`monsters3d gunPart`)을 `MODEL_EXTRAS` · `CUTE_EXTRAS` 로 손 · 가슴 뼈에 붙인다 — 자리 = 뼈 첫 자리(`__bd.mv().models[k].baked.anchorRest`) − 부품 자세 × s. `rx` 는 쉴 때 총구 방향(해골은 아래 → 권총 쏘기 동작이 팔을 들면 앞 · 구울 · 진행요원은 앞 그대로). 확인은 개발 서버에서 괴물을 사람 곁에 세우고(`makeMonster` · `m.st = 2` · `m.t` 를 계속 작게) `/__shot` 으로 캔버스를 떠서 본다.
- **"isReady" 오류**: three 의 `compileAsync` 가 도는 동안 그 재질을 지우면 컴파일 확인(setTimeout)에서 죽는다 — 지울 것은 `renderer3d afterCompiles` 로(지역 바꾸기 · 이웃 지역 버리기 · 괴물 모델 내려놓기 `release(keep, later)` · 끝). 새로 `compileAsync` 를 부르면 꼭 `this.compileAsync`(도는 것을 센다)로.
- **봇**: 표적이 벽에 가려 안 보이면 거리 두기(물러서기 · 옆걸음) 대신 다가간다(`bot.ts`) — 보스 방 고리 벽 너머에서 몇 분씩 머뭇거렸다.

## 🔖 같은 날 밸런스 인계 (2026-10-17 · 메인 PC — v1.6.3 · 정예 넉백 없음 · 체력 ↓ 수 ↑)

- 사용자: "정예 몬스터가 체력은 많은데 넉백이 돼서 근접 탱커는 때리기가 너무 어렵다 — 정예는 넉백이 되지 않도록" · "일반 몬스터들도 체력이 많아서 재미가 없다 — 체력을 줄이되 숫자를 늘리는 방향으로".
- **넉백은 `sim.ts knockMul(m)` 하나로**: 정예(`m.elite` — 우두머리 포함) 0 · 나머지 `1 − knockRes`. 새 넉백을 더하면 꼭 이 함수를 쓴다. 태풍(ZONE_VORTEX)의 끌어당기기는 넉백이 아니다.
- **괴물 체력 · 수는 `monsters.ts MOB_HP`(0.6) · `MOB_COUNT`(1.5)**: 체력은 `dungeon.ts makeMonster`(막 보스 빼고) · 마릿수는 `packMembers`. 졸개 한 마리의 경험치(`xpFor`) · 골드 · 아이템(`sim reward`)은 1/MOB_COUNT 라 벌이 · 레벨 속도는 그대로. 회복 구슬은 한 마리마다 그대로. 다시 조정하면 이 두 수만 바꾸면 된다.
- 계측(4인 · 보통 · 시드 2): 사람 어림 1.77 → 1.70시간 · 쓰러짐 1.0 → 0.5. 화면에 괴물이 1.5배라 폰 · 낮은 PC 의 프레임은 확인하지 못했다(시험의 시뮬 성능 기준은 통과).

## 🔖 같은 날 성능 · 영상 · 공지 인계 (2026-10-17 · 메인 PC — v1.2.1 · v1.5.1 · v1.6.2 · 패치 플레이 영상 · 합친 공지)

> 같은 날 그래픽 세션과 나란히 일했다(그쪽은 옆 작업 폴더 `bedorage-rpg-gfx` → `main`). 이 세션: 성능 · 네트워크(v1.2.1) · 바닥 아이템 이름표(v1.5.1) · v1.6.2 · 영상 · 공지.

- **v1.6.2 NPC 이름표**(사용자: "NPC 와 NPC 의 이름 및 퀘스트 표시의 위치가 맞지 않는다"): 이름표를 맵 y 를 빼서 올리면 쿼터뷰에서는 **오른쪽 위로 비껴 난다** — 화면 위로 올리려면 **높이(worldToScreen 의 y)** 를 쓴다(`renderer3d drawPlaceLabels` 의 `label(x, y, …, h)` · `NPC_LABEL_H`). 돌린 전체 지도(M)도 같다 — 화면 px 로 올린다.
- **완성도 검토**(사용자: "기능 변경은 아니지만 완성도를 높일 부분을 검토해서 수정"): 코드 훑기로 12건 — 정예 · 우두머리 막대 높이 = 모델 배율(`monsters3d viewScale` 하나를 모델과 `monsterTop` 이 같이) · 거대 보스 이름표 118px(위쪽 보스 막대 판 14 ~ 56 아래) · 말풍선은 자리 없으면 이름표 아래 · 피해 숫자 흩어짐은 화면 가로 · 동료 체력 막대가 이름을 따라감 · 후원 중간보스 이름표 · 키 안내는 `keyLabel` · ☀ 업적 · 전설 · 세트 · 깜짝 상자 · 마을 사람 인사 말투(`skinText.ts` · `skin.ts WORDS` · `town.ts LINES`). 검토가 확인하지 못한 것: 투기장 화면 · 폰 · 창 안의 HTML 칸(가방 · 상점 — 앱 창이 가려져 화면으로 못 봤다) → HTML 칸은 v1.7.1 에서 1024 × 768 · 1280 × 720 으로 보고 고쳤다.
- **패치 플레이 영상**: 1편 = 제목이 박힌 고르는 화면(`lobbyPhase` — 검은 데서 열지 않는다 · 제목은 첫 장부터 다 보인다) → 마을(`partTown`) → 전투 → 1 · 2막 보스(여왕을 쓰러뜨리며 끝 — 이 방을 `state.killed` 에 넣어 배너를 막는다) · 2편 = 3막 보스 → 최종 보스(`partFinal`) → 방송 → 상자 → 끝 카드. **마지막으로 뜬 판은 v1.7.9**(사용자: "패치 영상 다시 떠줘" — 탄 꼬리 · 탄피 · 먼지 · 연기가 전투 장면에 보인다) · 36 · 38초. 영상에 보이지 않는 판(방송 설정 · 세이브 칸 · 투기장 · 퀘스트 보상 고르기 · 창 다듬기)은 다시 뜰 필요 없다 — 전투 · 마을 · 보스 방 그림이 바뀌면 다시 뜬다. 총잡이 괴물 모델(16 ~ 19)도 녹화 전에 받는다(`start` 의 `kinds`).
- **합친 공지**(사용자: "10월 7일 이후 ~ 지금까지 업데이트 공지를 하나로 · 최신이 위 · 첨부는 맨 아래"): `docs/공지글-모음.md` 의 **4차 한 장**(v0.99 ~ v1.7.4) — 날짜 묶음 10-17 → 10-09 → 10-08 → 10-07 · 첨부 줄은 장 맨 아래. 예전 4차 · 5차 장은 없앴다(원문은 git 기록). 다른 세션이 판을 올리면 **플레이어가 느끼는 것만** 10-17 묶음에 한두 줄(v1.6.3 전투 · v1.6.9 퀘스트 보상 고르기 · 상인 재입고) — 방송인 설정(v1.6.4 말풍선 양 · 글자 크기)은 "쓰는 법" 대로 넣지 않고, 뺀 기능(소켓 · 룬 · 방송 개선 여섯)은 지웠다.
- 배운 것: ① 그래픽 세션이 효과음 · 그래픽을 올리면 영상은 **pull 한 뒤** 다시 뜬다(영상 소리는 같은 Sfx 를 복제해 그린다). ② 숨은 창에서 `javascript_tool` 한 번이 45초를 넘기면 끊긴다 — 녹화는 `start()` 를 promise 로 띄워 두고 짧게 `status()` 만 본다. ③ 숨은 창 + 직접 `frame()` 돌리기 + 창 보이기를 섞으면 페이지가 버벅여 스크립트가 끊긴다 — `setInterval` 은 찍은 뒤 바로 끈다.

## 🔖 같은 날 그래픽 세션 인계 (2026-10-17 · 메인 PC — ☀ 그래픽 개편 A ~ E 끝 · v1.6.0 배포)

> 사용자: "철면수심전용 버전에서만 그래픽 작업으로 더 낫게 — 맵이나 구조물의 퀄리티를 높이고 싶어" · "three.quarks(이펙트 손맛)도". 계획 · 결과 정본: [docs/철면수심-그래픽-개편-계획.md](docs/철면수심-그래픽-개편-계획.md) (단계마다 "✅ 끝" 절).

- 사용자 결정: 실내 벽 **레고식 블록** · 랜드마크 **코드로 조립** · three.quarks **☀ 🌙 둘 다**(색만 분위기별) · 바닥 · 벽 표 **그대로**.
- **A 색(v1.1.0)**: 누런 바닥의 큰 원인은 **캔버스에 선형 색을 sRGB 처럼 칠한 것**(`world3d.ts paintFloorSteps` · `paintOutside` — ☀ 만 고침) · ☀ 톤 매핑 Neutral(노출 1.2 · 채도 1.02).
- **B 바닥(v1.2.0 · v1.3.0)**: `src/render3d/brightFloor.ts` — 맵 24 곳마다 다른 바닥(`BRIGHT_FLOOR[map.id]` · 띠마다 `paintBrightBand`) + 반복 결 텍스처(`applyGrain`) · 풀은 바깥만 · 작은 꽃.
- **C 벽 · 소품(v1.4.0)**: `src/render3d/brightWalls.ts` — `BRIGHT_WALL`(레고 · 수영장 타일 · 거울 · 생울타리 · 모래성 · 쿠키 · 벌집 기둥 · 쿠션 · 솜사탕 나무 · 젤리 버섯) · `BRIGHT_PROPS`(맵 주제 소품) · `ballTexture`(비치볼 · 농구공) · 대기실 울타리 가로대.
- **D 랜드마크(v1.5.0)**: `src/render3d/brightLandmarks.ts` — 꽉 찬 3 × 2 · 2 × 2 벽 덩어리 자리 안에만(`planLandmarks`) · 종류마다 InstancedMesh 하나(`buildLandmarks`) · 9 맵 15 종.
- **끊김(v1.8.1)**: ⚠ InstancedMesh 는 **쓴 칸만 올린다** — `instanceMatrix.clearUpdateRanges(); addUpdateRange(0, n * 16); needsUpdate = true`(색은 n * 3). 통째로 매 프레임 올리면 윈도우 크롬(ANGLE)이 버퍼 올리기에서 0.15초씩 멈춘다(괴물 부품 168 묶음이 그랬다 — `monsters3d upload`). 끊김을 잴 때는 `S.frame` · `R.draw` · `gl.render` 와 WebGL 호출(`bufferSubData` · `texImage2D` · `getProgramParameter`)을 감싸 프레임마다 쌓아 본다(내장 브라우저 창이 보여야 숫자가 맞다). 지역을 옮기면 덮개(`areaHold`)가 텍스처 올리기 · 남은 준비 줄(`prepStep`)을 끝낼 때까지 쥔다.
- **덕코프식(v1.7.9 — 사용자: "덕코프 모래주머니처럼 · 덕코프 영상처럼 타격감")**: 모래주머니 = 베개 모양 자루 8개 벽돌 쌓기 · 삼베 겉감 · 줄 방향으로 눕힘(`world3d.ts sandbagStackGeometry · sandbagRot`) · 탄이 막힌 자리 = 겉(모래주머니 · 벽 · 구조물 — `renderer3d surfaceAt`)마다 먼지 구름 · 부스러기 · 탄 꼬리(`tracerPool`) · 몽글몽글한 연기(`spritefx uCloud`) · 탄피가 보이게. ⚠ `spawnParticle` 의 크기는 조각 상자(0.1칸)의 **배율**이다(0.5 = 0.05칸).
- **이어서(v1.6.6 — 사용자: "그래픽 4가지 이어서 모두 진행해줘")**: ☀ 보스 방 넷 고리 벽 = 칸마다 주제 조각(`brightLandmarks.ts RING`) · ☀ 투기장 셋 = 밝은 테마로 던전 그리기(`buildDark` — 모래주머니도 여기로 옮겼다) · 근접 초승달 궤적 띠(`renderer3d spawnTrail · shapeTrail`) · 괴물 탄 빛점 궤적(quarks `trail` · `updateShots`). 자세히는 계획서 7.4.
- **E 이펙트(v1.6.0)**: `src/render3d/quarksfx.ts` — `QuarksFx.burst(name, x, y, z, n, {dir, color, speed})` · 프리셋 13 · 묶음 ☀ 2 / 🌙 4 · 입자 2,500 상한. 렌더러가 명중 · 처치 · 총구 · 근접 궤적 · 금화 · 스킬 시전 · 범위 · 보스 예고 · 등장 · 경직 · 폭발에서 부른다.
- 같은 날 다른 세션(쿼터뷰 RPG 게임 개발 계획)이 한 것: v1.2.1 성능 · 네트워크(입력 전용 빠른 채널 · 고주사율 그리기 맞추기) · v1.5.1 바닥 아이템 이름표 · 패치 플레이 영상 네 편 · 합친 업데이트 공지(`docs/공지글-모음.md` 4차) — 그 세션의 인계는 위 블록. 이 세션은 그동안 **옆 작업 폴더(git worktree)** 에서 D · E 를 만들어 `main` 에 바로 올렸다(원래 폴더를 동시에 고치지 않게 — 아래 "작업 · 협업").
- 이 세션에서 배운 것: ① 내장 브라우저 창이 숨겨져 있으면 `requestAnimationFrame` 이 멈춰 **판을 열어도 시작 준비(`prepareStart`)가 안 불린다** → `setInterval(() => __session.frame(performance.now()), 33)` 로 직접 돌린다. ② GPU 시간은 `EXT_disjoint_timer_query_webgl2` 로 `__session.frame()` 한 번을 감싸 잰다(이동 직후 첫 측정은 셰이더 · 텍스처 올리기가 섞여 크게 나온다 · 높은 화질 고정 `__session.applyGfx('high')` → 끝나면 `'auto'`). ③ `TaskStop` 은 셸만 끄고 그 안의 node(vite)는 남긴다 — 포트를 `netstat -ano` 로 보고 명령줄을 확인한 뒤 `Stop-Process`. ④ ☀ 밝은 바닥 위에서는 빛 더하기(Additive)가 하얗게 묻힌다 — ☀ 이펙트 · 범위는 보통 섞기 + 진한 색.

## 프로젝트 한 줄

게임 이름 **배도라지 알PG**(2026-09-24 — 예전 "배도라지RPG". 캐릭터가 계란이라 '알'을 노른자 빛으로 칠한다 · 저장소 · 주소는 `bedorage-rpg` 그대로). 계란이 된 배도라지 크루(○○란)가 어두운 던전을 쓸고 다니는 **쿼터뷰 슈팅 RPG**(디아블로류). 혼자 ~ 최대 4인 협동. 서버 없이 WebRTC P2P(락스텝). GitHub Pages 배포.
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

## 현재 상태 (2026-10-24 · v1.10.19 배포)

> 판 번호마다의 변경은 [CHANGELOG.md](CHANGELOG.md) 가 정본이다(예전에 여기 한 줄로 길게 적던 판 번호 이력은 CHANGELOG 와 겹쳐 지웠다 — 원문은 지난 기록).

- **게임**: 쿼터뷰 슈팅 RPG(PC 는 B 로 3인칭 — 오른쪽 버튼 정조준은 1인칭) · 혼자 ~ 4인 협동(P2P 락스텝 · 봇 · 난입 · 리싱크 · 방장이 나가도 혼자 이어하기) · 4막 이어진 세계(막마다 마을 · 야외 · 던전 · 보스 방 · 웨이포인트 · 타운 포털 · 퀘스트) · 캐릭터 12(○○란 — 탱 3 · 딜 6 · 힐 3 · 스킬 Q · E · R + 트리 · 랭크 5 변형) · 막 보스 넷(패턴 · 즉사기 · 경직) · 괴물 20종(총잡이 넷 포함 — 정예 · 우두머리는 밀리지 않는다) · 투기장(PvP).
- **전리품 · 끝 콘텐츠**: 등급 마법 ~ 신화 · 세트(신화 자리) · 전설 고유 효과 · 벼리기 · 도박 · 보관함(60칸 탭) · 퀘스트 전설 보상 부위 고르기 · 상인 10분 재입고 / 시련(반복 끝 콘텐츠 · ☀ 도전 놀이) · 숙련(레벨 30 뒤) · 저주받은 상자 · 숨은 보물 · 업적 · 통계.
- **방송**: 치지직 채팅 → 괴물 말풍선 · 후원 이벤트 · 응원 · 시청자 이름 괴물 · 방장 강퇴 · 금칙어. 수입이 드러나는 수치는 어디에도 안 보인다(아래 "방송").
- **분위기 둘**: 🌙 공포스러움(실사 괴물 · 어두운 던전 — 처음 그대로) · ☀ 철면수심전용(파스텔 · 귀여운 괴물 · 맵마다 다른 바닥 · 벽 · 랜드마크 · 진한 이펙트). 방장이 방에서 고르고, 게임 중에는 퀘스트 칸 아래 스위치로 내 화면만 바꾼다(`game/skin.ts` · `SessionConfig.skin` · `session.switchSkin`).
- **화면 · 손맛**: 툰 그림체 · 후처리(빛 번짐 · 막마다 색감 · ☀ Neutral / 🌙 ACES) · 스킬 이펙트 37(`skillfx.ts`) + quarks 입자(`quarksfx.ts`) · 자동 화질 · 소리(합성 + Kenney CC0 녹음 45).
- **배포**: GitHub Pages(`main` 푸시 → Actions — 시험 · 빌드 · 화면 시험 `tools/uitest.mjs` 가 통과해야 배포 · 약 3분). 판 번호가 다른 사람끼리는 같은 방에 못 들어간다(새 판 알림 띠 → F5).

## 주의 — 지금도 유효한 규칙

### 작업 · 협업

- 사용자는 단계마다 **커밋 · 푸시 자동**(메모 `feedback-always-commit-push`) · 공지는 짧게(메모 `feedback-announcement-style`) · 공지 게시는 사람이 한다. **공지 문서는 최신 공지가 맨 위 · 본문에 날짜를 적지 않고 · 본문 아래 감사 · 주소 줄(🙏 · 🔗)은 넣지 않는다**(2026-10-20 사용자 — 정본은 `docs/공지글-모음.md` "쓰는 법").
- **영상 · 사진을 뜨면 공지글도 같이 고친다**("첨부 파일" 표 크기 · 길이 · 어느 PC 판 · 그 차수 공지의 "첨부 —" 줄 · 본문) → HANDOVER → 커밋 · 푸시까지 끝내고 보고(2026-10-08 사용자: "공지글도 당연히 업데이트하고 커밋 푸쉬해야지 — 당연한 걸 매번 알려줘야 하니").
- **⚠ 개발 · 시험 중 브라우저 소리는 늘 끈다**(2026-10-08 사용자: "개발 중에 계속 소리 켜는 거 하지 말라고 — 소리가 꼭 필요한 게 아니면 꺼"): 탭을 열자마자 `localStorage.setItem('brpg.muted','1')` + `__session.sfx.setMuted(true)` — 로컬 · 배포 사이트는 저장소가 따로라 출처마다. 소리 상태는 출력 신호(AnalyserNode)로 재고, 켰으면 끝나자마자 끄고 그 탭을 닫는다(`tabs_context` 로 남은 탭 확인 — 배포 사이트 탭을 소리 켠 채 남겨 둔 적이 있다).
- **다른 세션이 이 폴더에서 작업 중이면 옆 작업 폴더(git worktree)에서** 한다(2026-10-17): `git worktree add ../bedorage-rpg-<이름> -b <가지> origin/main` → `npm ci` → 끝나면 `git pull --rebase origin main` 뒤 `git push origin HEAD:main`(원래 폴더 파일은 안 바뀐다 — 그쪽 세션에 pull 하라고 알린다) → 다 쓰면 `git worktree remove` · 가지 삭제. ⚠ 미리보기 도구(`preview_start` name)는 **세션 첫 폴더의 `.claude/launch.json` 만** 읽는다 → 작업 폴더의 개발 서버는 셸 백그라운드로 `npx vite --port 5177 --strictPort` 를 띄우고 `preview_start({ url })` 로 연다(끝나면 "최근 세션 인계" ③ 처럼 node 까지 끈다).
- 같은 폴더를 고치기 전에는 그쪽 세션에 어느 파일을 고칠지 알리고(SendMessage), 커밋할 때는 그 파일만 add 한다.
- 노트북 localhost 금지 그대로 — 영상 뜨기만 예외(끝나면 `preview_stop`).
- **확인은 배포 사이트에서**(2026-09-23 사용자: "노트북 사양이 좋지 않으니 localhost 로 접속하지 말고, 반영한 후에 https://goormigrm.github.io/bedorage-rpg/ 에서 테스트하고, 잘못되면 수정 반영"). 작업 규칙의 3 · 4 는 → 푸시 · 배포 뒤 배포 사이트에서 확인 · 탭 닫기.
  - 노트북 작업 폴더: `C:\Users\tkdrm\Workspace\personal\bedorage-rpg`.
- 소리는 Claude 가 들을 수 없다 — 엔딩 곡 · 저주받은 상자 북소리 · 시련 소리의 느낌은 사용자 확인이 필요하다.
- **녹음 효과음(S4)**: 사용자 허락으로 Kenney CC0 셋을 받아 45개 435 KB 를 넣었다(v0.98.0 — `public/sfx` · `CREDITS.md`). 소리 세기 · 느낌은 사용자 확인이 필요하다(Claude 는 못 듣는다).

### 그래픽 · 성능

- **🌙 공포스러움은 그대로 둔다** — ☀ 그래픽 변경은 늘 `isBright()` 가지(분위기는 렌더러를 만들기 전에 정해지고 판 도중 바뀌지 않는다). quarks 이펙트만 두 분위기 모두(색만 다르게).
- ⚠ `quarksfx.ts` 는 three.quarks 0.17.1 의 **내부 `spawn` 을 직접 부른다**(`shortcut:` 주석 — 공개 API 는 방출기 하나 = 한 자리 · `restart()` 는 남은 입자를 지운다). 판을 올리면 거기부터 확인 · `package.json` 에 정확한 판으로 고정.
- **⚠ 셰이더 컴파일은 비동기로**(2026-10-08 끊김 — CHANGELOG v0.99.3): three 의 `compile` · `compileAsync` 는 **빛은 보이는 것만** 센다(재질은 r185 부터 숨긴 물체까지 훑는다 — 2026-10-22 `WebGLRenderer.compile` 확인). 빛 수가 다른 장면으로 데우려면 그 빛을 그 순간만 `visible = true`. 처음 그려지는 재질(새 괴물 · 새 효과 · 새 지역)은 그 장면에서 동기 컴파일로 수백 ms ~ 1초 멈추고, 락스텝이라 모두가 기다린다. 새 재질을 만들면 `queueWarm` · `compileAsync` 를 거칠 것. 끊김 재기: `new PerformanceObserver(l => …).observe({ type: 'longtask' })` · `renderer.gl.info.programs.length`.
- ✅ **v1.9.0 최적화 규칙** (2026-10-22 — `tools/perf.mjs` 계측: 🌙 CPU 20 ~ 25 → 5 ~ 9ms · GPU 15 ~ 20 → 6.5 ~ 9ms):
  - **비어 있는 InstancedMesh(count 0)는 `visible = false`** — three 는 count 0 이어도 화면 · 그림자 패스마다 셰이더 고르기 · 유니폼 올리기를 한다(괴물 종류 × 부품 150여 개가 헛돌았다). r185 의 `compile()` 은 숨긴 물체의 재질도 컴파일하므로 처음 나올 때 멈칫하지 않는다.
  - **켜진 점광원 수가 바뀌면 빛 받는 재질 모두가 셰이더를 다시 고른다** — `padLights` 가 LIGHT_STEP(4) 배수로 맞추고 내려갈 때는 한 단계까지 1초 늦게(빈 빛 7개). 순간 빛을 새로 만들 때 이것을 거친다.
  - 그림자를 드리우는 InstancedMesh 는 `splitDepth` 가 따로 깊이 재질을 준다(`setMap` · 생성자) — 판 도중 새로 만든 인스턴스 그림자 물체는 `splitDepth(그 물체)` 를 불러 둔다.
  - 후처리 장면 그림은 **MSAA 없음 + 합치기의 FXAA**(`post.ts`). 반정밀 MSAA 4 가 1080p GPU 4.5ms 였다 — 표본 수를 다시 올리지 말 것.
  - 셰이더가 자꾸 바뀌는지는 `node tools/perf.mjs dark 1 why=1`(재질마다 프레임당 횟수 · 까닭), 어디서 시간이 드는지는 `prof=1`, 기능마다 GPU 몫은 `exp=1`(EXP_V=base,post,shadow,msaa4 …).
- 이펙트 재질을 **dispose 하지 말 것** — 그 셰이더를 쓰는 재질이 하나도 안 남으면 three 가 프로그램까지 지워 다음에 다시 컴파일한다(100~150ms). 모아 두었다가 다시 쓴다.
- 프레임 dt 는 음수 금지(session.frame · tick). `Math.pow(x, dt)` 꼴 스무딩은 음수 dt 에서 폭발한다.
- ✅ **최적화 규칙** (v0.49.0 — 계측은 `npx vite-node tools/perf.ts`(sim) · 브라우저 GPU 는 EXT_disjoint_timer_query_webgl2 로 `__session.frame` 을 감싸 잰다(readPixels 동기화는 잡음이 커서 못 쓴다)):
  - **이펙트를 새로 만들 때 도형 · 재질을 매번 만들지 말 것** — 모아 두었다가 다시 쓰거나(ringPool · lightPool · impactPool), 같이 쓰고(dropRes · zoneDisc), 물체마다 만든 재질은 지울 때 dispose. 예전 새는 곳이 총구 섬광 · 고리 · 떨어진 것 · 장판이었다(`gl.info.memory.geometries` 가 싸움 중 계속 늘면 새는 것).
  - 파편은 `spawnParticle`(인스턴스 하나). 순간 빛은 `takeLight` → flashes. 점광원은 16 개 상한(LIGHT_BUDGET) — 넘치면 먼 것부터 꺼진다.
  - 시야 마스크는 `Vision.update`(광선) + `Vision.draw(gl)`(렌더 타깃). 캔버스로 되돌리지 말 것(복사 한 번에 GPU 10ms).
  - 새 실사 모델은 `tools/pack-monsters.py` 의 SPECS 에 `tris`(졸개 3천 안팎 · 보스 5~6천)를 적는다 — 면 줄이기는 tools/simplify.py.
  - 자동 화질은 `session.autoQuality`(상태 `__bd.gfx()`). 가려진 탭 · 미리보기 창에서는 rAF 가 느려 저절로 가장 낮은 단계로 내려간다 — 확인할 때는 설정에서 높게로.
  - 소리: 음원은 `finish()` 로 끝나면 줄을 끊는다. 새 소리를 만들면 반드시 거친다. 끊김은 `__session.sfx.ctx.playbackStats.underrunEvents` 로 센다(크롬).
  - 영상 소리(v0.67.0): 효과음은 CPU 수만큼 시간 조각으로 나눠 동시에 · 배경음과 보스 대사는 따로 한 판 · 마지막에 더해서 압축 한 번(`tools/trailer.js renderAudio`). 조각 앞 2.5초는 가짜 소리판(`dummyAudio`)으로 제한만 맞춘다. 확인만 할 때 `t.start({ noSave: true })`.
  - 보스 난이도는 봇만으로 재지 말 것 — `npx vite-node tools/bossfight.ts -- table=1 seeds=4` 로 **사람 수준**(0.4초 늦게 · 넷에 하나 놓침)까지 본다.
  - 느린 PC: 자동 화질이 가장 낮은 단계 · 화질 "낮게" · 소리 끊김 알림이 잦으면 `sfx.setLite(true)`(가벼운 소리). 새 소리를 만들면 가벼운 소리일 때 덜어낼 곳도 생각한다.
  - 소리 되풀이 제한에 쓰는 시각 필드는 이름을 **`last…`** 로 짓는다 — 소개 영상(tools/trailer.js renderAudio)이 게임에서 복사한 뒤 `last[A-Z]…` · `kindVoice` · `nextIdle` 을 비운다(안 비우면 영상에서 그 소리가 통째로 막힌다 — v0.61.1). 괴물 소리는 남의 소리 몫 밖(`MONSTER_VOICE`).
  - 거대한 보스(v0.60.0): sim 에서 괴물 반지름은 **`bodyR(m)`** 로 읽는다(`MONSTER_LIST[k].r` 을 바로 쓰면 보스 방 보스의 몸이 작게 잡힌다). 격자 조회 여유는 80px 이상. 응원 · 아군 보스는 예전 크기(`isGiant` 가 거른다).
  - 보스 대사(v0.59.0): 소리 파일 `public/voice/boss_<번호>.wav`(tools/bossvoice.ps1 — 윈도 한국어 목소리) + 가공 `sfx.bossLine`(음 내리기 · 겹치기 · 메아리 · 잔향). 대사 글을 바꾸면(`monsters.ts BOSS_PATS.line`) 스크립트의 글도 같이 고치고 다시 돌린다. 영상도 같은 함수를 쓴다(`t.start({ mode: 'ult' })` → boss_voice.webm).
- ✅ **논리 해상도** (v0.48.0 — `hud.ts setViewSize`): 논리 높이는 창 높이 / HUD 크기(0.85 · 1 · 1.2), 720 ~ 1440. 폰은 720 고정. **월드에 묶인 2D 크기**(화면 px 로 월드 넓이를 나타내는 것)를 새로 그리면 `VIEW_K` 를 곱할 것 — HUD 글씨 · 막대는 곱하지 않는다(작아지는 게 목적). 캔버스 배율은 `canvasRatio`(픽셀 상한 GL_PIXELS · HUD_PIXELS). 브라우저 창 크기 흉내(preview resize_window)는 resize 이벤트를 안 보낼 때가 있다 — `window.dispatchEvent(new Event('resize'))`.
- ✅ **범위 색 규칙** (v0.48.0 — renderer3d `ENEMY_AOE` · `ALLY_GOOD` · `ENEMY_BUFF`): 빨강 = 적의 범위 공격 · 초록 = 아군 치유/보호 · 보라 = 적 강화. **초록을 다른 뜻에 쓰지 말 것.** 새 아군 범위 스킬은 sim 에서 `alliesFx`(초록 고리 이벤트)를 쓴다 — 틱마다 도는 곳은 `alliesNear`.
- 후처리 셰이더는 three 가 이미 넣는 uniform 을 다시 선언하면 컴파일이 깨져 화면이 까맣다 — 화면 시험(`tools/uitest.mjs`)이 셰이더 오류도 잡는다.
- **⚠ 넷코드 통로**(2026-10-17 v1.2.1): Trystero 는 피어마다 데이터 채널을 하나(순서 보장 · 재전송)만 연다 — 입력은 `room.ts` 의 **입력 전용 빠른 채널**(`FAST_IN_ID` 77 · `negotiated` · `ordered:false` · `maxRetransmits:0`)로 보낸다. 큰 메시지(리싱크 · 난입 판 약 200 KB)는 원래 줄. 무료 중계 서버는 1초 60번 × 4명 입력을 무료 한도로 감당 못 하고 지연만 늘린다 — P2P 유지. 고주사율 모니터는 `shouldDraw` 로 60 ~ 72fps 로 그린다(메인 스레드가 틱 · 입력 처리를 늦추지 않게).
- ⚠ `moveCircle` 로 **멀리 한 번에** 옮기는 곳(소환 · 구슬 · 보스 패턴)은 이제 잘게 나눠 걷는다 — 새로 쓸 때도 이것을 쓰면 벽을 넘지 않는다. 한 걸음씩 나누지 않는 좌표 대입(`m.x = …`)은 벽 검사가 없다.

### 패치 플레이 영상 · 공지 · 사진

- **2026-10-22 부터 영상은 다시 뜨지 않는다**(사용자: "이제 트레일러 영상은 다시 안 찍어도 되고 패치 내역이 잘 보이게 스크린샷을 찍어줘" · "기존 것과 헷갈리지 않게 별도 폴더") — 패치를 하면 `node tools/patchshots.mjs` 로 `docs/img/patch-<날짜>/` 에 바뀐 창 · 화면을 한 장씩 뜨고 공지 첨부 줄 · 첨부 표에 적는다. 아래 영상 규칙은 사용자가 다시 찍으라고 할 때만.
- **패치 플레이 영상** 규칙(메모 `trailer-rules` — 2026-10-17 사용자: "트레일러 영상도 이제 이름을 패치 플레이 영상으로 · 어두운 버전, 철면수심 버전 2개 다"): **🌙 공포스러움 · ☀ 철면수심전용 두 벌** · **두 편 · 편마다 40초 이하 · 두 편 길이를 고르게**(2026-10-17 사용자: "첫 장면이 썸네일이 돼서 적절치 않아 · 캐릭터 선택 및 마을 장면도 추가 · 2개의 영상 길이를 적절히 분배" → 1편 제목이 박힌 캐릭터 고르는 화면 → 마을 → 전투 → 1 · 2막 보스 · 2편 3막 보스 → 최종 보스 → 방송 연동 → 저주받은 상자 → 끝 카드 — 3막 보스는 2026-10-17 사용자: "영상에 3막 보스도 다시 추가해줘") · **첫 장 = 게시판 썸네일**(흰 섬광 · 검은 장으로 시작하지 않는다 — 1편 제목 · 2편 거대한 3막 보스) · **모든 내용을 넣지 않는다** · **도전의 문 · 도전 놀이 장면은 넣지 않는다** · **"캐논 변주곡" · "야차" 라는 말을 쓰지 않는다**(자막 · 게임 속 스킬 외침 — 녹화 중 `showShout` 거름) · **검은 화면 · 로딩 장면 금지**(장면 사이는 녹이기 `dissolve` · 셰이더 · 괴물 모델 · 지역 페이드가 준비될 때까지 담지 않는다 — `unready` · `areaFade`) · 1080 + 작은 HUD · 쉬운 말. 뜬 뒤 `tools/sheet.js` 로 0.03초(썸네일) · 전환 · 끝을 촘촘히 떠서 직접 본다. 게임 코드(효과음 · 그래픽)가 바뀌면 pull 한 뒤 다시 뜬다. 뜨는 법: 로비(?shot=1)에서 `t.start({ part: 1 ~ 2, skin: 'dark' | 'bright', lowMax: 11_500_000 })` — 같은 판에서 1편 → 2편(2편이 최종 보스를 잡으므로 다른 분위기는 페이지를 새로 연다 · 1편은 로비에서 불러야 고르는 화면이 담긴다 — 없이 뜨려면 `select: false`). 출력 `docs/img/patch{1,2}_{dark,bright}.webm` · `_hq`. 지금 판: 2026-10-17 메인 PC v1.7.9(탄 꼬리 · 탄피 · 먼지 · 연기 · 부서지는 구조물 다음 — 사용자: "패치 영상 다시 떠줘") · 36 · 38초 · 게시판용 🌙 10.6 · 10.6 · ☀ 10.6 · 10.6 MB(넷 합 42.4 MB · 사진 여섯 더해 44.3 MB) · 고화질 72 · 71 · 74 · 71 MB (마을 사진 둘은 v1.6.2 · 녹화 중 올라온 v1.8.0 🌙 부서진 구조물 안개 고침은 영상에 없다 — 영상은 구조물을 일부러 부수지 않는다) · 사진 `shot_town · fight · boss(_bright).jpg`(마을 사진은 판을 열어 자리를 잡고 3D + HUD 캔버스를 합쳐 POST `/__shot` `{dir:'img'}` — 영상에서 나오지 않는다) · 끝 카드 문구 "정식 서비스 — 의견은 게시글 댓글로"(2026-10-17 사용자 — 오픈 베타 뺌). 예전 `trailer*` 는 쓰지 않는다. **파티 드래곤을 부른 보스(`sum`)로 바꾸지 말 것** — 부른 보스는 거대하게(4배) 그리지 않는다. 엔딩 창은 쓰러지기 직전 `state.killed` 에 그 방을 넣어 막는다. 녹화용 소리 상태(`liteState`)에는 플레이어 `fx` 가 있어야 한다. `docs/img` 는 git 밖이라 PC 마다 따로 뜬다.
- **녹화 중에 코드 파일(`tools/trailer.js` 포함)을 고치면 vite 가 페이지를 새로 고쳐 녹화가 날아간다** — 녹화 중엔 문서(.md)만 고친다.
- 영상 장면 확인: `tools/sheet.js`(`sheet(파일, 이름, 시각들)` → `.frames/shots/<이름>.jpg` 네 칸 모음 · `frame()` 한 장). 가려진 창은 스크린샷이 막혀도 이것은 된다.
- 영상 밝기: 후처리(빛 번짐 · 색감)가 들어온 뒤 예전 1.6 배는 스킬 빛이 하얗게 날아간다 → 기본 1.22 · 마을 1.45 · 보스 방 1.5 (`ov.bright`).
- 브라우저에서 게임 모듈을 import 할 때: 개발 서버는 고친 파일을 `?t=` 주소로 준다 — 상태를 가진 모듈(stream.ts 등)은 `performance.getEntriesByType('resource')` 에서 게임이 쓰는 주소를 찾아 불러야 같은 사본이다.
- 소개 영상 주인공은 **철면란 · 닉네임 철면수심**(2026-09-24 사용자). 로비에서 `#nick` 에 철면수심 · `.char[data-id="cheolmyeon"]` 을 고른 뒤 방을 만든다.
- 영상 장면 확인: ffmpeg 가 없다 — 같은 개발 서버에서 `<video src=/bedorage-rpg/docs/img/trailer.webm>` 을 열어 시각마다 캔버스에 그려 `/__shot` 으로 `.frames/shots/` 에 모아 본다.
- ⚠ 영상은 **게임 캔버스(3D · HUD)만** 합친다 — HTML 로 된 것(왼쪽 아래 후원 표 · 채팅 칸 · 창)은 안 담긴다. 후원 표는 `trailer.js drawDonTable` 이 같은 내용으로 그린다(`ov.don` — 치지직 장면만 · 자막 위). 진단(`diag`) 사진에는 자막 · 덧그림이 없다.
- 녹화 반복 상한은 게임 시각 240초(`FPS * 240`) — 준비(hold) 시간까지 센다. 장면을 늘리면 확인할 것(120초일 때 끝이 잘릴 뻔했다).
- 녹화가 끝나면 한동안 페이지가 응답하지 않는다(소리 섞기 · 저장) — `docs/img/patch*.webm` 의 시각으로 끝났는지 본다.
- 게임 설명 · UI · 공지 · 영상에 **'디아블로' 라는 말을 쓰지 않는다** (2026-09-23 사용자).
- ⚠ 소개 영상은 **즉사기를 보여 주지 않는다**(스포일러 — 2026-09-24 사용자).

**공지 사진 다시 뜨기** (2026-09-19 — 공지 사진 셋은 지금 패치 플레이 영상과 같이 뜬다):
- 개발 서버를 `?shot=1` 로 연다. 그러면 캔버스 버퍼가 남고 `window.__session` 이 열린다.
  - 탭은 **tabs_create 로 만든 탭**을 쓴다(미리보기 첫 탭은 1분쯤 뒤 다시 로드된다).
  - 열자마자 `localStorage.setItem('brpg.muted','1')` 로 소리를 끈다.
- 백그라운드 탭은 rAF 가 멈춘다. 찍기 전에 `__session.frame(performance.now())` 를 몇 번 불러 그린다.
- 합쳐 저장: `.game-stage` 안의 보이는 캔버스(3D + HUD)를 1280 폭 캔버스에 차례로 `drawImage` 한 뒤, `fetch('/__shot', {method:'POST', body: JSON.stringify({name, data: out.toDataURL('image/jpeg', 0.9)})})`.
  - 결과는 `.frames/shots/<name>.jpg` 다(확인용). **공지에 올릴 사진만** `{dir:'img'}` 를 붙여 `docs/img/` 로 (2026-09-23 — docs/img 에는 메인 사진 3 · GIF 3 · trailer.webm 만).
  - 2026-09-23 부터 메인 사진 셋(마을 · 난전 · 보스)은 소개 영상과 같이 뜬다 — `tools/trailer.js`(가상 시계 · 1920×1080 · 3D 조금 밝게).
  - 2026-10-17 부터 영상에 마을 사진 자리가 없다(1편 마을 장면은 걷는 중) → `shot_town(_bright).jpg` 는 따로: 1920×1080 로 판을 열고 `__session.applyGfx('high')` · 숨은 창이면 `setInterval(frame, 50)` · 나는 마을 처음 자리(304, 560) · 봇은 왼쪽 아래로 흩어 둔 뒤 0.1초씩 두 번 다시 놓고(그리기는 틱 사이를 잇는다) 3D + HUD 를 1920 폭에 합친다(🌙 은 3D 만 `brightness(1.45)`). 이름표 · 촌장 ! 가 사람 머리 위에 붙었는지 본다.
  - (예전 판 — 지금 영상 · 사진은 위 "패치 플레이 영상" 규칙) 밝은 분위기 판(2026-10-06): `t.start({ skin: 'bright' })` → `trailer_bright.webm` · `trailer_bright_hq.webm` · `shot_*_bright.jpg`(자막 · 놀이곡 · 밝은 보스 목소리 · 밝기 보정 없음). 어두운 판 파일은 그대로 둔다.
- 장면 연출:
  - `__bd.state().players[0]` 의 x·y 를 옮겨 자리를 잡는다(혼자 판이라 어긋날 걱정이 없다).
  - 사격은 `window.dispatchEvent(new MouseEvent('mousedown', …))`, 스킬은 키 이벤트로 한다.
  - 보스 예고는 `__bd.view().monsters` 의 `st === 2 && mode === 2` 를 기다렸다 찍는다.

- **메인 PC(데스크톱)에서 영상 뜨기**(2026-10-08): 이 폴더 `.claude/launch.json` 의 `rpg-dev`(5173 — 메인 PC 에는 다른 서버가 없다) → `tabs_create` 새 탭 → `resize_window` 1920×1080 → `?shot=1` 다시 열기(닉네임 철면수심 · 철면란은 세이브에 있다) → `t.start({ part: 1, lowMax: 11_500_000 })` 을 기다리지 말고 띄운 뒤 `status()` 를 30초씩 본다(자바스크립트 도구는 45초에 끊긴다) → 같은 판에서 2편(분위기마다 페이지를 새로 — 위 "패치 플레이 영상" 규칙). 확인 `tools/sheet.js` → `.frames/shots/tr1b-sheet.jpg` …
- **2026-10-06 노트북에서 공지 영상 · 사진을 다시 떴다**(v0.72.4 — 사용자: "공지글 멘트 · 트레일러 영상 · 사진 파일을 이 노트북에서 생성"). `docs/img/` 는 git 밖이라 PC 마다 따로 떠야 한다.
  - 이때만 노트북에서 개발 서버를 띄웠다: `npx vite --port 5174 --strictPort`(백그라운드) → `preview_start({url:'http://localhost:5174/bedorage-rpg/?shot=1'})` → **새 탭(tabs_create)** 에서 `resize_window` 1920×1080 · `bd.nick` 철면수심 → 로비에서 `t.start()`. 녹화 약 3.5분 + 소리 · 저장 1분(노트북). 끝나면 창 크기 되돌리고 탭 닫고 서버 멈춤.
  - ⚠ 창 크기 흉내는 **턴이 끝나면 풀린다** — 녹화하는 동안 턴을 끝내지 말고 `status()` 를 들여다보며 기다린다.
  - 빈 세이브(1 레벨)로 뜨면 레벨업 알림 글이 보스 사진을 가렸다 → `trailer.js` 가 녹화 중 레벨업 알림 글을 거른다(빛 고리는 그대로).
  - 영상 장면 확인은 ffmpeg 없이: 같은 페이지에서 `<video>` 로 열어 시각마다 그려 `/__shot` → `.frames/shots/trailer-sheet*.jpg`.
- 브라우저 확인 요령: `window.__bd.state()` · `__bd.map()` 으로 판을 만질 수 있다(플레이어 옮기기·무적 `invuln`·몬스터 깨우기 `st = 1`).

### 게임 규칙 (사용자 결정 — 바꾸려면 사용자에게)

- 정예 이름표끼리 · 시청자 채팅 말풍선끼리 겹침은 **그대로**(사용자 — 움직이는 것이라 비키면 흔들린다).
- 그림체 = 캐릭터 · 괴물 **둘 다 툰**(`toon.ts`).
- 반복 끝 콘텐츠 이름 = **시련**(☀ 도전 놀이) — 4막 지역 '불타는 균열'과 헷갈리지 않게. 보통 난이도 심연의 군주를 잡은 캐릭터부터 · 끝낸 단계 + 1 까지 · 10분.
- ⚠ 시청자 채팅 말풍선은 **괴물 머리 위에만**(2026-09-24 사용자 — 캐릭터 머리 위 대체는 되돌렸다). 괴물이 없으면 기다렸다 버린다.
- ⚠ 캐릭터는 모두 **○○란(계란)** — 게임 안 글 · 공지 · 영상에 '덕' · '오리' 를 쓰지 않는다(2026-09-24 사용자). 이야기 정본은 GUIDE 10장 · `src/ui/ending.ts`(MT 공포체험 → 계란이 되어 야영지).
- ⚠ 게임 중 **로비로**(오른쪽 아래 단추 · Esc 메뉴)는 `confirmExit()` 확인 창을 거친다(2026-09-24 사용자 — 잘못 눌러 방이 터지지 않게). 판이 끝난 뒤 창(전멸 · 엔딩)은 바로 `exit()`.
- ⚠ 웨이포인트 비트 순서는 세이브에 남는다 — **새 웨이포인트는 맨 뒤에만** 붙일 것(`WAYPOINTS` — 보스 방 넷을 v0.56.0 에 뒤에 붙였다).
- ⚠ 보물 고블린은 **들킨 뒤에만** 도망친다(`Monster.seen` · `GOBLIN.seen` — 2026-09-24 사용자).
- ⚠ 드랍: 희귀 이상은 **아이템 레벨이 낮을수록 드물다**(`items.ts lootLevelMul` — 2026-09-24 사용자: 저렙에서도 희귀 · 전설이 너무 쉽다). 첫 아이템 희귀 확정은 막 보스만.
- ⚠ 괴물 레벨은 **지역 레벨 고정**(`areaLevel(지역, 난이도)` — v0.54.0). 파티 레벨을 따라 올리지 말 것(2026-09-24 사용자: 30 레벨로 1 레벨 던전에서 아팠다). 낮은 곳은 경험치로 막는다(`xpGapMul`).
- ⚠ 막 보스 즉사기(`BOSS_ULT` · `Zone.kill` · `killOutright`)는 **무적 · 구르기 무적만** 막는다(2026-09-24 사용자). **후원으로 부른 막 보스는 즉사기를 쓰지 않고**(`bossThink` 에서 `m.sum`) **체력이 절반**이다(`SUMMON_BOSS_HP` — 2026-09-27 사용자). 대사 · 피하는 법은 `BOSS_PATS` 의 line · hint.
- ⚠ 막 보스는 **밀리지 않는다** — 상태 이상 지우기(`bossImmune`) + 몸 비키기(`separate` 에서 보스는 제자리) + 맞는 그림 흔들림 없음(2026-09-24 사용자).
- ⚠ 사람에게 거는 후원 효과(화면 흔들림 · 시야 축소 · 거꾸로 · 봉인 · 공격 강화)는 **파티 모두**(`partyOf` — 다른 지역 동료 포함, 2026-09-24 사용자: 후원은 방송인 한 명에게만 온다).
- ✅ **소환 막 보스 · 지옥문은 즉사기를 쓰지 않고 체력이 절반**(v0.72.1 · v0.72.2 — 2026-09-27 사용자: "소환된 막 보스는 모두 즉사기를 빼 줘" · "체력을 반으로 줄여 주고 후원 설명 창에 간단하게 서술도"). 즉사기만 뺐을 때는 한 바퀴가 거의 그대로였고(4막 쓰러짐은 % 피해 패턴), 체력 절반으로 분당 2 ~ 3건 4 ~ 4.6 → 2.8 ~ 3.4시간. 치지직 창의 금액표 설명(`DONATE_EVENTS.desc`)과 그 아래 안내 글에 적었다.
- ⚠ 계측 도구는 지역 끝을 **원래 괴물**로 본다(사람은 보스를 잡으면 소환 졸개를 두고 간다). 소환 괴물까지 세면 분당 2건만 넘어도 보스 방이 끝나지 않는다.

**막 보스 패턴 (v0.51.0)** — 자세한 것은 CHANGELOG v0.51.0.
- 정의는 `core/monsters.ts` 의 `BOSS_PATS`(번호 = `Monster.pat`, 끝에만 더할 것) · `BP`(수치) · `BOSS_PLANS`(보스마다 단계별 차례 · 간격 · 분노 체력 · 속도). 흐름은 `core/sim.ts` 의 bossThink(차례) → bossStart(예고 범위를 깔고 예고) → bossRelease(돌진 · 도약 · 쏘기 · 부르기) → bossDone. 범위는 `ZONE_FUSE + pm + shape` 가 제 스스로 터진다(bossBlast) — 모양 판정은 `core/bosszone.ts`(sim · 봇 · 렌더가 같이 쓴다).
- ⚠ 규칙: 막 보스 피해는 **최대 체력 ‰(pm)** — `hurtPct` → `hurtPlayer(raw)` 로 방어 · 역할 · 막기 · 감소를 모두 무시한다. 새 보스 공격도 꼭 `hurtPct` 로(그냥 `hurtPlayer` 면 탱커가 덜 맞는다). 한 번 맞으면 `bossCd` 20틱.
- ⚠ 규칙: 막 보스는 기절 · 둔화 · 넉백 · 도발 면역(`clearCc` — stepMonsters 앞 · 틱 끝 `bossImmune`). 우두머리(중간보스)는 그대로 걸린다.
- ⚠ 패턴은 거리로 거르지 않는다("일정한 패턴"). 거르면 근접 앞에서 한 패턴만 되풀이했다. 못 쓰는 것은 부를 자리가 없거나 보이는 사람이 없을 때뿐.
- 보스 결투장: `MapGen.arena`(보스 방 넷) → `map.ts` carveArena 가 맵 **가운데**에 둥근 빈 방(반지름 12칸) · 둘레 벽에 출입구 여섯(정수 계산) · 둘레 밖은 빈 바닥(v0.61.0 — 예전엔 오른쪽 방 + 입구 하나 + 복도). 보스 방의 보스는 먼저 맞기 전에는 가만히(sim `isGiant(m) && m.hitTick < 0`). `map.arena` 가 있으면 보스 = 가운데, 입구 = 가장 먼 스폰, 무리 · 상자는 결투장 밖.
- 계측: `npx vite-node tools/bossfight.ts -- party=4 seeds=3` (dodge=0 이면 봇이 안 피한다 · char= · area=). 넷이 피하면 51~109초 쓰러짐 0, 안 피하면 3 · 4막에서 4~6번 쓰러진다. 혼자는 어렵다(침착 봇 군주 0/3) — **그대로 둔다**(2026-09-24 사용자: "혼자 하는 경우는 혼자 도전식 · 보통은 사람을 꽉 채우거나 봇으로 채워서 하니 어려워도 괜찮다"). 인원 보정은 몬스터 **체력만** 정원(자리 수) 기준 2인 1.6 · 3인 2.2 · 4인 2.8배(보스 포함 · 봇 자리도 같다), 수는 그대로.

### 방송 (치지직)

- ⚠ **규칙(2026-09-23 사용자)**: 받은 채팅 수 · 후원 수 · 후원 합계 · 받은 내역은 **어디에도 보이지 않게** — 수입 수준이 드러난다. 허브가 아예 세지 않는다(`tests/streamprivacy.test.ts`). 게임 속 후원 줄 · 배너에도 금액을 적지 않는다. 가격표(금액 → 이벤트)만 보인다. 코드: `net/chzzk.ts`(연결) · `game/stream.ts`(허브 · 금액 설정) · `core/donate.ts`(이벤트 정의) · sim `donateCommand` · `summon` · 세션 `onStreamDonation` · `pumpStream` · `drawDonTable` · 렌더러 `monsterSay` · `pickSpeaker` · `drawSay`.
- **2026-09-23: 새 앱 "배도라지RPG"(애플리케이션 ID `bedorage-rpg`, Client ID `bfdcb9ed-…0abf`) + 전용 워커 `https://bedorage-proxy.1117tkdrms.workers.dev`**(저장소 `proxy/` — 먹방 룰렛 워커는 건드리지 않는다). 스코프: 채팅 메시지 조회 · 후원 조회 · 유저 조회.
- ✅ **사용자 확인: 치지직 로그인 · 연결 성공 — "연결됨 · 채팅 · 후원 받는 중"**(2026-09-23). 실제 방송 채팅 · 후원이 괴물 말풍선 · 이벤트로 나오는지는 사용자 방송에서 볼 것.
- 치지직 없이 확인: 치지직 창 → **채팅 시험**(게임 안에서 누르면 창이 닫히고 말풍선 · 로비에서는 "게임 안에서 됩니다") · 이벤트마다 "시험" · 응원 단계마다 "시험". 채팅 말풍선은 괴물 머리 위 — 없으면 우리 편 머리 위(`playerSay` · `pickPlayerSpeaker` · 알림 `pchat`).
- 치지직 구독 알림(v0.50.1) · 시청자 투표(v0.51.0)는 사용자가 **뺐다**. 다시 넣지 말 것.
- 후원 번호(seq, 4비트)는 **판에 넣을 때** 매긴다. 소환형은 `canRunDonation` 이 소환 상한 · 막 보스 하나를 본다. 대기열 상한 60.
- 응원(v0.51.0 · v0.53.0 새 효과): 후원 글 `!응원` → 응원 금액표(`StreamCfg.cheers` — v1.9.0 처음 값 1천 회복 구슬 3개 · 2천 회복 구슬 5개 + 공격 속도 · 3천 아군 괴물 넷 + 공격 강화 · 5천 아군 보스 + 공격 강화 — **이름 = 효과**, 2026-09-24 사용자: 힘내라 · 함성 · 기적은 직관적이지 않다 · 즉시 회복 · 부활은 별로다)에서 넘는 것 중 가장 비싼 단계. ⚠ 아군 괴물은 `GameState.allies`(괴물 배열과 따로 — 괴물 배열을 도는 전투 코드가 아군을 보지 않게. 괴물 배열에 섞지 말 것). 번호 11~14(CMD_DONATE 아래 네 비트 안 — 더 늘릴 칸은 15 하나뿐).
- 폰은 이 게임을 막아 두었으니 방송 연동도 PC 만 본다.

**방송 개선 — 사용자 결정** (2026-09-25 · 09-26 두 번 검토):
- ✅ 한 것: 방장 강퇴 · 금칙어 · 링크 · 도배 · 방해 효과 한도 · 시청자 이름 괴물(추첨) (v0.68.0 ~ 0.68.5) · 후원 결과 알림 · 큰 후원 예고 · 방해 이벤트 멈춤 · 치지직 끊김 알림 (v0.69.0).
- ❌ **캠 자리 비우기는 하지 않는다** — 캠은 오른쪽 아래에 크로마키로 놓아 지금 HUD 와 겹쳐도 이상하지 않다(2026-09-26 사용자: "불필요"). 다시 제안하지 말 것.
- ✅ 대기실 · 게임 채팅에도 금칙어 · 대기실 전체 채팅 숨기기 (v0.69.1).
- ❌ **남은 후보 여섯(① !이름 ② 시청자 차단 ④ 후원 소리 ⑥ 같은 효과 쉬기 ⑦ 빈 자리 안내 ⑧ 금액표 배율)은 하지 않는다**(2026-10-17 사용자: "방송 개선 여섯은 하지 않을 거야" — v1.6.8 에 넣었다가 v1.7.4 에서 뺐다). 다시 제안하지 말 것 — 방송 개선 후보는 모두 정리됐다.
- **치지직 시험 단추 = 개발자 모드 Ctrl + Shift + D**(이 브라우저에 저장 · 다시 누르면 끔). 단축키는 플레이 가이드 · 공지에 적지 않는다(악성 시청자). 시험 후원은 여럿이 하는 판에서 방장만(`stream.testBlock`).
- ❌ **비공개 방(초대 코드)은 하지 않는다** — 방송을 본 사람들만 하는 게임이고 아무에게나 배포 · 홍보하지 않는다(2026-09-26 사용자). 다시 제안하지 말 것. 모르는 사람 대비 기능보다 방송 중 재미 · 방송 사고 예방에 집중.
- ❌ **합방 표시 · 치지직 채팅으로 답하기 · 하이라이트 저장도 하지 않는다**(2026-09-26 사용자: "필요 없어"). 다시 제안하지 말 것 — 방송 개선 후보는 이제 모두 정리됐다.
- 시청자 투표는 사용자가 뺐다(v0.51.0) — 다시 제안하지 말 것.

## 확정된 결정 (2026-09-18, 자세한 근거는 PLAN 10장)

1. 이름 **배도라지RPG**, 새 저장소. 2. **WASD + 마우스 조준.** 3. **락스텝 유지.**
4. **1차 6명**: 철면란(기관총)·침착란(소총)·단군란(권총)·매직란(산탄총)·승빠란(후라이팬)·옥냥란(저격총) — 무기가 전부 다르다.
5. 마을 = **대기실 화면**(모닥불 야영지). 6. 전리품 = **디아블로 3·4 방식**(개인 전리품 · 스마트 루트 85% · 주웠다 버리면 파티원에게 보임).
7. 죽음 규칙은 **방장이 방을 만들 때** 고른다: 없음 · 소실(골드 20%·경험치 10%) · 하드코어(한 번 죽으면 그 원정 끝, 원정 중 얻은 것 잃음, 세이브는 안 지움).
8. 몬스터는 **어두운 괴물형**(구울·해골·부푼 시체·강령술사·도살자). 9. **시야 제한 유지.** 11. PC 먼저.
10. PvP = **투기장**: 덕의 대전 방식을 **RPG 안에 이식**, RPG 에서 성장하고 장비를 낀 캐릭터끼리 싸운다(2026-09-18 사용자 정정 — 처음엔 덕 링크로 잘못 이해했다).
12. **캐릭터마다 스킬 2 + 궁극기 1**(특성 유지) · **UI 는 디아블로 4 풍**(RPG + 슈팅) — 2026-09-18 사용자 추가 요청.

사용자가 2026-09-18 "결정할 게 있어도 임의로 정해서 모두 진행" 을 맡겼다 → 이후 개발 중 정한 것은 아래 "핵심 설계 결정" 과 CHANGELOG 에 남긴다.

## 핵심 설계 결정 (바꾸려면 DESIGN.md 도 같이 수정)

덕 HANDOVER 의 1~24 중 PvP 전용(모래주머니·힐팩·팀전·후라이팬 막기·관전 제한)이 아닌 것은 그대로 유효하다. 특히:

1. **`src/core/` 는 결정론.** + **몬스터·스킬·아이템의 기억·추첨은 전부 `GameState` 안**(DESIGN 2장 6).
2. **호스트 = 플레이어 0.** 방 상태·시작·이탈·리싱크·난입을 호스트가 정한다.
3. **카메라 피치 55°·요 45° 고정.** WASD 는 화면 기준.
4. **유료·카드 등록 서비스 금지.** TURN 배제.
5. **인원은 4명까지.** 자리는 정원만큼 미리 잡는다(난입은 빈 자리를 채운다).
6. **닉네임 키 `bd.nick` 은 덕과 공유**, 나머지 저장 키는 `brpg.*`.
7. **던전 층은 인원과 상관없이 같은 크기**(`MapDef.fixedScale`, `buildMap` 이 배율을 무시). 대신 몬스터 체력이 인원만큼 는다(4인 2.8배).
8. **흐름장·공간 해시는 상태 밖 캐시지만 상태·맵만으로 다시 만들 수 있다** — 그래서 스냅샷을 받은 사람도 같은 결과. 타일이 바뀌면 `map.version++`.
9. **피해 숫자는 내 명중만.** 동료·폭발 숫자까지 띄우면 화면이 덮인다.
10. **총소리가 잠든 무리를 깨운다(7칸, 벽 너머도).** 소음기 권총은 예외 — 단군란의 정체성.
11. **한 sim 이 두 판을 돈다**(`GameState.mode`: dungeon · arena). 스킬·범위 공격(`aoe`)·탄은 "몬스터 + 적 플레이어(isEnemy)" 를 똑같이 친다 — 던전은 모두 0팀이라 PvP 경로가 저절로 꺼진다.
12. **스킬 키는 Q·E·R**(궁극기는 X 였다가 v0.20.1 에 R · F 부활 · Space 구르기는 슈터 관례대로). 누르고 있으면 준비되는 대로 쓴다. 입력 버튼은 16비트.
13. **재장전이 없다(2026-09-19 사용자).** 오른쪽 오브는 던전 = 집중, 투기장 = 기력이다. 무기는 계열 안에서만 바꿔 낀다(`weaponFor`).
14. **투기장에서 기절은 다리 부상(느려짐)으로 바꾼다** — 조작을 빼앗으면 PvP 가 답답하다.
15. **가방·장비는 상태 안(PlayerState.equip/bag)**, 바꾸는 것은 `Input.cmd`(끼기·벗기·버리기) 뿐. UI 는 명령만 넣는다 — 장착이 모두의 화면에서 같다.
16. **전리품은 개인별**(Drop.owner). 버린 것은 owner -1(누구나). 발밑 자동 줍기. 아이템 번호는 판마다 큰 수(시드 기반)에서 시작해 세이브 것과 안 겹친다.
17. **하드코어는 원정이 끝날 때만 저장**(탈락하면 저장하지 않음 = 이번 원정의 이득을 잃는다). 다른 규칙은 30초마다·레벨업·끝·나갈 때.
20. **난입자는 받은 입력이 있는 만큼 따라잡는다**(시간 무관, 틱당 16스텝) — 판·맵·3D 준비가 무거워 실시간으로는 벌어진 간격을 못 좁혔다(v0.5.2). **던전 방은 혼자여도 닫지 않는다**(투기장만 덕 규칙).
19. **층 넘어가기는 두 단계**: sim 이 계단 카운트다운 끝에 `pendingFloor` 만 세우고, 세션이 그 틱 바로 뒤 새 맵(`floorSeed(seed, 층)`)을 만들어 `enterFloor` 를 부른다 — 맵은 상태 밖이라 sim 이 직접 못 바꾼다. 받은 판(난입·리싱크)은 `ensureFloorMap` 으로 층 맵을 맞춘다.
18. `Item`·`Sheet` 는 **type 별칭** — Trystero 메시지가 JSON 호환 타입(인덱스 시그니처)을 요구해서 interface 로는 안 된다.

## 코드 지도

덕과 같은 파일은 덕 HANDOVER "코드 지도" 를 본다. RPG 에서 새로 생기거나 크게 바뀐 것:

```
src/core/state.ts        GameState(몬스터·투사체·구슬·입구·죽음 규칙) · PlayerState(쓰러짐·부활·탈락) · Monster(기억 전부) · SimEvent
src/core/sim.ts          createState(입구에 모임 + populate) / step: 플레이어 → 쓰러짐 → 몬스터 AI → 밀어내기 → 탄 → 몬스터 투사체 → 폭발 → 구슬 → 끝 판정
src/core/monsters.ts     몬스터 정의표 (원형·수치) · 인원 보정
src/core/dungeon.ts      입구 · 무리 배치 (전용 Rng)
src/core/flow.ts         흐름장 캐시 · flowStep · 공간 해시(Grid)
src/core/bot.ts          동료 봇 (몬스터 사격 · 부활 · 따라가기 · 혼자 탐험)
src/core/characters.ts   + PLAYABLE (12명 — 탱 3 · 딜 6 · 힐 3)
src/core/skills.ts       스킬 정의표 (캐릭터별 Q·E·R · 버프 번호 FX_*) — 효과는 sim.ts castSkill
src/core/items.ts        아이템 · 옵션 · 등급 · 레벨 곡선 · 능력치 계산 · 캐릭터 기록(Sheet) 검사
src/game/save.ts         세이브 (localStorage · 내보내기/가져오기 · 세이브 칸 셋 — 칸 1 = 옛 열쇠 brpg.save.v1 · 칸 2 · 3 = .s2 · .s3)
src/ui/inventory.ts      가방 창 (장비 · 가방 · 툴팁 비교 → Input.cmd)
src/core/pvpbot.ts       투기장 봇 (덕의 PvP 봇 + 스킬)
src/render/d4hud.ts      디아블로 4 풍 HUD (오브·스킬 바·추적·파티)
src/render/skillIcons.ts 스킬 아이콘 (캔버스 벡터)
src/render3d/monsters3d.ts  몬스터 인스턴스 렌더 (부품 × 자세 함수) · 시체
src/render3d/renderer3d.ts  + 몬스터 가시성 · 구슬 · 투사체 · 등불 · 체력 바 · 궁수 조준선 · 쓰러짐 고리
tests/dungeon.test.ts · tests/combat.test.ts · tests/skills.test.ts · tests/items.test.ts
src/render3d/brightFloor.ts   ☀ 맵별 바닥 (BRIGHT_FLOOR · paintBrightBand · applyGrain 결 텍스처) · hash
src/render3d/brightWalls.ts   ☀ 맵별 벽 (BRIGHT_WALL) · 맵 주제 소품 (BRIGHT_PROPS) · ballTexture · vc(정점 색)
src/render3d/brightLandmarks.ts ☀ 놀이터 랜드마크 (planLandmarks · buildLandmarks)
src/render3d/quarksfx.ts      three.quarks 이펙트 (QuarksFx.burst · 프리셋 13 · ☀ 🌙)
src/render3d/post.ts          후처리 (빛 번짐 · 막마다 색감 · 톤 매핑은 렌더러 값을 따름)
src/render3d/skillfx.ts       스킬 이펙트 37 (cast · aoe)    src/render3d/toon.ts  툰 재질 · 먹선 · 점광원 상한
src/game/skin.ts · skinThemes.ts  분위기(🌙 · ☀) · ☀ 맵 테마 25 · 글 갈아 끼우기
src/net/room.ts               P2P 방 · 입력 전용 빠른 채널(FAST_IN_ID)    src/game/ticker.ts  틱 · 그리기 맞추기(shouldDraw)
tools/gallery.js              ☀ 맵 24 곳 3D 사진 (전후 비교)    tools/trailer.js · sheet.js  패치 플레이 영상 · 장면 확인
tools/sfxlevels.js            효과음 세기 재기 (녹음 · 합성 견주기 · 오프라인 소리판)
tools/uitest.mjs              배포 전 화면 시험 (Actions)    tools/perf.ts · campaign.ts · bossfight.ts  계측
tests/skin.test.ts            분위기 · ☀ 맵별 바닥이 모든 지역 맵에 · 랜드마크는 꽉 찬 벽 덩어리 안에만
```

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

0. **사용자 확인 (v1.10.0)** — 원래 크기 창 + 키운 작은 글씨가 알아보기 쉬운지 · 보스 등장 장면(졸개 멈춤 · 어둠 걷힘 · 등장 대사) · 경직 한 번 · 즉사기 두 번 느낌(4막이 너무 세면 `GIANT_HP` · `BOSS_ULT_CD` 부터) · 천 원마다 후원(총잡이 여섯 · 대행진) · 용병 값 · 자동 줍기 희귀 이상 · 바닥 점 · 보통 난이도 +20 ~ 25% 느낌 · 방송 PC(방송 프로그램과 같이)에서 렉이 줄었는지 · 공지 5차(`docs/공지글-모음.md` 맨 위 · 스크린샷 아홉 `docs/img/patch-2026-10-22/`).
   예전 확인 — 그래픽 개편 A ~ E 를 직접 플레이한 느낌(☀ 바닥 · 벽 · 랜드마크 · quarks 이펙트 세기 · 🌙 이펙트) · 합친 업데이트 공지(`docs/공지글-모음.md` 4차 — 10-07 ~ 10-17 을 한 글로 · 최신이 위 · 첨부는 맨 아래) · 패치 플레이 영상 넷(v1.6.7 · 1편 고르는 화면 → 마을로 시작 · 2편 3막 보스부터 — `docs/img`) · ☀ 새 이름(업적 · 세트 · 전설 · 깜짝 상자 · 마을 사람 인사)이 마음에 드는지. 게시는 사람이.
1. 녹음 효과음 — **세기는 재서 맞췄다(v1.6.1 · `tools/sfxlevels.js` — 대신하는 자리는 원래 합성 +2dB 안 · 겹친 자리는 +2 ~ 3dB · 녹음은 모노로 섞어 넣음)**. 남은 것: 사용자가 들어 본 느낌(크다 · 작다 · 어색하다)을 받아 그 자리의 vol 만 고치고 도구로 다시 잰다.
2. ~~시련 밸런스 계측~~ — 하지 않는다(2026-10-17 사용자: "시련은 플레이할 사람 없으니까 굳이 검토 안 해도 될 거 같아").
3. **실제 방송에서 치지직 확인**: 채팅 말풍선이 너무 많거나 적은지(보통 = 0.3초에 하나 · 8초 넘게 못 한 말은 버림 — 치지직 창 "말풍선 양" · "방송 글자 크기"로 바꾼다, v1.6.4) · 후원 이벤트 세기(v1.9.0 — 1막에서 5천 원 막 보스 · 3만 원 지옥문이 너무 세거나 약한지 · 1천 ~ 5천 원 괴물 이벤트가 너무 잦은지) · 금액표가 방송 화면에서 잘 보이는지. 토큰은 30일 — 만료되면 치지직 창에서 다시 로그인.
4. **3 · 4막 사람 플레이**: 사람은 아직 2막까지만. 예전 계측에서 3막(방패병 + 궁수)에서 죽음이 크게 늘었다.
5. **다른 PC · 다른 회선 4인 P2P**: 시청자와 같이 할 거라면 필수. 지금까지는 한 PC 의 여러 탭으로만 확인했다.
6. 방송 개선 — ③ 말풍선 양 · ⑤ 방송 글자 크기 ✅ v1.6.4 · 나머지(① ② ④ ⑥ ⑦ ⑧)는 **하지 않는다**(2026-10-17 사용자 — v1.6.8 에 넣었다가 v1.7.4 에서 뺐다). 후보는 모두 정리됐다. (아래는 지난 기록)
   - 2026-10-08 다시 검토: 고친 결함 — 시련 안의 후원 소환 · 응원 아군 배율(v0.98.2). 확인만 — 설정 흔들림 끄기는 후원 "화면 흔들림"에 안 걸린다 · 보스전 대기는 시련 수호자에도 걸린다.
   - 후보(2026-09-27 에 낸 여덟 + 새 하나 — 아직 아무것도 고르지 않았다): ① 후원 글로 이벤트 고르기("!이름") ② 시청자 차단(닉네임 — 말풍선 · !참여) ③ 말풍선 양(적게 · 보통 · 많이 · 보스전 중 줄이기) → ✅ v1.6.4 ④ 후원 소리(게임 후원 효과음 끄기 · 후원 때 게임 소리 잠깐 줄이기 — 치지직 TTS) ⑤ 방송 화면 글자 크기(후원 표 · 말풍선 · 알림) → ✅ v1.6.4 ⑥ 같은 방해 효과 사이 쉬는 시간 ⑦ 빈 자리 안내(주소 없이) ⑧ 금액표 한꺼번에 ×0.5 · ×2 ⑨ ☀ 철면수심전용 판의 후원 이름 → ✅ v0.98.3(사용자가 ⑨ 만 골랐다 — 2026-10-08). 표 · 배너 · 알림 · 영상은 이미 밝은 이름이었다(`skinText.ts DON_TEXT` 좀비 떼 → 괴물 떼 · 지옥문 → 깜짝 파티 — 후보를 낼 때 잘못 봤다). 새던 곳은 치지직 창 안내 글 두 줄뿐이었다. 나머지 이름(화면 흔들림 · 시야 축소 · 광폭화 · 막 보스 …)은 효과 이름이라 그대로(2026-09-24 사용자: 이름 = 효과). ① ② ④ ⑥ ⑦ ⑧ 은 고르지 않았다.
7. RPG 기능 후보(2026-09-20 검토 · 아직 안 한 것):
   - ❌ **소켓 · 룬은 하지 않는다**(2026-10-17 사용자: "소켓, 룬은 하지 않을 거야" — v1.7.0 에 넣었다가 v1.7.4 에서 뺐다 · 예전 세이브의 소켓(`so`) · 룬(`rn`) · 룬 주머니는 `sanitizeSheet` 가 지운다). 다시 제안하지 말 것.
   - ✅ **상인 재고 새로고침** v1.6.9 — 10분이 지나 마을에 들어서면 공짜로 새 진열(`SHOP_RESTOCK_TICKS` · `GameState.shopAt` · 이벤트 `shopRestock`). 골드로 새로 받기는 그대로.
   - ✅ **퀘스트 보상 고르기** v1.6.9 — 전설 보상 퀘스트는 촌장 창에서 부위를 고른다(`QUEST_PICK` + 퀘스트 × 5 + 칸). 골드 · 스킬 포인트 보상은 그대로.
8. 밸런스(사람 의견이 오면):
   - 투기장 밸런스: 스킬이 들어가 덕의 수치와 다르다. 사람 대전을 해 보고 조정(덕과 같은 원칙 — 봇 표는 참고).
   - **투기장**: ✅ v1.7.5 — `CHAR_PVP`(투기장 전용 캐릭터 배율 · 근접에도)를 세 맵 × 시드 12 평균으로 맞춰 12명 모두 46 ~ 54%(`tools/arena.ts -- seeds=12 map=yard|studio|garage`). 맵마다 차이는 맵의 성격이라 남긴다. 사람 대전 의견이 오면 다시.
   - 접두 능력 수치(`AFFIX_TUNE`)는 봇 계측·플레이 의견으로.
9. ~~그래픽 이어서~~ ✅ v1.6.6 — 보스 방 넷 · 진짜 궤적 · 괴물 탄 궤적 · 투기장 셋(계획서 7.4). 남은 것: 사람 둘이 있는 ☀ 투기장 판에서 직접 보기.

- 분량 계측(한 바퀴 약 2 ~ 3시간 · 후원 분당 2 ~ 3건 표) · 4인 파티 계측 · 첫 던전 버벅임 해결 기록 · D1 ~ D7 자가 점검 · P2P 여러 탭 시험 요령은 [지난 기록](docs/HANDOVER-지난기록.md).

---

> 다음 세션 시작 시 다음 입력으로 컨텍스트 복원:
> `@HANDOVER.md 읽고 이어서 작업 진행`