import { query } from "./db";

/**
 * 스키마/시드 데이터를 보장하는 마이그레이션.
 * 첫 API 호출 때 테이블과 보물 등급 기준표를 자동 생성합니다.
 */

/** 보물 등급 기준표 (사용자 제공) */
export const TIERS: Array<{ tier: number; class_points: number; item: string | null; total_count: number }> = [
  { tier: 1, class_points: 10, item: "과자 가방", total_count: 3 },
  { tier: 2, class_points: 5, item: "키링", total_count: 10 },
  { tier: 3, class_points: 4, item: "빼빼로", total_count: 10 },
  { tier: 4, class_points: 2, item: null, total_count: 15 },
  { tier: 5, class_points: 1, item: null, total_count: 39 },
];

let ensured: Promise<void> | null = null;

/** 프로세스당 1회만 실행되도록 캐시 */
async function ensureSchema(): Promise<void> {
  // 보물 등급 정의 (1~5등: 반점수 / 상품 / 총 개수)
  await query`CREATE TABLE IF NOT EXISTS treasure_tiers (
    tier        INTEGER PRIMARY KEY,
    class_points INTEGER NOT NULL,
    item        TEXT,
    total_count INTEGER NOT NULL
  )`;

  // 관리자가 발급/등록한 보물 코드
  await query`CREATE TABLE IF NOT EXISTS treasure_codes (
    code       TEXT PRIMARY KEY,
    tier       INTEGER NOT NULL REFERENCES treasure_tiers(tier),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  // 학생이 코드를 입력하고 획득한 내역 (반점수/상품 수령)
  await query`CREATE TABLE IF NOT EXISTS treasure_claims (
    code         TEXT PRIMARY KEY REFERENCES treasure_codes(code),
    tier         INTEGER NOT NULL,
    class_id     TEXT    NOT NULL,
    points       INTEGER NOT NULL,
    item         TEXT,
    student_id   TEXT    NOT NULL,
    student_name TEXT    NOT NULL,
    claimed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  // 학생별 획득 상품 인벤토리 (상품이 있는 보물만 기록, 획득 취소 시 자동 삭제)
  await query`CREATE TABLE IF NOT EXISTS student_items (
    code       TEXT PRIMARY KEY REFERENCES treasure_claims(code) ON DELETE CASCADE,
    student_id TEXT NOT NULL,
    item       TEXT NOT NULL,
    tier       INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  // 학생 계정
  await query`CREATE TABLE IF NOT EXISTS students (
    student_id     TEXT PRIMARY KEY,      -- 예: 20921 = 2학년 9반 21번
    name           TEXT NOT NULL,
    password       TEXT NOT NULL,         -- scrypt 해시 (salt:hash)
    password_is_default BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  // 등급 기준표 시드 (이미 있으면 건너뜀)
  for (const t of TIERS) {
    await query`
      INSERT INTO treasure_tiers (tier, class_points, item, total_count)
      VALUES (${t.tier}, ${t.class_points}, ${t.item}, ${t.total_count})
      ON CONFLICT (tier) DO NOTHING
    `;
  }
}

export function ensureSchemaOnce(): Promise<void> {
  if (!ensured) {
    ensured = ensureSchema().catch((err) => {
      ensured = null; // 실패 시 재시도 가능하도록
      throw err;
    });
  }
  return ensured;
}
