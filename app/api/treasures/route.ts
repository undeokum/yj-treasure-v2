import type { NextRequest } from "next/server";
import {
  listClaims,
  getStock,
  listUnusedCodes,
  listStudentItems,
  claimTreasure,
  resetAllClaims,
  InvalidCodeError,
  ClaimedCodeError,
} from "@/lib/treasures";
import { isAdmin } from "@/lib/admin";
import { getStudentId, clearStudentSession } from "@/lib/auth";
import { parseStudentId, getStudent } from "@/lib/students";

/** DB 유래 서버 에러 통일 응답 */
function dbUnavailable(): Response {
  return Response.json(
    { message: "데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." },
    { status: 503 }
  );
}

/**
 * GET: 보물 현황(등급별 남은 개수) + 획득 내역
 * 관리자 세션이면 미사용 코드 목록도 함께 반환 (QR 인쇄/관리용)
 */
export async function GET() {
  try {
    const [claims, stock] = await Promise.all([listClaims(), getStock()]);
    const base: Record<string, unknown> = { claims, stock };
    if (await isAdmin()) {
      base.unusedCodes = await listUnusedCodes();
      base.studentItems = await listStudentItems();
    }
    return Response.json(base);
  } catch (err) {
    console.error("GET /api/treasures failed:", err);
    return dbUnavailable();
  }
}

/** POST: 학생 보물 획득 (세션 학생 기준, 코드 1회성) */
export async function POST(request: NextRequest) {
  // 로그인 세션 확인
  const studentId = await getStudentId();
  if (!studentId) {
    return Response.json({ message: "로그인이 필요합니다. 다시 로그인해주세요." }, { status: 401 });
  }
  const session = await getStudent(studentId);
  if (!session) {
    await clearStudentSession();
    return Response.json({ message: "세션이 만료되었습니다. 다시 로그인해주세요." }, { status: 401 });
  }

  const parsed = parseStudentId(studentId);
  if (!parsed) {
    return Response.json({ message: "학번 형식이 올바르지 않습니다." }, { status: 400 });
  }

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const rawCode = typeof body.code === "string" ? body.code : "";
  const code = rawCode.trim().toUpperCase();

  if (!code) {
    return Response.json({ message: "보물 코드를 입력해 주세요." }, { status: 400 });
  }

  try {
    const claim = await claimTreasure(code, {
      studentId: parsed.raw,
      studentName: session.name,
      classId: parsed.classId, // 학번 구조에서 자동 연결: 20921 → 2-9반
    });
    return Response.json({ claim }, { status: 201 });
  } catch (err) {
    if (err instanceof ClaimedCodeError) {
      return Response.json(
        {
          message: `이미 [${err.claim.classId}반](${err.claim.studentName})에서 등록한 보물입니다! (${err.claim.time})`,
          claim: err.claim,
        },
        { status: 409 }
      );
    }
    if (err instanceof InvalidCodeError) {
      return Response.json({ message: err.message }, { status: 400 });
    }
    console.error("POST /api/treasures failed:", err);
    return dbUnavailable();
  }
}

/** DELETE: 획득 내역 전체 초기화 (관리자 인증 필요) */
export async function DELETE() {
  if (!(await isAdmin())) {
    return Response.json({ message: "관리자 인증이 필요합니다." }, { status: 401 });
  }

  try {
    const deleted = await resetAllClaims();
    return Response.json({ deleted, message: "모든 획득 내역이 초기화되었습니다." });
  } catch (err) {
    console.error("DELETE /api/treasures failed:", err);
    return dbUnavailable();
  }
}
