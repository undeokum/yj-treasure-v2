import { cookies } from "next/headers";
import crypto from "node:crypto";

const STUDENT_COOKIE = "yj_student";
const SECRET = process.env.AUTH_SECRET || "yj-treasure-local-secret";

/** "20921" 문자열만 받는다 (5자리 숫자 학번) */
function sign(value: string): string {
  return crypto.createHmac("sha256", SECRET).update(value).digest("base64url");
}

export function makeSessionCookieValue(studentId: string): string {
  return `${studentId}.${sign(studentId)}`;
}

/** 쿠키 값에서 서명된 학번을 되찾는다 */
function parseSessionCookie(cookieValue: string): string | null {
  const [studentId, signature] = cookieValue.split(".");
  if (!studentId || !signature) return null;
  const expected = sign(studentId);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return studentId;
}

/** 현재 요청의 학생 세션(학번) */
export async function getStudentId(): Promise<string | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(STUDENT_COOKIE)?.value;
  if (!value) return null;
  return parseSessionCookie(value);
}

export async function setStudentSession(studentId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(STUDENT_COOKIE, makeSessionCookieValue(studentId), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 12, // 12시간
    path: "/",
  });
}

export async function clearStudentSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(STUDENT_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
  });
}
