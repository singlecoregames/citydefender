import type { TreeNode } from '../core/tree';
import type { AbilityKind } from '../core/types';
import type { Currency } from '../core/tree';

/**
 * UI localisation. English is canonical: UI chrome strings live in the EN
 * table here, and tree node names/descriptions live in core/tree.ts; the KO
 * tables override both, falling back to English for anything missing. The
 * choice persists in localStorage; the default follows the system locale
 * when we support it, else English.
 */
export type Lang = 'en' | 'ko';

export const LANGS: readonly { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
];

const LANG_KEY = 'citydefender-lang';

/** Compact display for currency amounts: 9500 → "9500", 74600 → "74.6k",
 *  7200000 → "7.2M". Exact below 10k so early-game prices stay precise;
 *  world 2+ prices ride the ×5/×20/×70 kill-pay steps into the millions. */
export function formatAmount(n: number): string {
  const trim = (x: number) => (x >= 100 ? `${Math.round(x)}` : x.toFixed(1).replace(/\.0$/, ''));
  if (n < 10000) return `${n}`;
  if (n < 1e6) return `${trim(n / 1e3)}k`;
  if (n < 1e9) return `${trim(n / 1e6)}M`;
  return `${trim(n / 1e9)}B`;
}

interface Strings {
  tagline: string;
  versionNote: string;
  start: string;
  continueNight: (night: number) => string;
  resetSave: string;
  wipeSaveConfirm: string;
  nightWave: (world: number, night: number, wave: number, total: number) => string;
  bossTag: string;
  nightSurvived: (night: number) => string;
  citiesLost: string;
  daySubtitleVictory: string;
  daySubtitleDefeat: string;
  nextNight: string;
  resetRun: string;
  eraseConfirm: string;
  ttCore: string;
  ttMaxed: (level: number, max: number) => string;
  ttLocked: string;
  ttPrice: (icon: string, cost: string, level: number, max: number) => string;
  ttBuyHint: string;
  ttNeedMore: (icon: string, cost: string, currency: Currency, level: number, max: number) => string;
  costCore: string;
  costMax: (level: number) => string;
  costTierLocked: (tier: number) => string;
  tierUnlocked: (world: number) => string;
  ability: Record<AbilityKind, string>;
  ttTierLocked: (tier: number) => string;
}

const EN: Strings = {
  tagline: 'MISSILE COMMAND × ACTIVE INCREMENTAL',
  versionNote: 'prototype — title pending',
  start: 'START',
  continueNight: (n) => `CONTINUE ▸ NIGHT ${n}`,
  resetSave: 'RESET SAVE',
  wipeSaveConfirm: 'TAP AGAIN TO WIPE SAVE',
  nightWave: (wd, n, w, t) => `WORLD ${wd} · NIGHT ${n} — WAVE ${w}/${t}`,
  bossTag: '  ☠ BOSS',
  nightSurvived: (n) => `NIGHT ${n} SURVIVED`,
  citiesLost: 'CITIES LOST',
  daySubtitleVictory: 'Spend scrap on your skill tree, then push on.',
  daySubtitleDefeat: 'You held what you could. Spend, then try again.',
  nextNight: 'NEXT NIGHT ▸',
  resetRun: 'RESET RUN',
  eraseConfirm: 'ERASE EVERYTHING?',
  ttCore: 'Command core',
  ttMaxed: (l, m) => `✓ Maxed (${l}/${m})`,
  ttLocked: '🔒 Locked — unlock its prerequisite first',
  ttPrice: (icon, cost, l, m) => `${icon} ${cost} · Lvl ${l}/${m}`,
  ttBuyHint: 'Tap again to buy',
  ttNeedMore: (icon, cost, cur, l, m) => `${icon} ${cost} · need more ${cur} (Lvl ${l}/${m})`,
  costCore: 'CORE',
  costMax: (l) => `✓ MAX · ${l}`,
  costTierLocked: (tier) => `🔒 WORLD ${tier}`,
  tierUnlocked: (world) => `⭐ WORLD ${world} REACHED — a new tier of nodes just unlocked in the tree.`,
  ability: { emp: 'EMP', megabomb: 'BOMB', freefire: 'FREE', surge: 'SURGE' },
  ttTierLocked: (tier) => `🔒 Tier ${tier} — unlocks in world ${tier}`,
};

const KO: Strings = {
  tagline: '미사일 커맨드 × 액티브 인크리멘탈',
  versionNote: '프로토타입 — 제목 미정',
  start: '시작',
  continueNight: (n) => `이어하기 ▸ ${n}번째 밤`,
  resetSave: '세이브 초기화',
  wipeSaveConfirm: '한 번 더 누르면 삭제됩니다',
  nightWave: (wd, n, w, t) => `월드 ${wd} · ${n}번째 밤 — 웨이브 ${w}/${t}`,
  bossTag: '  ☠ 보스',
  nightSurvived: (n) => `${n}번째 밤 생존`,
  citiesLost: '도시 함락',
  daySubtitleVictory: '스크랩으로 스킬 트리를 강화하고 계속 나아가세요.',
  daySubtitleDefeat: '버틸 만큼 버텼습니다. 강화하고 다시 도전하세요.',
  nextNight: '다음 밤 ▸',
  resetRun: '런 초기화',
  eraseConfirm: '전부 삭제할까요?',
  ttCore: '사령부 코어',
  ttMaxed: (l, m) => `✓ 최대 레벨 (${l}/${m})`,
  ttLocked: '🔒 잠김 — 선행 노드를 먼저 해금하세요',
  ttPrice: (icon, cost, l, m) => `${icon} ${cost} · 레벨 ${l}/${m}`,
  ttBuyHint: '한 번 더 누르면 구매',
  ttNeedMore: (icon, cost, cur, l, m) =>
    `${icon} ${cost} · ${CURRENCY_KO[cur]} 부족 (레벨 ${l}/${m})`,
  costCore: '코어',
  costMax: (l) => `✓ 최대 · ${l}`,
  costTierLocked: (tier) => `🔒 월드 ${tier}`,
  tierUnlocked: (world) => `⭐ 월드 ${world} 도달 — 트리에 새 티어 노드가 해금되었습니다.`,
  ability: { emp: 'EMP', megabomb: '폭탄', freefire: '연사', surge: '서지' },
  ttTierLocked: (tier) => `🔒 티어 ${tier} — 월드 ${tier}에서 해금`,
};

const CURRENCY_KO: Record<Currency, string> = { scrap: '스크랩', cores: '코어' };

/** Korean names/descriptions for skill-tree nodes, keyed by node id. The
 *  descriptions bake in the same numbers as core/tree.ts — keep them in sync
 *  when retuning balance. Missing ids fall back to the English node text. */
const TREE_KO: Record<string, { name: string; description: string }> = {
  core: { name: '사령부', description: '당신의 지휘소. 모든 가지가 여기서 뻗어나갑니다.' },
  blast_radius: { name: '폭발 반경', description: '폭발 반경 +8%' },
  magazine: { name: '탄창', description: '최대 탄약 +1' },
  autoloader: { name: '자동 장전기', description: '재장전 시간 -7%' },
  turret_laser: { name: '레이저', description: '레이저 터렛 배치: 짧은 사거리, 빗나가지 않음 (레벨 = 피해 증가)' },
  wide_blast: { name: '광역 폭발', description: '폭발 반경 +14%' },
  laser_focus: { name: '집속 렌즈', description: '레이저 피해 +25%' },
  fast_intercept: { name: '고속 요격', description: '요격탄 속도 +10%' },
  warhead: { name: '탄두', description: '폭발 피해 +1' },
  combo_memory: { name: '콤보 메모리', description: '콤보가 끊겨도 25% 유지' },
  overcharge_shot: { name: '과충전 사격', description: '수동 폭발에 전체 터렛 DPS의 +4%가 피해로 추가' },
  heavy_warhead: { name: '중탄두', description: '폭발 피해 +1' },
  laser_reach: { name: '빔 연장기', description: '레이저 사거리 +15%' },
  turret_gatling: { name: '개틀링', description: '개틀링 터렛 배치: 빠른 단일 대상 사격 (레벨 = 피해 +30%)' },
  auto_fire: { name: '자동 발사', description: '입력 없이 탄창이 가득하면 캐넌이 스스로 발사 (레벨 = 더 빨리 발동)' },
  turret_power: { name: '터렛 출력', description: '모든 터렛 피해 +15%' },
  gatling_spin: { name: '스핀업', description: '개틀링 발사 속도 +18%' },
  turret_speed: { name: '오버드라이브', description: '모든 터렛 발사 속도 +12%' },
  overcharge_matrix: { name: '과충전 매트릭스', description: '모든 터렛 피해 +40%' },
  ability_surge: { name: '스크랩 서지', description: '수동: 10초간 획득 스크랩 2배. 레벨업 시 지속 연장 / 쿨다운 감소' },
  turret_tesla: { name: '테슬라', description: '테슬라 코일 배치: 연쇄 번개, 최후의 방어선 (레벨 = 피해 증가)' },
  cooling_core: { name: '냉각 코어', description: '모든 터렛 발사 속도 +25%' },
  gatling_belt: { name: '텅스텐 탄띠', description: '개틀링 피해 +25%' },
  turret_power2: { name: '터렛 출력 II', description: '모든 터렛 피해 +15%' },
  tesla_arc: { name: '아크 도체', description: '테슬라 연쇄 도약 +1' },
  turret_speed2: { name: '오버드라이브 II', description: '모든 터렛 발사 속도 +12%' },
  tesla_voltage: { name: '고전압', description: '테슬라 피해 +25%' },
  salvage: { name: '회수', description: '스크랩 획득 +8%' },
  arsenal_core: { name: '무장 코어', description: '모든 피해(터렛·폭발) +50%' },
  drone_escort: { name: '드론 호위', description: '궤도 전투 드론 배치 (+1/레벨)' },
  mirv_warhead: { name: 'MIRV 탄두', description: '요격탄 폭발이 레벨당 자탄 +2개로 분열' },
  salvage_core: { name: '회수 코어', description: '스크랩 획득 +10%' },
  war_effort: { name: '총력전', description: '모든 피해(터렛·폭발) +2%. 레벨 제한 없음' },
  orbital_lance: { name: '궤도 섬멸포', description: '주기적으로 하늘의 빔이 가장 밀집한 적 열을 강타 (레벨 = 주기 단축)' },
  aegis_dome: { name: '이지스 돔', description: '전장을 덮는 방어막이 레벨당 밤마다 적 3기를 증발시킴' },
  war_bonds: { name: '전쟁 채권', description: '밤 클리어 보너스 +20%' },
  turret_flak: { name: '대공포', description: '대공포 터렛 배치: 공중 폭발 범위 피해, 무리에 강함 (레벨 = 피해 증가)' },
  chain_bounty: { name: '연쇄 현상금', description: '한 번의 폭발로 3킬 이상 시 스크랩 +2' },
  flak_payload: { name: '대형 탄두', description: '대공포 폭발 반경 +15%' },
  ability_megabomb: { name: '메가 봄', description: '수동: 전장을 뒤덮는 초대형 폭발. 레벨업 시 반경/피해 증가, 쿨다운 감소' },
  bld_harvester: { name: '스크랩 수확기', description: '배치: 밤새 스스로 스크랩을 채집 (레벨 = 속도 증가)' },
  refinery: { name: '정제소', description: '스크랩 획득 +6%' },
  wave_dividend: { name: '웨이브 배당', description: '웨이브 생존마다 스크랩 +5' },
  reserves: { name: '예비금', description: '밤 클리어 보너스 +30%' },
  flak_fuses: { name: '이중 신관', description: '대공포 발사 속도 +20%' },
  midas_protocol: { name: '미다스 프로토콜', description: '스크랩 획득 +15%' },
  reinforced: { name: '보강', description: '지반 HP +1' },
  bld_shield: { name: '방어막 생성기', description: '배치: 밤마다 지면 충돌 2회 흡수 (레벨 = 충전 +1)' },
  turret_missile: { name: '미사일 포드', description: '미사일 포드 배치: 느리지만 끝까지 쫓는 유도탄 (레벨 = 피해 증가)' },
  compact: { name: '방벽', description: '지반 HP +1' },
  drum_magazine: { name: '드럼 탄창', description: '최대 탄약 +1' },
  missile_salvo: { name: '일제사격 거치대', description: '일제 발사 미사일 +1' },
  bunker: { name: '벙커', description: '지반 HP +1' },
  war_insurance: { name: '전쟁 보험', description: '지면 피격당 스크랩 +10 보상' },
  bld_decoy: { name: '미끼 비콘', description: '배치: 적 30%가 지면 대신 비콘을 노림 (레벨 = +8%)' },
  bld_repair: { name: '수리소', description: '배치: 40초마다 지반 HP 1 수리 (레벨업 시 시간 단축)' },
  bastion_core: { name: '요새 코어', description: '지반 HP +2' },
  districts: { name: '구역화', description: '지반을 +1 구역으로 분할 — 피해가 더 국지적으로 들어옴' },
  missile_warheads: { name: '성형작약', description: '미사일 피해 +30%' },
  ability_emp: { name: 'EMP', description: '수동: 화면의 모든 적을 잠시 정지. 레벨업 시 쿨다운 감소 / 정지 연장' },
  turret_range: { name: '장포신', description: '모든 터렛 사거리 +12%' },
  ability_freefire: { name: '프리 파이어', description: '수동: 무료 사격 일제사 — 소모도 재장전도 없음. 레벨업 시 발수 증가 / 쿨다운 감소' },
  turret_railgun: { name: '레일건', description: '레일건 배치: 모든 것을 관통하는 일직선 사격 (레벨 = 피해 증가)' },
  railgun_pierce: { name: '날탄', description: '레일건 관통 폭 +2' },
  bld_radar: { name: '레이더 어레이', description: '배치: 모든 터렛의 조준 정밀화 (레벨당 탄퍼짐 -15%)' },
  flux_capacitor: { name: '플럭스 커패시터', description: '모든 어빌리티 쿨다운 -8%' },
  doppler_tracking: { name: '도플러 추적', description: '레이더가 위상 상태의 적도 조준하게 해줌' },
  threat_analysis: { name: '위협 분석', description: '터렛이 살아있는 지반으로 향하는 적을 우선 조준' },
  neural_lead: { name: '신경망 조준', description: '터렛 탄퍼짐 -15%' },
  bld_jammer: { name: '재머 타워', description: '배치: 범위 안의 적이 느려짐 (레벨 = 강화)' },
  wide_spectrum: { name: '광대역', description: '재머 범위 반경 +20%' },
  railgun_caps: { name: '고속 커패시터', description: '레일건 발사 속도 +15%' },
  singularity_core: { name: '특이점 코어', description: '모든 어빌리티 쿨다운 -15%' },
  gatling_twin: { name: '트윈 개틀링', description: '우측 측면에 두 번째 개틀링 배치' },
  tesla_twin: { name: '트윈 테슬라', description: '좌측 측면에 두 번째 테슬라 코일 배치' },
  laser_twin: { name: '트윈 레이저', description: '우측 측면에 두 번째 레이저 배치' },
  flak_twin: { name: '트윈 대공포', description: '좌측 측면에 두 번째 대공포 배치' },
  missile_twin: { name: '트윈 미사일 포드', description: '좌측 측면에 두 번째 미사일 포드 배치' },
  railgun_twin: { name: '트윈 레일건', description: '우측 측면에 두 번째 레일건 배치' },
};

const STRINGS: Record<Lang, Strings> = { en: EN, ko: KO };

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'ko') return saved;
  } catch {
    /* storage unavailable (private mode etc.) — fall through to locale */
  }
  const sys = (
    typeof navigator !== 'undefined' ? (navigator.languages?.[0] ?? navigator.language ?? '') : ''
  ).toLowerCase();
  return sys.startsWith('ko') ? 'ko' : 'en';
}

let current: Lang = detectLang();

export function lang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  current = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    /* fine — the choice just won't persist */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

/** The active UI string table. Look strings up at render time, not module
 *  load, so a language switch takes effect immediately. */
export function t(): Strings {
  return STRINGS[current];
}

export function nodeName(node: TreeNode): string {
  return (current === 'ko' && TREE_KO[node.id]?.name) || node.name;
}

export function nodeDescription(node: TreeNode): string {
  return (current === 'ko' && TREE_KO[node.id]?.description) || node.description;
}
