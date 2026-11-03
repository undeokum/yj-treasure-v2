import type { NextRequest } from "next/server";
import {
  createCodesForTier,
  addCodeManually,
  deleteUnusedCode,
  AdminCodeError,
  CodeStockError,
} from "@/lib/treasures";
import { isAdmin } from "@/lib/admin";

function toErrorResponse(err: unknown): Response | null {
  if (err instanceof AdminCodeError || err instanceof CodeStockError) {
    return Response.json({ message: err.message }, { status: 400 });
  }
  return null;
}

/**
 * 관리자 보물 등록
 * - 자동 생성: { tier, count } → 새 코드 count개 발급
 * - 직접 입력: { tier, code }  → 특정 코드를 해당 등급으로 등록
 */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return Response.json({ message: "관리자 인증이 필요합니다." }, { status: 401 });
  }

  let body: { tier?: unknown; count?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const tier = typeof body.tier === "number" ? body.tier : NaN;

  try {
    if (typeof body.code === "string" && body.code.trim() !== "") {
      await addCodeManually(body.code, tier);
      return Response.json({ created: [body.code.trim().toUpperCase()], message: "코드가 등록되었습니다." }, { status: 201 });
    }

    const count = typeof body.count === "number" ? body.count : NaN;
    const created = await createCodesForTier(tier, count);
    return Response.json({ created, message: `${tier}등 보물 코드 ${created.length}개가 발급되었습니다.` }, { status: 201 });
  } catch (err) {
    const mapped = toErrorResponse(err);
    if (mapped) return mapped;
    console.error("POST /api/admin/codes failed:", err);
    return Response.json(
      { message: "데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." },
      { status: 503 }
    );
  }
}

/** 관리자: 미사용 코드 삭제 { code } */
export async function DELETE(request: NextRequest) {
  if (!(await isAdmin())) {
    return Response.json({ message: "관리자 인증이 필요합니다." }, { status: 401 });
  }

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code : "";
  if (!code) {
    return Response.json({ message: "삭제할 코드를 지정해주세요." }, { status: 400 });
  }

  try {
    const deleted = await deleteUnusedCode(code);
    if (!deleted) {
      return Response.json({ message: "해당 코드를 찾을 수 없습니다." }, { status: 404 });
    }
    return Response.json({ deleted: true });
  } catch (err) {
    const mapped = toErrorResponse(err);
    if (mapped) return mapped;
    console.error("DELETE /api/admin/codes failed:", err);
    return Response.json(
      { message: "데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." },
      { status: 503 }
    );
  }
}
