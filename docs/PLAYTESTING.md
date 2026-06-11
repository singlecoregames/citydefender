# City Defender — 플레이테스트 & 피드백 가이드

> 게임을 어떻게 테스트하고, 그 결과를 Claude(개발 세션)에 어떻게 전달하는지.
> 피드백은 [`docs/FEEDBACK.md`](FEEDBACK.md)에 누적하는 것이 기본 흐름이다.

---

## 1. 테스트 방법

### A. 데스크톱 (로컬 개발 서버)

```bash
npm ci          # 최초 1회
npm run dev     # → http://localhost:5173
```

- **조작**: 클릭 = 요격 발사, `1`/`2`/`3`/`4` = 어빌리티(EMP/Bomb/Slow/Surge)
- 작업 브랜치를 받으려면: `git fetch origin claude/relaxed-cori-5mdg4y && git checkout claude/relaxed-cori-5mdg4y`

### B. 모바일 (GitHub Pages, 권장)

- **URL**: https://singlecoregames.github.io/citydefender/
- 현재 작업 브랜치(`claude/relaxed-cori-5mdg4y`)와 `master`에 푸시될 때마다
  자동 배포된다 (`.github/workflows/deploy-pages.yml`). 반영까지 1~2분.
- PWA라서 **홈 화면에 추가**하면 풀스크린 가로모드로 실행된다.
- 이전 버전이 보이면 캐시 문제 — 강력 새로고침하거나 PWA를 지웠다 다시 설치.

### C. 세이브 조작 (특정 구간 빠른 확인)

세이브는 `localStorage`의 `citydefender.save` 키에 있다. 브라우저 콘솔(F12)에서:

```js
// 처음부터 다시
localStorage.removeItem('citydefender.save'); location.reload();

// 특정 밤으로 점프 + 자원 지급 (예: N20, scrap 5만, ◆10, ▣10)
const s = JSON.parse(localStorage.getItem('citydefender.save'));
s.run.night = 20; s.run.scrap = 50000; s.run.cores = 10; s.run.data = 10;
localStorage.setItem('citydefender.save', JSON.stringify(s)); location.reload();

// 현재 세이브를 클립보드로 복사 (피드백에 첨부용)
copy(localStorage.getItem('citydefender.save'));
```

> 주의: 점프한 상태는 트리를 정상적으로 키운 상태가 아니므로 **밸런스 체감용으론
> 부적합**하다 (기능 확인용). 밸런스는 처음부터 플레이하거나 세이브를 이어서.

### D. 자동 테스트 & 밸런스 시뮬레이터

```bash
npm test                                  # 단위 테스트 (95개)
npm run sim                               # N1~50 풀런 시뮬 + 페이싱 리포트
npm run sim -- --night=20 --seed=3        # 특정 구간/시드
npm run sim -- --runs=5                   # 시드 5개 요약
npm run sim -- --skill=0.4               # 저숙련 플레이어 가정
npm run sim -- --strategy=greedy          # 막 사는 플레이어 기준선
```

수치 밸런스 의심이 들면 직접 시뮬을 돌려 결과를 그대로 붙여줘도 좋다.

### 구간별 체크포인트 (뭘 봐야 하나)

| 구간 | 봐야 할 것 |
|---|---|
| N1–4 | 수동 요격 손맛, 탄약(6발) 긴장감, 첫 노드 구매 체감. 적은 전부 1HP여야 함 |
| N5–9 | 2HP 적 등장(N5), 스웜 압박, Gatling(180⬡) 구매 타이밍이 자연스러운지 |
| N10 | 첫 보스가 위협적인지, ◆ 획득(보스 + 첫클리어)이 명확히 보이는지 |
| N11–19 | 자동화로의 전환 쾌감, 수동의 역할(콤보 ⚡ 미터, Overcharge Shot 체감) |
| N20+ | ▣ Data 획득(퍼펙트 방어/콤보), Data 노드(Threat Analysis 등) 구매 가치 |
| N25+ | **알려진 문제**: 무압박 자동 진행 (PROGRESS.md 참고 — 중복 보고 불필요) |

---

## 2. 피드백 전달 방법

### 기본 흐름: `docs/FEEDBACK.md`에 누적 → 세션에서 "반영해줘"

1. 플레이 중 발견한 것을 [`docs/FEEDBACK.md`](FEEDBACK.md)에 항목으로 추가
2. 커밋/푸시 (모바일에서 했다면 GitHub 웹에서 직접 편집해도 됨)
3. Claude 세션에서 **"FEEDBACK.md 읽고 반영해줘"** 라고만 하면 됨
4. 처리된 항목은 Claude가 `✅ 처리(커밋 해시)`로 표시하고 Resolved로 이동

급하거나 간단한 건 채팅에 바로 적어도 된다. 형식은 동일하게.

### 피드백 형식

```markdown
## [2026-06-12] N7 — balance — 스웜이 동시에 오면 손쓸 수 없음
- 상황: N7 2번째 웨이브, 스웜 4마리 + 발리스틱 2발 동시 진입
- 기대: 빡빡하지만 탄약을 아껴쓰면 막을 수 있어야
- 실제: 탄창 6발을 다 써도 2마리가 새서 도시 1개는 무조건 잃음
- 첨부: (세이브 덤프 / 스크린샷 / 시드 — 선택)
```

- **카테고리**: `bug`(오동작) / `balance`(난이도·페이싱) / `feel`(손맛·연출) /
  `ux`(조작·가독성) / `idea`(제안)
- **심각도**가 높으면 제목에 `[막힘]`, `[크래시]` 같은 태그를 달기

### 카테고리별로 꼭 들어가야 하는 정보

| 카테고리 | 필수 정보 |
|---|---|
| bug | 무엇을 하던 중이었나, 무슨 일이 났나, 재현되나(몇 번 중 몇 번), **콘솔 에러(F12)** |
| balance | **밤 번호**, 체감(쉬움/어려움/지루함/짧음), 당시 트리 상태 — **세이브 덤프가 최고** |
| feel/ux | 어떤 순간이 어색했나, 어떻게 되길 기대했나. 가능하면 영상/스크린샷 |
| idea | 해결하려는 문제가 뭔지부터. 구현 방법은 안 적어도 됨 |

세이브 덤프(`copy(localStorage.getItem('citydefender.save'))`)는 재현에 가장
유용하다 — 트리 상태·밤 번호·자원이 전부 들어있어서 그 지점부터 그대로 돌려볼 수 있다.

### 좋은 피드백 vs 아쉬운 피드백

- ❌ "어려워" / "재미없어"
- ✅ "N7에서 2번 죽음. 스웜 4마리가 동시에 오면 탄창이 비어서 손을 못 씀.
  도시 하나는 무조건 잃는 느낌" — *언제, 무엇이, 왜*가 있으면 바로 고칠 수 있다
- 체감("지루했다", "통쾌했다")도 그 자체로 귀중한 데이터다. 이유를 몰라도
  **언제** 그랬는지만 적어주면 시뮬레이터와 교차 검증할 수 있다.

### 밸런스 피드백과 시뮬레이터

밸런스 항목은 Claude가 `npm run sim`으로 교차 검증한 뒤 상수를 조정하고,
시드 3개 이상에서 회귀가 없는지 확인 후 반영한다. "체감"과 "수치"가 다를 때는
체감을 우선하되, 원인을 수치로 찾는 식으로 진행한다.
