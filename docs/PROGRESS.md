# City Defender — Progress Log

> Missile Command 기반 능동형 incremental 게임. 작업 진행 상태 스냅샷.
> 브랜치: `claude/test-coverage-analysis-jx5cq5` (모든 작업이 여기 푸시됨)

## 한 줄 요약
플랜 M1~M5 핵심이 모두 구현됨 — 코어 플레이, 런 루프+경제, 분기형 스킬트리,
자동 포탑 6종, 적 6종+보스, Cores 화폐, 수동 어빌리티 4종. 테스트 91개 통과.
트리 확장 완료: 35→55노드. 수동 플레이 보상 축(콤보/Overcharge/▣ Data) 구현됨.

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
- **콤보/Overcharge + Data 화폐** (GDD §3.3·§4.1의 "수동 플레이 후반 가치" 축):
  - **콤보 미터**: 수동 폭발(Explosion.source==='manual')의 킬마다 +1, 전역 scrap
    배율 `1+0.02×min(combo,50)` (balance.COMBO). 수동 폭발이 빗나가거나(킬 0으로
    소멸) 도시 피격 시 break → `comboBroken` 이벤트. HUD에 `#hud-combo`(⚡ n ×mul).
  - **Overcharge Shot**(cannon, scrap): 수동 폭발 데미지 += rate×터렛 총DPS
    (`estimateTurretDps()`를 Sim 생성자에서 캐시). 자동화가 클수록 수동 한 방도 강해짐.
  - **▣ Data 화폐**: 승리한 밤(N20+, balance.DATA.unlockNight)에서만 지급 —
    퍼펙트(도시 무피해) `2+floor(night/10)` + 피크콤보 `floor(maxCombo/12)`(캡 5).
    `nightEnded.dataEarned` → RunState.data. 구세이브는 기본값 0으로 마이그레이션.
  - **Data 전용 노드 4종**: Combo Memory(break 시 콤보 25%/lvl 유지),
    Threat Analysis(터렛이 도시에 실제로 떨어질 적 우선 조준 — threatensCity()
    낙하점 투영), Neural Lead(조준 오차 −15%/lvl, 레이더와 곱연산),
    + Overcharge Shot은 scrap. 트리 51→55노드, Currency에 'data' 추가.
- **홀드 연사 + 스태틱 스위프** (초반 조작 피로 완화 — 노드버스터류 드래그 축):
  - **홀드 연사**: `pointer` 커맨드 스트림(press/move/release) → 누르는 동안
    `holdFireInterval`(0.34s)마다 포인터 위치로 발사. 탭 = 기존 클릭과 동일(press 즉발).
    홀드 중 탄창 재생 ×0.85(`holdReloadFactor`) — 단발 정밀 사격의 이점 유지.
    빈 탄창 홀드는 조용히 대기(fireDenied 스팸 없음).
  - **스태틱 스위프**: 드래그 궤적이 0.35s 유지되는 감전 트레일(`SweepSegment`) —
    닿은 적에게 감전 데미지(기본 0.5, 적당 0.25s 쿨다운) + 0.8s 35% 슬로우(보스 면역).
    히트 게이지(100, 거리당 0.55 소모/초당 30 회복, 과열 후 40%에서 재가동).
    **위상 실드 관통**(damageEnemy piercePhase) = 위상 적의 수동 카운터.
    스위프 킬은 콤보에 중립. HUD: 탄창 칩 상단 히트 바(가득=숨김, 과열=적색).
  - **신규 노드 4종**(cannon): Static Charge(링1 45⬡, 감전 +0.35) /
    Heat Sink(+30 히트·재생 +15%) / Rapid Trigger(홀드 간격 −10%) /
    Static Link(감전에 포탑 총DPS +4% — Overcharge의 스위프 대응).
    신규 스탯 5종: holdFireInterval, sweepDamage, sweepDpsRate, sweepHeatMax/Regen.
  - 밸런스 시뮬 회귀 없음(N50 2h14m→2h17m, AI는 미사용 — 신규 노드가 잉여 스크랩만
    흡수). 테스트 122→135개.
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

## 밸런스 현황 (밸런스 시뮬레이터 1차 튜닝 반영)
`npm run sim`(tools/sim/)으로 N1~50 풀런 검증. 시드 3개 모두 클리어,
타임아웃 0, 소프트락 0 (greedy 전략도 클리어).
- 적 HP: `1.13^(n-1)` (선형항 제거) — N4까지 1, N5에 2, N50≈403.
  선형항이 N4를 2HP로 밀면 초반 벽(8연패)이 생김 — N4는 반드시 1HP여야 함
- 웨이브: `4 + floor(n/3)`개, 적 수 `(5+w)·1.05^(n-1)` **캡 28/웨이브**.
  캡이 없으면 스폰간격 하한(0.32s) 때문에 N30+ 밤이 물리적으로 10분을 초과
- 보상: rewardGrowth 1.13→**1.07** — 1.13이면 수입이 트리를 N13에 완매시킴
- scrapMul 노드가 자기증폭 루프의 주범: salvage 8렙/refinery 6렙으로 제한
- 트리 싱크 연장: 대형 노드 28개 maxLevel 상향(turret_power/speed 14렙 등),
  대형 노드 costGrowth 1.6→1.75~1.8 → 트리가 ~N24까지 소비처 유지
- **첫 클리어 Cores**(`firstClearCores()`): N10+부터 첫 클리어마다 ◆1(+N25부터 2)
  — 보스 단독 공급(~25◆)으로는 ◆트리(~150◆ 싱크)가 굶음
- Data: comboPerData 12→20, cap 5→3 (AI 피크콤보 100+ 기준 과공급 보정)
- 보스: 기본 HP 55×밤스케일, 처치 시 Cores = 2 + 밤/10

### 시뮬 리포트 요약 (seed 1, skill 0.7, smart 전략)
- N50 클리어 ~2h47m(밤 2h13m + Day 35s/회 가정) — Day를 60~90s로 보면 ~3.5h
- N10 27분(목표 25–35 ok) / N20 50분(목표 60–100, 다소 빠름)
- 초반 텐션 정상: N4~N10에서 패배 7~9회(소프트 실패 루프), 이후 자동화 안착

### 시뮬이 드러낸 미해결 설계 과제 (상수 튜닝 한계)
1. **N25+ 무압박**: 트리 완매(~N24) 후 26밤이 전부 1트라이 3/3.
   지수 HP vs 캡된 파워는 교차점이 하나뿐 → 후반 콘텐츠(보스 패턴,
   후반 적 가중, 트리 확장 GDD ~100노드)로 풀어야 함
2. **후반 scrap 싱크 부재**: N25+ 수입이 갈 곳 없음(최종 ⬡5.9억) —
   무한 반복 구매 노드(엔드리스 싱크) 필요
3. **중후반 수동 플레이 무의미**: 포탑이 킬을 독점해 콤보 1~5 수준 —
   GDD의 "포탑도 콤보 적용" 노드, 보스 약점 수동 노출 패턴 등으로 보완
4. **▣ Data 싱크 부족**: 공급 159 vs 싱크 ~26 — 타게팅 AI 모드 등
   Data 전용 노드 추가 필요

## 다음 단계 후보 (아직 안 함)
1. **추가 보스 패턴 + 후반 콘텐츠** — 시뮬이 보여준 N25+ 무압박의 해법.
   N20/30/40/50 고유 보스(Hydra/Bastion/Eclipse/Swarm) + 후반 적 가중 강화
2. **트리 확장 4차** — 엔드리스 scrap 싱크(반복 구매), Data 노드(타게팅 AI 모드),
   "포탑도 콤보 적용" 노드 (시뮬 미해결 과제 2~4번)
3. **사운드(ZzFX)** — 절차적 효과음, 체감 큰 폴리시
4. **엔딩/Endless** — N50 클리어 연출 + 자유 플레이
5. 플랫폼 패키징(Electron+steamworks, Capacitor) — 후반
6. 콤보 연출 폴리시 — 콤보 상승/브레이크 사운드·셰이크, 캐논 주변 링 게이지(GDD §5)

## 알려진 메모 / 주의
- 노드 ID가 여러 번 바뀌어 **옛 세이브의 일부 구매분은 무효**될 수 있음(크래시는 없음)
- 보스를 못 죽이면 밤이 안 끝남 → 도시 전멸 시 소프트 실패로 재도전(소프트락 아님)
- 네트워크 정책상 외부 호스팅 차단(GitHub/npm만 허용) → 모바일 테스트는 GitHub Pages
- Cores 전용 노드/포탑 강화는 Scrap 곡선과 별도 → 밸런스 시뮬에서 같이 튜닝 필요
