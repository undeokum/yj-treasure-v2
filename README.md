# 수학여행 보물찾기 대작전 (yj-treasure)

수학여행용 반별 보물찾기 랭킹 게임 — 원본 단일 HTML 앱(`C:\Users\User\yj-treasure\index.html`)을 Next.js 16(App Router) + PostgreSQL로 재구축한 프로젝트입니다.

## 구조

```
app/
  layout.tsx                      # CDN 스크립트(Tailwind/html5-qrcode/confetti/폰트) 로딩
  page.tsx                        # 전체 UI (React — 원본 UI 1:1 이식)
  globals.css                     # 픽셀 스타일
  api/treasures/route.ts          # GET 현황(+획득내역) / POST 획득 / DELETE 전체초기화(관리자)
  api/treasures/[code]/route.ts   # DELETE 획득내역 개별 취소 (관리자)
  api/admin/route.ts              # POST 관리자 로그인 / DELETE 로그아웃
  api/admin/codes/route.ts        # POST 보물 등록(자동생성/직접입력) / DELETE 미사용 코드 삭제
  api/auth/*                      # 학생 register/login/me/password/logout
lib/
  db.ts                           # postgres.js 연결 풀
  migrate.ts                      # 스키마 자동 생성 + 보물 등급 기준표 시드 (첫 API 호출 시)
  treasures.ts                    # 등급 기준표/재고/획득/관리자 코드 발급 도메인 로직
  students.ts                     # 학생 계정(학번 파싱, scrypt 비밀번호 해시)
  auth.ts                         # 학생 세션(HMAC 서명 HttpOnly 쿠키)
  admin.ts                        # 관리자 인증 (HttpOnly 쿠키)
```

## 실행

1. PostgreSQL 필요 — `.env.local`: `postgres://postgres:changeme@localhost:5432/yjtreasure` (Docker Desktop의 `postgres_db` 컨테이너 대상), `ADMIN_PASSWORD=in13361336`. 테이블은 첫 API 호출 때 자동 생성됩니다.
2. 서버 실행:

```
npm install
npm run dev     # http://localhost:3001
```

## 기능

- **학생 인증**: 최초엔 "처음이신가요?" 탭에서 학번(5자리)+이름+기본 비밀번호(`abcd1234`)로 등록 → 로그인 시 첫 로그인 화면에서 개인 비밀번호(6자 이상, 기본값과 달라야 함)로 변경 필수
  - **학번 구조: `20921` = 2학년 9반 21번** (학년 1자리 + 반 0채움 2자리 + 번호 2자리). 반 정보는 학번에서 서버가 자동 연결해서 획득 내역에 기록 (예: `20921` → 2-9반)
- **보물 5등급 시스템** (등급별 반점수 / 상품 / 총 개수):

| 등급 | 반점수 | 상품 | 총 개수 |
|---|---|---|---|
| 1등 | 10점 | 과자 가방 | 3개 |
| 2등 | 5점 | 키링 | 10개 |
| 3등 | 4점 | 빼빼로 | 10개 |
| 4등 | 2점 | (상품 없음) | 15개 |
| 5등 | 1점 | (상품 없음) | 39개 |

- 학생이 보물을 찾을 때마다 반점수 + 상품 획득. **등급별 남은 개수를 2초 폴링으로 실시간 표시** (고갈 시 "모두 발견!")
  - 상품이 있는 보물(1~3등)을 찾으면 **학생별 획득 상품 기록**(`student_items` 테이블, 획득 취소 시 자동 회수) — 목록은 **관리자만 볼 수 있음** (`GET /api/treasures` 관리자 세션에만 `studentItems` 포함)
- 보물 코드는 **관리자만 등록 가능**: 등급 선택 → 자동 생성(8자리 랜덤, 혼동 문자 0/O/1/I/L 제외) 또는 직접 입력. 등급별 총 개수를 넘는 발급은 서버에서 거부
- 획득한 코드는 1회성(선착순). 관리자는 획득 내역 개별 취소(코드 복구) / 전체 초기화 / 미사용 코드 삭제 가능
- **반별 실시간 순위** 탭 (반점수 합계) + **G.O.A.T 플레이어** 탭 (개인 1등만 표시, 개인점수 = 획득한 반점수 합계)
- 관리자 모드(비밀번호 `in13361336`, `ADMIN_PASSWORD` 환경변수로 변경 가능): 보물 등록, 미사용 코드 관리, 획득 내역 관리
  - 인증은 서버에서 HttpOnly 쿠키로 검증

## API 요약

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/auth/me` | 현재 세션 확인 (`student`, `mustChangePassword`) |
| `POST /api/auth/register` | 최초 등록 `{studentId, name, password:"abcd1234"}` |
| `POST /api/auth/login` | 로그인 `{studentId, password}` → `mustChangePassword` 반환 |
| `POST /api/auth/password` | 개인 비밀번호 변경 `{newPassword}` |
| `POST /api/auth/logout` | 로그아웃 |
| `GET /api/treasures` | 획득 내역 + 등급별 재고 `{claims, stock}` (`{unusedCodes}`는 관리자 세션에만 포함) |
| `POST /api/treasures` | 보물 획득 `{code}` (세션 학생 기준, 코드 1회성 → 중복 409, 무효 400) |
| `DELETE /api/treasures` | 획득 내역 전체 초기화 (관리자) |
| `DELETE /api/treasures/[code]` | 획득 내역 개별 취소 — 코드는 미사용 상태로 복구 (관리자) |
| `POST /api/admin` | 관리자 로그인 `{password}` |
| `DELETE /api/admin` | 관리자 로그아웃 |
| `POST /api/admin/codes` | 보물 등록 (관리자) — 자동 생성 `{tier, count}` / 직접 입력 `{tier, code}` |
| `DELETE /api/admin/codes` | 미사용 코드 삭제 `{code}` (관리자) |
