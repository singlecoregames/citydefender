# City Defender — Progress Log

> Missile Command 기반 능동형 incremental 게임. 작업 진행 상태 스냅샷.
> 브랜치: `claude/test-coverage-analysis-jx5cq5` (모든 작업이 여기 푸시됨)

## 한 줄 요약
플랜 M1~M5 핵심이 모두 구현됨 — 코어 플레이, 런 루프+경제, 분기형 스킬트리,
자동 포탑 6종, 적 6종+보스, Cores 화폐, 수동 어빌리티 4종. 테스트 81개 통과.
트리 확장 완료: 35→51노드 (1차 StatMod 7, 2차 유틸 건물 3, 3차 레이더/재머/디코이/서지 6).

## 기술 스택 / 구조
- TypeScript(strict) + Vite + Three.js(ortho + UnrealBloom) + Vitest
- **시뮬/렌더 분리**: `src/core/`(결정론 헤드리스 sim, three·DOM import 금지)
  ↔ `src/render/`(Three.js) ↔ `src/ui/`(DOM) ↔ `src/platform/`
- 고정 60Hz 타임스텝, 시드 RNG(mulberry32) → 리플레이/테스트/밸런스시뮬 가능
- 아트: SNKRX식 픽셀아트 — 640×360 저해상도 렌더 + `image-rendering:pixelated`
  업스케일, 둥근 사각형 도형, 흰 파티클 트레일, 체크무늬 배경, 은은한 블룸. 외부 에셋 0
- 배포: GitHub Pages(자동, repo public 전환됨) →
  `https://singlecoregames.github.io/citydefender/` (모바일 테스트용)
- PWA: manifest.webmanifest + icon.svg, standalone/landscape, `viewport-fit=cover`
  + apple 메타(black-translucent)로 모바일 가로 풀스크린(노치 아래까지 풀블리드).
  렌더러는 window 대신 컨테이너 실측으로 카메라 종횡비를 맞춤

## 완료된 마일스톤
- **M0/M1** 스캐폴딩 + Missile Command 코어(수동 캐논, 재생 탄창, 팽창 폭발, 도시)
- **M2** 런 루프(Night/Day) + 경제(Scrap) + 세이브/로드(localStorage, 버전+마이그레이션)
- **M3** 분기형 스킬트리(중앙 COMMAND 코어에서 사방으로, 선언적 StatMod 효과)
  - 팬/줌(드래그·휠·핀치·버튼), **탭=툴팁 / 재탭=구매** 2탭 방식
- **M4** 자동 포탑 + 예측 사격(리드 에임 + 랜덤 오차) + **6종 포탑**:
  Gatling/Flak/Laser/Missile/Railgun/Tesla, 종류별 고정 위치, 포탑별 특수 업그레이드
- **M4 마무리** 보스(N10마다) + **Cores 화폐(◆)** + Cores 전용 노드 3개
- **적 6종**: ballistic, swarmer(무리), splitter(분열), regenerator(재생),
  phase(점멸 무적), carrier(미니언 사출) — 밤별 가중 등장
- **M5 Tech 브랜치**: 수동 어빌리티 EMP(정지)/Mega Bomb(대폭발)/Time Dilation(둔화),
  쿨다운제, 1/2/3 단축키 + 하단 버튼
- **트리 확장 1차** (economy/city/tech 보강, StatMod 계열 7노드):
  Chain Bounty(폭발 3+킬 보너스) / Wave Dividend(웨이브당 scrap) /
  Compound Interest(새벽 이자, `dawnInterest()` in run.ts) / Midas Protocol(◆) /
  War Insurance(도시 피격 보상) / Flux Capacitor·Singularity Core(◆, 어빌 쿨다운 감소).
  신규 스탯 5종: abilityCooldownMul, cityHitScrap, waveClearScrap, multiKillScrap,
  scrapInterestRate.
- **트리 확장 2차** (유틸리티 건물 — 비전투 지원 구조물, 포탑 패턴 미러):
  `BUILDING_NODES`/`buildingsFromTree` + `Building` 엔티티 + NightConfig.buildings.
  Scrap Harvester(economy, 초당 scrap 자동수확) / Shield Generator(city, 밤당 N회
  지면충돌 흡수, charges) / Repair Bay(city, interval마다 가장 손상된 도시 1HP 수리).
  balance: BUILDINGS(위치)·BUILDING_TUNING. sim: updateBuildings()+쉴드는
  handleGroundImpact에서 소모. 렌더: 색상별 키 큰 블록.
- **트리 확장 3차** (레이더/재머/디코이/서지, 6노드):
  Radar Array(건물, 포탑 조준오차 ×0.85^lvl) + Doppler Tracking(phase 무적 관통,
  isUntouchable()) / Jammer Tower(건물, 반경 45 슬로우 필드 12%+6%/lvl) +
  Wide Spectrum(반경 +20%) / Decoy Beacon(건물 x=90, 스폰 30%+8%/lvl 유인) /
  Scrap Surge(4번째 수동 어빌, 4키, 10s scrap 2배 — scaledScrap에 적용).
  건물 파생값(spreadMul/jammerField/decoyLure)은 Sim 생성자에서 1회 캐시

## 핵심 파일 지도
- `src/core/sim.ts` — 메인 시뮬레이션(step 루프, 포탑·적·어빌리티·보스 로직)
- `src/core/balance.ts` — 모든 튜닝 상수(한 곳에 모음)
- `src/core/tree.ts` — 스킬트리 노드 데이터 + resolveStats/turretsFromTree/abilitiesFromTree
- `src/core/stats.ts` — DerivedStats(선언적 스탯 시스템)
- `src/core/waves.ts` — 밤별 웨이브 생성 + enemyPool(가중 적 풀)
- `src/core/aiming.ts` — 리드 에임 요격 솔버
- `src/core/{run,save}.ts` — 메타 상태 + 세이브 코덱
- `src/render/renderer.ts` — Three.js 뷰 / `particles.ts` — 흰 파티클
- `src/ui/{dayscreen,hud,abilitybar}.ts` — DOM UI
- `src/main.ts` — 메타 루프(런→밤→Day 상점→다음 밤) + 입력
- `tests/{sim,meta}.test.ts` — 63개 테스트

## 밸런스 현황 (사용자 피드백 반영본)
- 적 HP: `(1 + 0.05·(n-1)) · 1.12^(n-1)` — N10≈4, N20≈17, N50≈890
  (선형항 0.08→0.05로 초중반 상승 시점을 늦춤, 후반 지수 천장은 유지)
- 적은 화면 위 밖(`height + 22`)에서 진입해 요격 시간 확보
- swarmer(빠른 적) 속도 17→15.3 (-10%)
- 포탑: 기본 약하게(Gatling 1.1발/s), 예측 사격 + ±3.5° 오차로 원거리 빗나감
- 보스: 기본 HP 55×밤스케일, 처치 시 Cores = 2 + 밤/10

## 다음 단계 후보 (아직 안 함)
1. **사운드(ZzFX)** — 절차적 효과음, 체감 큰 폴리시
2. **밸런스 시뮬레이터**(`tools/sim/`) — AI 플레이어로 4~5시간 페이싱 수치 검증
3. **추가 보스 패턴** — 현재 보스 1종 행동, N20/30/40/50용 고유 패턴(Hydra/Bastion 등)
4. **엔딩/Endless** — N50 클리어 연출 + 자유 플레이
5. **콤보/Overcharge** — 수동 요격 연속 보너스(설계 문서엔 있으나 미구현)
6. 플랫폼 패키징(Electron+steamworks, Capacitor) — 후반

## 알려진 메모 / 주의
- 노드 ID가 여러 번 바뀌어 **옛 세이브의 일부 구매분은 무효**될 수 있음(크래시는 없음)
- 보스를 못 죽이면 밤이 안 끝남 → 도시 전멸 시 소프트 실패로 재도전(소프트락 아님)
- 네트워크 정책상 외부 호스팅 차단(GitHub/npm만 허용) → 모바일 테스트는 GitHub Pages
- Cores 전용 노드/포탑 강화는 Scrap 곡선과 별도 → 밸런스 시뮬에서 같이 튜닝 필요
