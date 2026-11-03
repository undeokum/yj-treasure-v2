import type { NextRequest } from "next/server";
import { enrollStudent, AlreadyEnrolledError, parseStudentId, DEFAULT_PASSWORD } from "@/lib/students";

/**
 * 최초 등록: 학번(5자리) + 이름 + 기본 비밀번호(abcd1234)로 계정 생성
 * 학번 구조: 20921 = 2학년 9반 21번
 */
export async function POST(request: NextRequest) {
  let body: { studentId?: unknown; name?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  const parsed = parseStudentId(studentId);
  if (!parsed) {
    return Response.json(
      { message: "학번은 5자리 숫자여야 합니다. 예: 20921 (2학년 9반 21번)" },
      { status: 400 }
    );
  }
  if (name.length < 2 || name.length > 10) {
    return Response.json(
      { message: "이름은 2자 이상 10자 이하로 입력해주세요." },
      { status: 400 }
    );
  }
  if (password !== DEFAULT_PASSWORD) {
    return Response.json(
      { message: `기본 비밀번호(${DEFAULT_PASSWORD})와 일치하지 않습니다. 선생님께 안내받은 기본 비밀번호를 입력해주세요.` },
      { status: 400 }
    );
  }

  try {
    await enrollStudent(parsed.raw, name);
    return Response.json({ ok: true, message: `${parsed.label} ${name} 학생, 초기 등록이 완료되었습니다.` }, { status: 201 });
  } catch (err) {
    if (err instanceof AlreadyEnrolledError) {
      return Response.json(
        { message: "이미 등록된 학번입니다. 로그인 탭에서 로그인해주세요." },
        { status: 409 }
      );
    }
    console.error("POST /api/auth/register failed:", err);
    return Response.json(
      { message: "데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." },
      { status: 503 }
    );
  }
}
