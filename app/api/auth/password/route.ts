import type { NextRequest } from "next/server";
import { getStudentId } from "@/lib/auth";
import { changeStudentPassword, LoginError } from "@/lib/students";

/** 개인 비밀번호 변경 (기본 비밀번호 → 개인 비밀번호) */
export async function POST(request: NextRequest) {
  const studentId = await getStudentId();
  if (!studentId) {
    return Response.json({ message: "로그인이 필요합니다. 다시 로그인해주세요." }, { status: 401 });
  }

  let body: { newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  try {
    await changeStudentPassword(studentId, newPassword);
    return Response.json({ ok: true, message: "개인 비밀번호가 설정되었습니다!" });
  } catch (err) {
    if (err instanceof LoginError) {
      return Response.json({ message: err.message }, { status: 400 });
    }
    console.error("POST /api/auth/password failed:", err);
    return Response.json(
      { message: "데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." },
      { status: 503 }
    );
  }
}
