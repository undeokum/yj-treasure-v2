import type { NextRequest } from "next/server";
import { getAdminPassword, signInAdmin, signOutAdmin } from "@/lib/admin";

/** 관리자 로그인: 비밀번호 확인 후 HttpOnly 쿠키 발급 */
export async function POST(request: NextRequest) {
  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (password !== getAdminPassword()) {
    return Response.json(
      { message: "비밀번호가 일치하지 않습니다." },
      { status: 401 }
    );
  }

  await signInAdmin();
  return Response.json({ ok: true });
}

/** 관리자 로그아웃: 쿠키 삭제 */
export async function DELETE() {
  await signOutAdmin();
  return Response.json({ ok: true });
}
