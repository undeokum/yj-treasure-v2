import { getStudentId, clearStudentSession } from "@/lib/auth";
import { getStudent } from "@/lib/students";

/** 현재 로그인 세션 확인 (쿠키 기반) */
export async function GET() {
  const studentId = await getStudentId();
  if (!studentId) {
    return Response.json({ student: null });
  }

  try {
    const student = await getStudent(studentId);
    if (!student) {
      await clearStudentSession();
      return Response.json({ student: null });
    }
    return Response.json({
      student: { studentId: student.studentId, name: student.name },
      mustChangePassword: student.mustChangePassword,
    });
  } catch (err) {
    console.error("GET /api/auth/me failed:", err);
    return Response.json(
      { message: "데이터베이스에 연결할 수 없습니다." },
      { status: 503 }
    );
  }
}
