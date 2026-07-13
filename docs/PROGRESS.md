# City Defender — Progress Log

> Missile Command 기반 능동형 incremental 게임. 작업 진행 상태 스냅샷.
> 브랜치: `claude/test-coverage-analysis-jx5cq5` (모든 작업이 여기 푸시됨)

## 한 줄 요약
플랜 M1~M5 핵심이 모두 구현됨 — 코어 플레이, 런 루프+경제, 분기형 스킬트리,
자동 포탑 6종, 적 10종+보스, Cores 화폐, 수동 어빌리티 4종.
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
- **적 10종**: ballistic, swarmer(무리), splitter(분열), regenerator(재생),
  phase(점멸 무적), carrier(미니언 사출) — 밤별 가중 등장
  - 월드 2~4 신규 4종: armored(N36, 피격당 고정 데미지 감산 — 잽 무기 카운터),
    cruise(N42, 측면 진입·사인 횡단 후 급강하), mirv(N51, 중고도 3분열 —
    분열 전 격추가 이득, 자식 scrap 0), healer(N66, 주변 적 주기 회복 — 우선표적).
    데뷔는 월드 진입 램프 이후 + 초기 저가중치(캐리어 N12 데뷔의 교훈)
- **타격감 1차**: 보스킬 히트스톱(0.18s, main.ts — sim만 정지, 렌더는 계속),
  킬 셰이크(대형 적/보스만 — `KILL_SHAKE` per-kind 맵, enemyKilled 이벤트에
  kind 추가), 필드 펄스 강화(디스크 플래시 0.3→0.45 + 바깥으로 스냅하는 림 링
  + 피격 적마다 오라 중심→적 지그재그 정전기 아크, fieldHit 이벤트에 from 추가)
- **타격감 2차 — 사운드**: ZzFX 벤더링(`src/audio/zzfx.ts`, 지연 AudioContext
  + 마스터 게인) + `AudioSystem`(`src/audio/sfx.ts`) — 렌더러와 나란히 같은
  GameEvent 스트림 소비. 발사/폭발/킬 팝/필드 잽/도시 피격/보스 등장·격파/
  승패 스팅어 + 빔 3종/어빌리티/실드/mirvSplit/healPulse 등. **킬 팝은 콤보
  피치 사다리**(스택당 반음, 1옥타브 캡), 틱 단위 킬 배칭(N킬=팝 1개, 볼륨만
  증가), 키별 스로틀, 음소거 버튼(#hud-mute) + localStorage, 제스처 언락
- **타격감 2차 — 시각**: 피격 스케일 펀치(플래시 연동 ~14%), 폭발 충격파 링
  (반경 밖으로 스냅), 캐논 머즐 플래시+포신 반동, 보스 사망 다중 버스트+대형
  링+스크린 플래시(#fx-flash, 메가밤은 soft), 플로팅 킬 보상 숫자(DOM
  #float-layer, 콤보 티어 색상, 최대 24개 캡), 콤보 마일스톤(10/25/50) HUD
  펄스+티어 색+차임, 큰 콤보 브레이크 시 붉은 비네트 틱, 도시 HP≤34% 하트비트
  비네트(#fx-vignette), 보스 등장 배너(night-banner 재사용, i18n bossWarning)
- **트리 UX 개편** (플레이테스트 5건 반영):
  - 레벨 게이트 전면 제거 — 선행 1레벨 소유 = 자식 해금, 페이싱은 가격 밴드
    전담 (sim 전략도 '저금 중 잔돈 소비' 로직으로 보정 — 게이트 워크가 사주던
    선행 레벨 구매가 사라지며 N19 스톨이 생겼던 것)
  - Mega Bomb을 OPS 체인 선두로 (requires core, ◆1) — 첫 보스 토큰으로 공격
    어빌리티 구매 가능. EMP→Free Fire가 그 뒤로, flux/singularity 가격 재밴딩
  - 잠긴 실루엣(티어)·안개 노드로 가는 연결선 숨김
  - Day 화면 재배치: 트리 뷰포트가 화면의 ~83%, 상단 결과 한 줄(부제는 월드
    해금 공지 때만), 하단 액션 바(초기화 | ▼최저가/▲최고가 점프 | 다음 밤),
    자원은 트리 우상단 오버레이 칩
  - ▼최저가/▲최고가 점프 버튼: 구매 가능한 노드로 팬 이동 + 툴팁 오픈
- **밸런스 3종** (플레이테스트 논의 반영):
  - **보스 HP 피티**: 보스 밤 연속 패배마다 보스 HP −7% (캡 −30%,
    `bossHpPityFactor`) — volume/scrap 피티가 못 건드리던 벽 자체를 깎아
    재도전이 수렴. 게이트 밤(30의 배수) 웨이브 배수 0.75→0.65 (게이트는 보스
    DPS 시험 — 시뮬에서 보스 체크 전에 물량으로 죽는 밤이 다수였음).
    N30: 7-8트라이 → ~5트라이.
  - ~~사령부(HQ) 내구도~~ — **롤백됨**: 죽은 칸 착탄이 글로벌 풀을 깎는
    설계(폭 비례 누수 24HP + 자가수리)를 넣었으나 플레이테스트에서 정상
    플레이까지 너무 빡세다는 판정. "1칸 몰빵" 카운터는 미해결 과제로 남음 —
    다음 시도는 생존 시계가 아니라 경제 레버(생존 칸 비례 scrap 배율) 권장.
  - **필드 공속 1.67배**: 주기 2.0→1.2s, 펄스 데미지 1 유지(0.6 DPS 파리티안은
    "1펄스=HP1 킬" 브레이크포인트를 깨 스크립트 플레이어가 N1도 못 깸 — HQ
    버퍼가 가리고 있다가 롤백 때 드러남), static_charge +0.5→+0.3/lvl,
    slowSeconds 0.8→0.6 (만렙 0.69s 주기의 상시 슬로우 방지 — 슬로우 가동률은
    40%→50%로 상승). Static Link는 공식상 자동 중립(rate×DPS×주기)이라 무조정.
  - 풀 시뮬 3시드×N120 (HQ 롤백 + 최종 필드값): 동일 진행(N110 벽), 총 실패
    61-65 → **47-48**, 플레이타임 7h → 6h35m. 첫 트라이 난이도 무변화.
- **유인기 제거 + 대체 2종** (피드백: 유인기가 우측 칸에 화력 30-46%를
  몰아줘 "1칸 몰빵"을 설계 수준에서 유발 — x=90이 우측 칸 바로 위):
  - **전선 배당(bld_dividend)**: 유인기 자리(city, 16.8k×3). 모든 scrap ×
    (1 + 8%/lvl × 생존칸비율) — 몰빵 카운터의 경제 레버를 옵트인 보너스로.
    scaledScrap에서 실시간 반영(밤 중 칸이 죽으면 즉시 감소).
  - **처형 프로토콜(execution_protocol)**: automation 티어2 (arsenal_core
    옆, 250k×3). HP 5%/lvl 이하 비보스 즉사 — 리제너레이터 힐백/armored
    칩전 카운터, 후반 오버킬 낭비 절약. executeThreshold 스탯 신설.
  - 세이브 마이그레이션: bld_decoy 레벨 감지 → 구 가격 커브로 scrap 환불.
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
- **CRT 필터** (`#crt` — index.html 오버레이 + style.css): 캔버스 위·DOM UI 아래
  레이어에 순수 CSS로 스캔라인(3px 주기)/RGB 그릴/비네트/롤링 밴드(9s). UI 비적용은
  DOM 순서로 구조 보장. prefers-reduced-motion 대응.
- **트리 재구성 — 3경로 + 졸업 게이트 + 가격 밴드 + 안개** (피드백: 노드 배치가
  난잡, 동시 선택지 과다 — 그리디 측정 24개):
  - `NodeRequirement = string | {id, level}` — **졸업 게이트** 도입 (isUnlocked 확장,
    isRevealed/missingRequirement 신규). UI: 미공개=숨김 / 게이트 미충족=실루엣+"🔒 Lv n"
    (툴팁이 대상 노드·레벨 명시) / 티어 티저 유지.
  - 62노드를 **BATTERY(필드+캐논+레이저) / WORKSHOP(포탑 사다리+사격통제) /
    FOUNDATION(경제+도시+지원) + OPS(◆ 어빌리티 스텁)** 3경로로 재배치. 동일 효과
    반복(Power→Power II 등)은 사다리 위 직렬 발판으로.
  - **가격 밴드 계단** (링 간 ≥1.5×, 겹침 금지): d1 20-80 … d7 15.4k-19.6k.
    딥 링은 의도적으로 월드1 수입 초과(월드2 진입 캐치업 콘텐츠, 총 t1 비용 ~1.5M).
  - 신규 불변식 테스트 3종: 도달 가능성 / 가격 계단 / 프런티어(신규 노드 ≤5,
    후보 평균 ≤15 — 콘텐츠 우선 그리디 시뮬).
  - 밸런스 공동 튜닝: 월드1 게이트 보스 HP 17000→**10000** (구값은 "N24 트리 완매"
    가정), **월드 HP 계단 진입 램프**(worldEntryRampNights=5 — 월드 첫 밤 ×4 절벽
    제거). 시뮬 BUILD_ORDER 중후반 마일스톤 연장 (미사일/테슬라 게이트/딥 스파인).
  - 시뮬 결과 (seed 1/2 모두): N50 클리어 ~3h13-16m (타겟 내), N10 23m/N20 65m/N35
    2h34m. 패배 ~48회가 벽 없이 분산 (최다 N23 7회, 게이트 N30 5회, 월드2 진입 2회).
- **공중 스폰 가속 램프** (피드백: 분열 자식이 잡을 새 없이 흩어짐): spawnChild로
  태어나는 모든 자식(스플리터 분열·캐리어/보스 사출)이 `CHILD_SPAWN` — 35% 속도로
  시작, 2.5초 선형 가속(`rampTimer`, EMP 정지 중엔 램프도 정지). 이동·리드에임
  (effectiveVel) 양쪽 적용. 시뮬: N50 2h02m, 패배 11→9회(의도한 완화).
- **캐논 준어빌리티화** (피드백: "일반 공격 2개가 헷갈림" — 상시 공격 중첩 해소):
  - **홀드 연사 제거** (탭 온리). 'pointer' 커맨드 삭제 — 입력은 aim(호버) + fire(탭) +
    ability 3종. 조작 문법: 커서 = 필드(지속), 탭 = 캐논(강타), 버튼 = 어빌리티.
  - 캐논 리밸런스: 탄창 4→**2**, 재장전 1.5→**4.0s**, 폭발 반경 8→**13**, 데미지
    1→**3** — "적은 탄약, 큰 한 방" 버스트 도구. Free Fire 일제사 6+2/lvl→**3+1/lvl**
    (신형 포탄 6발 = 굴러다니는 메가밤이라 반감).
  - Rapid Trigger 노드 삭제(홀드 전용) → Autoloader로 레벨 마이그레이션(캡 5).
  - 오토파이어 버그픽스: Free Fire 일제사가 재장전 길이 쿨다운에 막히지 않도록
    salvo 중 쿨다운을 burst 간격으로 클램프.
  - 시뮬 AI 교전 임계를 탄창 비율 기준으로 수정. N50 2h07m, 초반 텐션 유지
    (N13-15 패배 클러스터). 테스트 135개.
- **필드 주공 재편** (플레이테스트: 런칭값 필드가 드래그만으로 밤을 캐리 → 역할 반전):
  - 필드 기본치 대폭 너프: 반경 9→**5.5**, 펄스 주기 0.9→**2.0s** (데미지 1 유지).
    트리 필드 사다리 만렙 시 반경 ≈12.4 / 주기 ≈1.15s로 성장 — **펄스가 기본 공격,
    캐논은 탄창 제한 버스트 서브**.
  - UP 트리 재편: 트렁크 = 필드 사다리(Static Charge 링1 게이트웨이 20⬡ → Wide Field
    신규 → Pulse Cycle 신규 → Field Coils → Static Link 키스톤 1750⬡). 캐논 노드 강등:
    blast_radius 링2로, Magazine은 Drum Magazine에 흡수(세이브 마이그레이션, 캡 3),
    autoloader/fast_intercept/rapid_trigger는 워든 측면 체인으로, overcharge_shot 링5.
    warhead 선행조건 wide_blast 단독으로 단순화. turret_laser 선행 → static_charge.
  - 밸런스 시뮬 AI가 **오라를 조준**(0.2s 추적, parkAura)하도록 확장 — 필드 주공
    페이싱을 실제로 검증: N50 클리어 2h12m, 초반 텐션 유지(N8·N14-15 패배 클러스터).
  - 시뮬 BUILD_ORDER 재편(static_charge 첫 구매). 테스트 139개.
- **홀드 연사 + 스태틱 스위프** (초반 조작 피로 완화 — 노드버스터류 드래그 축):
  - **홀드 연사**: `pointer` 커맨드 스트림(press/move/release) → 누르는 동안
    `holdFireInterval`(0.34s)마다 포인터 위치로 발사. 탭 = 기존 클릭과 동일(press 즉발).
    홀드 중 탄창 재생 ×0.85(`holdReloadFactor`) — 단발 정밀 사격의 이점 유지.
    빈 탄창 홀드는 조용히 대기(fireDenied 스팸 없음).
  - **스태틱 필드** (플레이테스트 피드백으로 드래그 스위프에서 재설계 — 클릭&드래그도
    부담이라 "커서를 얹어두는 것"까지 낮춤): 커서/터치를 따라다니는 원형 오라(반경 9)가
    `pulseSeconds`(0.9s)마다 펄스해 반경 안 전원에게 감전(기본 1) + 0.8s 35% 슬로우
    (보스 면역). 히트 시스템 폐지 — 펄스 쿨다운이 유일한 스로틀이고, **오라 테두리의
    24분할 링 프로그레스바**로 표시(가득=점등). 빈 사정권에선 펄스를 아껴 첫 진입 적을
    즉시 감전. 입력은 `aim`(호버 포함 모든 move) + `pointer`(press/release) 2계층.
    **위상 실드 관통**(damageEnemy piercePhase) = 위상 적의 수동 카운터. 킬은 콤보 중립.
  - **신규 노드 4종**(cannon): Static Charge(링1 45⬡, 펄스 +0.5) /
    Field Coils(반경 +12%·펄스 쿨다운 −6%; 구 Heat Sink — 세이브 마이그레이션 있음) /
    Rapid Trigger(홀드 간격 −10%) / Static Link(펄스에 포탑 총DPS +4% — Overcharge의
    필드 대응). 신규 스탯 5종: holdFireInterval, fieldDamage/DpsRate/Radius/PulseSeconds.
  - 밸런스 시뮬 회귀 없음(AI는 미사용 — 신규 노드가 잉여 스크랩만 흡수). 테스트 138개.
- **트리 확장 3차** (레이더/재머/디코이/서지, 6노드):
  Radar Array(건물, 포탑 조준오차 ×0.85^lvl) + Doppler Tracking(phase 무적 관통,
  isUntouchable()) / Jammer Tower(건물, 반경 45 슬로우 필드 12%+6%/lvl) +
  Wide Spectrum(반경 +20%) / ~~Decoy Beacon~~(유인기 — 몰빵 유발로 제거,
  전선 배당으로 대체·환불 마이그레이션) /
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
