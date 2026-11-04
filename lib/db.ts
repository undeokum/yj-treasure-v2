import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __db: ReturnType<typeof postgres> | undefined;
}

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. The app cannot connect to Postgres.");
  }
  return url;
}

/** 연결 대상이 로컬 DB인지 판별 (localhost / Docker 내부) */
function isLocalDatabase(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const sslmode = parsed.searchParams.get("sslmode");
    if (sslmode === "disable") return true;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "host.docker.internal";
  } catch {
    return false;
  }
}

/**
 * Next.js 빌드 시점에는 모듈을 읽어들일 때 클라이언트 생성이 실행되지 않도록
 * 전역 캐시가 비어 있으면 프록시 객체를 반환합니다.
 * 실제 쿼리/핑 요청이 들어올 때 비로소 클라이언트를 생성하고 연결합니다.
 */
function getClient(): ReturnType<typeof postgres> {
  if (global.__db) {
    return global.__db;
  }

  if (process.env.DATABASE_URL) {
    const url = getDatabaseUrl();
    const local = isLocalDatabase(url);

    global.__db = postgres(url, {
      // 서버리스(Vercel)에는 작은 커넥션 풀이 적합
      max: local ? 10 : 5,
      idle_timeout: 20,
      connect_timeout: 10,
      // Neon/Supabase 등 클라우드 Postgres는 SSL 필수 → 로컬이 아니면 강제 활성화
      ssl: local ? false : "require",
      // PgBouncer 트랜잭션 풀링(Supabase pooler)은 prepared statement 미지원
      prepare: local,
      // Supabase 트랜잭션 풀러는 search_path가 비어 있으므로 public으로 고정
      connection: { options: "-c search_path=public" },
    });
    return global.__db;
  }

  // 빌드 시점처럼 DATABASE_URL이 없는 상태에서 호출을 막기 위한 프록시.
  const missingClient: ReturnType<typeof postgres> = new Proxy(
    {},
    {
      get() {
        throw new Error(
          "DATABASE_URL is not set. The app cannot connect to Postgres."
        );
      },
    }
  ) as ReturnType<typeof postgres>;

  return missingClient;
}

/**
 * 쿼리 헬퍼.
 * tagged template literal로 사용합니다.
 *
 * 예시:
 *   const rows = await query<{ id: number; name: string }>`
 *     SELECT id, name FROM users WHERE id = ${userId}
 *   `
 */
export const query = getClient() as {
  <T>(template: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
};
