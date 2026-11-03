import crypto from "node:crypto";
import { query } from "./db";
import { ensureSchemaOnce } from "./migrate";

/** 학생 계정 도메인 로직 */

export const DEFAULT_PASSWORD = "abcd1234";

/**
 * 학번 구조: 20921 = 2학년 9반 21번
 *  - 첫 자리: 학년 (2)
 *  - 다음 1~2자리: 반 (10반이면 "10", 그 외 "01"~"09"처럼 0으로 채운 2자리)
 *  - 마지막 2~3자리: 번호
 *  예: 20921 → 학년 2 / 반 09 / 번호 21
 */
export type ParsedStudentId = {
  raw: string;
  grade: number;
  classNo: number;
  studentNo: number;
  classId: string; // "2-9"
  label: string; // "2학년 9반 21번"
};

export function parseStudentId(raw: string): ParsedStudentId | null {
  const s = raw.trim();
  if (!/^\d{5}$/.test(s)) return null;
  const grade = Number(s[0]);
  if (grade !== 2) return null; // 이 학기 대상은 2학년

  let classNo: number;
  let studentNo: number;
  if (s[1] === "0") {
    // 0 채움 2자리 반 + 2자리 번호: "20921" → 반 09, 번호 21
    classNo = Number(s.slice(1, 3));
    studentNo = Number(s.slice(3));
  } else {
    // 1자리 반 + 3자리 번호: "29123" → 반 9, 번호 123
    classNo = Number(s[1]);
    studentNo = Number(s.slice(2));
  }
  if (classNo < 1 || classNo > 10) return null;
  if (studentNo < 1 || studentNo > 999) return null;
  return {
    raw: s,
    grade,
    classNo,
    studentNo,
    classId: `2-${classNo}`,
    label: `${grade}학년 ${classNo}반 ${studentNo}번`,
  };
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

async function getStudentRow(studentId: string) {
  const rows = await query<{
    student_id: string;
    name: string;
    password: string;
    password_is_default: boolean;
  }>`SELECT student_id, name, password, password_is_default FROM students WHERE student_id = ${studentId}`;
  return rows[0] ?? null;
}

/** 처음 등록: 기본 비밀번호(abcd1234)로 계정 생성 */
export async function enrollStudent(
  studentId: string,
  name: string
): Promise<void> {
  await ensureSchemaOnce();
  const rows = await query<{ student_id: string }>`
    INSERT INTO students (student_id, name, password, password_is_default)
    VALUES (${studentId}, ${name}, ${hashPassword(DEFAULT_PASSWORD)}, TRUE)
    ON CONFLICT (student_id) DO NOTHING
    RETURNING student_id
  `;
  if (rows.length === 0) {
    throw new AlreadyEnrolledError();
  }
}

export class AlreadyEnrolledError extends Error {
  constructor() {
    super("이미 등록된 학번입니다.");
    this.name = "AlreadyEnrolledError";
  }
}

/** 로그인 검증: 성공 시 mustChangePassword 여부 반환 */
export async function verifyLogin(
  studentId: string,
  password: string
): Promise<{ name: string; mustChangePassword: boolean }> {
  await ensureSchemaOnce();
  const row = await getStudentRow(studentId);
  if (!row) throw new LoginError("등록되지 않은 학번입니다. 먼저 초기 등록을 진행해주세요.");
  if (!verifyPassword(password, row.password)) {
    throw new LoginError("비밀번호가 일치하지 않습니다.");
  }
  return { name: row.name, mustChangePassword: row.password_is_default };
}

export class LoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginError";
  }
}

/** 계정 존재 여부 + 이름 (마이페이지 용) */
export async function getStudent(studentId: string): Promise<{ studentId: string; name: string; mustChangePassword: boolean } | null> {
  await ensureSchemaOnce();
  const row = await getStudentRow(studentId);
  if (!row) return null;
  return {
    studentId: row.student_id,
    name: row.name,
    mustChangePassword: row.password_is_default,
  };
}

/** 개인 비밀번호 변경 (기본 비밀번호에서 변경) */
export async function changeStudentPassword(
  studentId: string,
  newPassword: string
): Promise<void> {
  await ensureSchemaOnce();
  if (newPassword.length < 6) {
    throw new LoginError("새 비밀번호는 6자 이상이어야 합니다.");
  }
  if (newPassword === DEFAULT_PASSWORD) {
    throw new LoginError("기본 비밀번호(abcd1234)는 다른 비밀번호로 변경해주세요.");
  }
  await query`
    UPDATE students
    SET password = ${hashPassword(newPassword)}, password_is_default = FALSE
    WHERE student_id = ${studentId}
  `;
}
