import { cookies } from "next/headers";

export const ADMIN_COOKIE = "yj_admin";

/** 관리자 비밀번호 (환경변수 우선, 기본값 in13361336) */
export function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "in13361336";
}

/** 현재 요청에 관리자 인증 쿠키가 유효한지 확인 */
export async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_COOKIE)?.value === "ok";
}

/** 관리자 로그인 (HttpOnly 쿠키 발급, 12시간) */
export async function signInAdmin(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, "ok", {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 12,
    path: "/",
  });
}

/** 관리자 로그아웃 (쿠키 삭제) */
export async function signOutAdmin(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
  });
}
