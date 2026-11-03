import { ensureSchemaOnce } from "./migrate";
import { query } from "./db";

/* ------------------------------------------------------------------ */
/* 타입                                                                 */
/* ------------------------------------------------------------------ */

export type Claim = {
  code: string;
  tier: number; // 1~5등
  classId: string; // "2-9"
  points: number; // 반점수
  item: string; // 상품 (없으면 "")
  studentId: string;
  studentName: string;
  time: string; // HH:mm (KST)
  createdAt: string;
};

export type Stock = {
  tier: number;
  points: number;
  item: string;
  total: number;
  claimed: number;
  remaining: number;
};

export type CodeRow = {
  code: string;
  tier: number;
  used: boolean;
};

/* ------------------------------------------------------------------ */
/* 공통                                                                 */
/* ------------------------------------------------------------------ */

/** 등록/획득 시각을 한국 시준(Asia/Seoul) HH:mm 캐스팅 */
function formatSeoulTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

type ClaimRow = {
  code: string;
  tier: number;
  class_id: string;
  points: number;
  item: string | null;
  student_id: string;
  student_name: string;
  claimed_at: Date;
};

function toClaim(row: ClaimRow): Claim {
  return {
    code: row.code,
    tier: row.tier,
    classId: row.class_id,
    points: row.points,
    item: row.item ?? "",
    studentId: row.student_id,
    studentName: row.student_name,
    time: formatSeoulTime(row.claimed_at),
    createdAt:
      row.claimed_at instanceof Date ? row.claimed_at.toISOString() : String(row.claimed_at),
  };
}

/* ------------------------------------------------------------------ */
/* 조회                                                                 */
/* ------------------------------------------------------------------ */

/** 획득 내역 전체 (오래된 것부터) */
export async function listClaims(): Promise<Claim[]> {
  await ensureSchemaOnce();
  const rows = await query<ClaimRow>`
    SELECT code, tier, class_id, points, item, student_id, student_name, claimed_at
    FROM treasure_claims
    ORDER BY claimed_at ASC
  `;
  return rows.map(toClaim);
}

/** 등급별 현황 (전체/획득/남음) */
export async function getStock(): Promise<Stock[]> {
  await ensureSchemaOnce();
  const rows = await query<{
    tier: number;
    points: number;
    item: string | null;
    total: number;
    claimed: number;
  }>`
    SELECT t.tier,
           t.class_points AS points,
           t.item,
           t.total_count  AS total,
           (SELECT count(*) FROM treasure_claims c WHERE c.tier = t.tier) AS claimed
    FROM treasure_tiers t
    ORDER BY t.tier ASC
  `;
  return rows.map((r) => ({
    tier: r.tier,
    points: r.points,
    item: r.item ?? "",
    total: r.total,
    claimed: Number(r.claimed),
    remaining: r.total - Number(r.claimed),
  }));
}

/** 관리자용: 미사용(남은) 코드 목록, 등급별 정렬 */
export async function listUnusedCodes(): Promise<Array<{ tier: number; codes: string[] }>> {
  await ensureSchemaOnce();
  const rows = await query<{ code: string; tier: number }>`
    SELECT cd.code, cd.tier
    FROM treasure_codes cd
    LEFT JOIN treasure_claims cl ON cl.code = cd.code
    WHERE cl.code IS NULL
    ORDER BY cd.tier ASC, cd.code ASC
  `;
  const groups = new Map<number, string[]>();
  for (const r of rows) {
    const arr = groups.get(r.tier) ?? [];
    arr.push(r.code);
    groups.set(r.tier, arr);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([tier, codes]) => ({ tier, codes }));
}

/* ------------------------------------------------------------------ */
/* 학생별 획득 상품 (관리자 전용 조회)                                     */
/* ------------------------------------------------------------------ */

export type StudentItemEntry = {
  code: string;
  tier: number;
  item: string;
  time: string;
};

export type StudentItemGroup = {
  studentId: string;
  studentName: string;
  classId: string;
  items: StudentItemEntry[];
};

/** 관리자용: 학생별 보유 상품 목록 (상품을 획득한 학생만) */
export async function listStudentItems(): Promise<StudentItemGroup[]> {
  await ensureSchemaOnce();
  const rows = await query<{
    code: string;
    tier: number;
    item: string;
    student_id: string;
    student_name: string | null;
    class_id: string | null;
    claimed_at: Date;
  }>`
    SELECT si.code, si.tier, si.item, si.student_id,
           cl.student_name, cl.class_id, cl.claimed_at
    FROM student_items si
    LEFT JOIN treasure_claims cl ON cl.code = si.code
    ORDER BY si.student_id ASC, cl.claimed_at ASC
  `;

  const groups = new Map<string, StudentItemGroup>();
  for (const r of rows) {
    const key = r.student_id;
    const group = groups.get(key) ?? {
      studentId: r.student_id,
      studentName: r.student_name ?? "",
      classId: r.class_id ?? "",
      items: [],
    };
    group.items.push({
      code: r.code,
      tier: r.tier,
      item: r.item,
      time: formatSeoulTime(r.claimed_at),
    });
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort((a, b) =>
    b.items.length !== a.items.length ? b.items.length - a.items.length : a.classId.localeCompare(b.classId)
  );
}

/* ------------------------------------------------------------------ */
/* 학생 획득                                                             */
/* ------------------------------------------------------------------ */

export class InvalidCodeError extends Error {
  constructor() {
    super("유효하지 않은 보물 코드 형식입니다.");
    this.name = "InvalidCodeError";
  }
}

export class ClaimedCodeError extends Error {
  constructor(public claim: Claim) {
    super(`이미 등록된 보물입니다. (${claim.time})`);
    this.name = "ClaimedCodeError";
  }
}

/** 학생이 보물 코드를 입력 → 획득 처리 (code 1회성) */
export async function claimTreasure(
  rawCode: string,
  student: { studentId: string; studentName: string; classId: string }
): Promise<Claim> {
  await ensureSchemaOnce();
  const code = rawCode.trim().toUpperCase();
  if (!code) throw new InvalidCodeError();

  const existingClaims = await query<ClaimRow>`
    SELECT code, tier, class_id, points, item, student_id, student_name, claimed_at
    FROM treasure_claims
    WHERE code = ${code}
  `;
  if (existingClaims.length > 0) {
    throw new ClaimedCodeError(toClaim(existingClaims[0]));
  }

  const codeRows = await query<{ tier: number; points: number; item: string | null }>`
    SELECT cd.tier, t.class_points AS points, t.item
    FROM treasure_codes cd
    JOIN treasure_tiers t ON t.tier = cd.tier
    WHERE cd.code = ${code}
  `;
  if (codeRows.length === 0) throw new InvalidCodeError();
  const { tier, points, item } = codeRows[0];

  const now = new Date();
  const rows = await query<ClaimRow>`
    INSERT INTO treasure_claims (code, tier, class_id, points, item, student_id, student_name, claimed_at)
    VALUES (${code}, ${tier}, ${student.classId}, ${points}, ${item}, ${student.studentId}, ${student.studentName}, ${now.toISOString()})
    RETURNING code, tier, class_id, points, item, student_id, student_name, claimed_at
  `;

  // 상품이 있는 보물이면 학생 데이터(인벤토리)에 상품 추가 — 획득 취소 시 FK CASCADE로 자동 회수
  if (item) {
    await query`
      INSERT INTO student_items (code, student_id, item, tier)
      VALUES (${code}, ${student.studentId}, ${item}, ${tier})
    `;
  }

  return toClaim(rows[0]);
}

/* ------------------------------------------------------------------ */
/* 관리자: 보물 코드 등록/관리                                            */
/* ------------------------------------------------------------------ */

export class CodeStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeStockError";
  }
}

export class AdminCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminCodeError";
  }
}

/** 혼동하기 쉬운 문자(0/O, 1/I/L)를 뺀 8자리 랜덤 코드 생성에 사용할 문자집합 */
const CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_CHARSET[Math.floor(Math.random() * CODE_CHARSET.length)];
  }
  return out;
}

async function tierTotal(tier: number): Promise<number> {
  const rows = await query<{ total_count: number }>`
    SELECT total_count FROM treasure_tiers WHERE tier = ${tier}
  `;
  return rows[0].total_count;
}

async function tierCreatedCount(tier: number): Promise<number> {
  const rows = await query<{ count: string }>`
    SELECT count(*) AS count FROM treasure_codes WHERE tier = ${tier}
  `;
  return Number(rows[0].count);
}

/** 해당 등급 코드가 몇 개 더 발급 가능한지 */
export async function tierRemainingBudget(tier: number): Promise<number> {
  await ensureSchemaOnce();
  return (await tierTotal(tier)) - (await tierCreatedCount(tier));
}

/**
 * 관리자 보물 등록(자동 생성): t 등급 코드를 count개 발급
 * 등급별 총 개수 제한을 넘지 않도록 검증
 */
export async function createCodesForTier(
  tier: number,
  count: number
): Promise<string[]> {
  await ensureSchemaOnce();
  if (!Number.isInteger(tier) || tier < 1 || tier > 5) {
    throw new AdminCodeError("등급은 1~5등 중 선택해주세요.");
  }
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new AdminCodeError("수량은 1개 이상 200개 이하로 입력해주세요.");
  }

  const budget = await tierRemainingBudget(tier);
  if (count > budget) {
    throw new CodeStockError(
      `${tier}등 보물은 총 ${await tierTotal(tier)}개이며 남은 발급 한도는 ${budget}개입니다.`
    );
  }

  const created: string[] = [];
  for (let i = 0; i < count; i++) {
    // 중복 회피 재시도
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = randomCode();
      const exists = await query<{ code: string }>`
        SELECT code FROM treasure_codes WHERE code = ${candidate}
      `;
      if (exists.length > 0) continue;
      await query`INSERT INTO treasure_codes (code, tier) VALUES (${candidate}, ${tier})`;
      created.push(candidate);
      break;
    }
    if (created.length !== i + 1) {
      throw new AdminCodeError("코드 생성에 실패했습니다. 다시 시도해주세요.");
    }
  }
  return created;
}

/** 관리자 보물 등록(직접 입력): 미리 준비한 특정 코드를 t 등급으로 등록 */
export async function addCodeManually(rawCode: string, tier: number): Promise<void> {
  await ensureSchemaOnce();
  const code = rawCode.trim().toUpperCase();
  if (code.length < 3 || code.length > 32) {
    throw new AdminCodeError("코드는 3~32자로 입력해주세요.");
  }
  if (!Number.isInteger(tier) || tier < 1 || tier > 5) {
    throw new AdminCodeError("등급은 1~5등 중 선택해주세요.");
  }

  const dupe = await query<{ code: string }>`
    SELECT code FROM treasure_codes WHERE code = ${code}
  `;
  if (dupe.length > 0) {
    throw new AdminCodeError("이미 등록된 보물 코드입니다.");
  }

  const budget = await tierRemainingBudget(tier);
  if (budget < 1) {
    throw new CodeStockError(
      `${tier}등 보물은 총 ${await tierTotal(tier)}개라 더 이상 발급할 수 없습니다.`
    );
  }

  await query`INSERT INTO treasure_codes (code, tier) VALUES (${code}, ${tier})`;
}

/** 관리자: 미사용 코드 삭제 (실수 발급 정정) */
export async function deleteUnusedCode(rawCode: string): Promise<boolean> {
  await ensureSchemaOnce();
  const code = rawCode.trim().toUpperCase();
  const claimed = await query<{ code: string }>`
    SELECT code FROM treasure_claims WHERE code = ${code}
  `;
  if (claimed.length > 0) {
    throw new AdminCodeError("이미 획득 처리된 코드는 획득 내역에서 삭제해주세요.");
  }
  const rows = await query<{ code: string }>`
    DELETE FROM treasure_codes WHERE code = ${code} RETURNING code
  `;
  return rows.length > 0;
}

/** 관리자: 획득 내역에서 개별 보물 취소 (코드는 재사용 가능 상태로 복귀) */
export async function deleteClaim(rawCode: string): Promise<boolean> {
  await ensureSchemaOnce();
  const code = rawCode.trim().toUpperCase();
  const rows = await query<{ code: string }>`
    DELETE FROM treasure_claims WHERE code = ${code} RETURNING code
  `;
  return rows.length > 0;
}

/** 관리자: 획득 내역 전체 초기화 (보물 코드는 유지) */
export async function resetAllClaims(): Promise<number> {
  await ensureSchemaOnce();
  const rows = await query<{ code: string }>`
    DELETE FROM treasure_claims RETURNING code
  `;
  return rows.length;
}
