import type { NextRequest } from "next/server";
import { deleteClaim } from "@/lib/treasures";
import { isAdmin } from "@/lib/admin";

/** 관리자: 획득 내역에서 개별 보물 취소 (코드는 미사용 상태로 복귀) */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  if (!(await isAdmin())) {
    return Response.json({ message: "관리자 인증이 필요합니다." }, { status: 401 });
  }

  const { code } = await params;
  const normalized = decodeURIComponent(code).trim().toUpperCase();

  try {
    const deleted = await deleteClaim(normalized);
    if (!deleted) {
      return Response.json(
        { message: "해당 획득 내역을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    return Response.json({ deleted: true });
  } catch (err) {
    console.error(`DELETE /api/treasures/${code} failed:`, err);
    return Response.json(
      { message: "데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." },
      { status: 503 }
    );
  }
}
