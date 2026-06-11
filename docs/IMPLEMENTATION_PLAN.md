# City Defender — Implementation Plan

## 1. 기술 스택 (확정)

| 영역 | 선택 | 비고 |
|---|---|---|
| 언어 | TypeScript (strict) | |
| 빌드 | Vite | 웹/Electron/Capacitor 공용 번들 |
| 렌더링 | Three.js + Orthographic 카메라 | `EffectComposer` + `UnrealBloomPass`로 네온 글로우 |
| UI | DOM 오버레이 (vanilla TS + CSS) | 스킬트리/메뉴/HUD. 프레임워크 무의존 → 패키징 단순 |
| 오디오 | ZzFX (절차적 SFX) + WebAudio | 에셋 파일 최소화 |
| 테스트 | Vitest | 코어 시뮬레이션은 100% 헤드리스 테스트 가능 |
| Steam | Electron + `steamworks.js` | 도전과제/클라우드 세이브/오버레이 |
| 모바일 | Capacitor (iOS/Android) | WebView + Preferences/Filesystem 세이브 |
| i18n | JSON 로케일 + `t()` 헬퍼 | `en.json` 기본, `ko.json` 추후 |
| CI | GitHub Actions | typecheck + test + 웹 빌드 |

## 2. 아키텍처 원칙

**"시뮬레이션과 렌더링의 완전 분리"** — 이 게임의 가장 중요한 구조적 결정.

```
┌────────────────────────────────────────────────┐
│ src/core  (Three.js·DOM import 금지)            │
│  고정 타임스텝(60Hz) 결정론적 시뮬레이션          │
│  시드 RNG → 리플레이/테스트/밸런스시뮬 가능       │
└──────────────┬─────────────────────────────────┘
               │ GameState (읽기 전용 뷰) + 이벤트 버스
┌──────────────┴───────────┬─────────────────────┐
│ src/render (Three.js)    │ src/ui (DOM)         │
│ 보간 렌더링, 파티클, 블룸 │ HUD, 스킬트리, 메뉴   │
└──────────────────────────┴─────────────────────┘
               │
┌──────────────┴─────────────────────────────────┐
│ src/platform — PlatformAdapter 인터페이스        │
│  web / electron / capacitor 구현체               │
│  save·load, achievements, quit, openURL, haptics │
└────────────────────────────────────────────────┘
```

이 분리가 주는 것:
1. **밸런스 시뮬레이터** — 코어만 import해서 AI 플레이어로 수천 밤을 돌려
   "4–5시간 페이싱"을 수치로 검증 (`npm run sim`).
2. **테스트 용이성** — 충돌/경제/트리 효과를 브라우저 없이 Vitest로 검증.
3. **플랫폼 이식** — 렌더/플랫폼 레이어만 교체하면 됨.

### 디렉터리 구조
```
citydefender/
├─ docs/                    # 본 문서들
├─ src/
│  ├─ core/
│  │  ├─ sim.ts             # 고정 타임스텝 루프, GameState
│  │  ├─ rng.ts             # 시드 RNG (mulberry32)
│  │  ├─ entities/          # missile, explosion, city, turret, projectile, boss
│  │  ├─ systems/           # spawn, movement, collision, targeting, combo, economy
│  │  ├─ waves/             # waveTable.ts (데이터), director.ts (스폰 스케줄러)
│  │  ├─ upgrades/          # tree.ts (노드 데이터), effects.ts (스탯 적용)
│  │  ├─ balance/           # 모든 수치 상수 (한 곳에)
│  │  └─ save/              # 직렬화/마이그레이션 (버전 필드 필수)
│  ├─ render/               # scene, meshFactory(절차 도형), particles, trails, bloom, shake
│  ├─ ui/                   # hud, skilltree, nightSummary, menus, settings
│  ├─ platform/             # adapter.ts + web.ts / electron.ts / capacitor.ts
│  ├─ audio/                # zzfx 래퍼, 사운드 정의
│  ├─ i18n/                 # t.ts + locales/en.json
│  └─ main.ts
├─ tools/sim/               # 밸런스 시뮬레이터 (AI 플레이어 + 리포트)
├─ tests/                   # vitest
├─ electron/                # main.cjs, preload, steamworks 연동
├─ capacitor.config.ts
└─ .github/workflows/ci.yml
```

## 3. 마일스톤

각 마일스톤은 "실행해서 확인 가능한 상태"로 끝난다.

### M0 — Scaffolding (0.5일 분량)
- Vite + TS strict + Three.js + Vitest + ESLint/Prettier + GitHub Actions CI.
- 빈 씬에 블룸 적용된 도형 하나 + 고정 타임스텝 루프 검증.

### M1 — Missile Command 코어 (핵심 마일스톤)
- 수동 캐논: 클릭 → 요격탄 비행 → 폭발(팽창 원) → 원-원 충돌 판정.
- Ballistic 적 낙하, 도시 피격/파괴, 탄창+재생.
- 웨이브 1개 하드코딩. **이 시점에서 "재미 체크" 1차** — 폭발 타이밍 게임이 손맛 나는지.
- 테스트: 충돌 판정, 탄약 재생, 결정론(같은 시드 = 같은 결과).

### M2 — 런 루프 + 경제
- Night/Day 상태머신, 웨이브 테이블 데이터화, Scrap 획득/정산, 밤 종료 요약 화면.
- 세이브/로드 (web adapter, localStorage). 소프트 실패(60% 정산) 동작.

### M3 — 스킬트리
- 노드 데이터 스키마(id, 브랜치, 비용, 화폐, 선행조건, 효과) → 효과는 전부
  **선언적 스탯 수정자**(`{stat:"explosionRadius", mul:1.15}`)로 처리. 하드코딩 분기 금지.
- DOM 스킬트리 UI (팬/줌, 구매, 미리보기). Cannon/Economy/City 브랜치부터.

### M4 — 자동화
- 포탑 엔티티 5종 + 타게팅 시스템(우선순위 전략 패턴), 포대 슬롯/배치 UI.
- Cores 화폐, N10 보스(Carrier) 1종. **"첫 자동 포탑의 쾌감" 재미 체크 2차.**

### M5 — 콘텐츠 & 밸런스
- 전체 적 8종 + 보스 5종 + Night 1–50 웨이브 테이블 + 어빌리티 3종 + Data 화폐.
- **밸런스 시뮬레이터 구축**: greedy/branch-focus AI로 풀런 시뮬 → 밤별 소요시간,
  총 플레이타임, 화폐 곡선 리포트. 4–5시간에 수렴할 때까지 `balance/` 상수 튜닝.

### M6 — Juice & 오디오
- 트레일, 파티클, 셰이크, 히트스톱, 콤보 연출, ZzFX 사운드 전체, 엔딩 연출, 설정 화면.

### M7 — 플랫폼
- Electron 패키징 + steamworks.js (도전과제 8~12개, 클라우드 세이브).
- Capacitor iOS/Android: 터치 입력, 세이프에어리어, 성능 검증 (저사양 = 파티클 LOD).
- PlatformAdapter 3종 완성. 웹 빌드는 itch.io/데모용으로 유지.

### M8 — 릴리스 준비
- 세이브 마이그레이션 테스트, 성능 패스(드로우콜/GC), i18n `ko.json`, 페이지/스토어 에셋.

## 4. 핵심 기술 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 후반 객체 수 폭증 (미사일 수백 + 파티클) | 전 엔티티 오브젝트 풀링, 파티클은 단일 BufferGeometry 인스턴싱, 충돌은 공간 해시 그리드 |
| 모바일 WebView에서 블룸 비용 | 블룸 해상도 0.5× 다운샘플 + 품질 설정(Low = 블룸 off, 가산 스프라이트로 대체) |
| 밸런스가 4–5시간을 못 맞춤 | M5의 헤드리스 시뮬레이터로 상시 검증 — 감이 아닌 수치로 튜닝 |
| 세이브 호환성 깨짐 | save 스키마에 `version` + 마이그레이션 함수 체인, CI에 구버전 픽스처 테스트 |
| steamworks.js와 Electron 버전 궁합 | M7 초입에 스파이크로 먼저 검증 (빈 앱 + 도전과제 1개) |

## 5. 첫 구현 순서 (다음 작업)

1. M0 스캐폴딩 커밋
2. M1 코어 플레이 — `core/sim` + 최소 렌더로 클릭-요격-폭발 루프
3. 재미 체크 후 M2 진행

— 진행 중 결정이 필요한 사항(포탑 배치 UI 방식, 보스 패턴 디테일, 도전과제 목록 등)은
그때그때 질문으로 확인한다.
