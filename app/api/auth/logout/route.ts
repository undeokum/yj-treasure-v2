import { clearStudentSession } from "@/lib/auth";

/** 로그아웃 */
export async function POST() {
  await clearStudentSession();
  return Response.json({ ok: true });
}
