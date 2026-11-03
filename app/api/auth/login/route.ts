import type { NextRequest } from "next/server";
import { verifyLogin, LoginError, parseStudentId } from "@/lib/students";
import { setStudentSession } from "@/lib/auth";

/** 로그인: 학번 + 비밀번호. 기본 비밀번호 사용 중이면 mustChangePassword=true 반환 */
export async function POST(request: NextRequest) {
  let body: { studentId?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  const parsed = parseStudentId(studentId);
  if (!parsed) {
    return Response.json(
      { message: "학번은 5자리 숫자입니다. 예: 20921 (2학년 9반 21번)" },
      { status: 400 }
    );
  }

  try {
    const result = await verifyLogin(parsed.raw, password);
    await setStudentSession(parsed.raw);
    return Response.json({
      ok: true,
      student: { studentId: parsed.raw, name: result.name },
      mustChangePassword: result.mustChangePassword,
    });
  } catch (err) {
    if (err instanceof LoginError) {
      return Response.json({ message: err.message }, { status: 401 });
    }
    console.error("POST /api/auth/login failed:", err);
    return Response.json(
      { message: "데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." },
      { status: 503 }
    );
  }
}
