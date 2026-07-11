# City Defender — 플레이테스트 피드백

> 작성 방법은 [PLAYTESTING.md](PLAYTESTING.md) 참고.
> 새 항목은 **Open** 맨 위에 추가. 처리되면 Claude가 Resolved로 옮기고 커밋을 표기.

형식:

```markdown
## [날짜] N번호 — 카테고리(bug/balance/feel/ux/idea) — 한 줄 요약
- 상황:
- 기대:
- 실제:
- 첨부: (세이브 덤프 / 스크린샷 / 콘솔 에러 — 선택)
```

---

## Open

(아직 없음)

---

## Resolved

## [2026-07-11] N?? — balance — 분열 적 대처가 어려움 (필드 주공 체계에서)
- 상황: 필드/캐논 재편 후, 죽을 때 분리되는 적(스플리터)의 자식들이 분리 직후
  풀스피드로 흩어져 펄스 쿨다운(2s) 안에 대응 불가.
- 기대: 분리 직후엔 느리다가 점점 본래 속도로 가속.
- 처리: `CHILD_SPAWN` 가속 램프(35% 시작, 2.5s) — 스플리터 분열 + 캐리어/보스
  사출 공통 적용. 커밋: spawn-ramp (claude/game-mechanic-simplification-4qxuxh).
