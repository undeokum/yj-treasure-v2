"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* 타입 & 상수                                                         */
/* ------------------------------------------------------------------ */

type MessageKind = "success" | "error" | "warning" | "info";
type Message = { kind: MessageKind; text: string };

type Claim = {
  code: string;
  tier: number; // 1~5등
  classId: string;
  points: number; // 반점수
  item: string; // 상품 (없으면 "")
  studentId: string;
  studentName: string;
  time: string;
};

type Stock = {
  tier: number;
  points: number;
  item: string;
  total: number;
  claimed: number;
  remaining: number;
};

type StudentSession = { studentId: string; name: string };
type StudentItemEntry = { code: string; tier: number; item: string; time: string };
type StudentItemGroup = { studentId: string; studentName: string; classId: string; items: StudentItemEntry[] };
type SyncStatus = "connecting" | "online" | "offline";
type Html5QrcodeLike = {
  start: (
    camera: string | Record<string, unknown>,
    config: { fps: number; qrbox: { width: number; height: number } },
    onSuccess: (decodedText: string) => void,
    onError?: (msg: string) => void
  ) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
};

declare global {
  interface Window {
    Html5Qrcode?: (new (elementId: string) => Html5QrcodeLike) & {
      getCameras?: () => Promise<Array<{ id: string; label: string }>>;
    };
    confetti?: (opts: Record<string, unknown>) => void;
  }
}

const DEFAULT_PASSWORD = "abcd1234";
const TIER_COUNTS: Record<number, number> = { 1: 3, 2: 10, 3: 10, 4: 15, 5: 39 };
const TIER_ITEMS: Record<number, string> = { 1: "과자 가방", 2: "키링", 3: "빼빼로" };

/** 학번 구조: 20921 = 2학년 9반 21번 (반은 0 채움 2자리) */
function parseStudentIdClient(raw: string) {
  const s = raw.trim();
  if (!/^\d{5}$/.test(s)) return null;
  const grade = Number(s[0]);
  if (grade !== 2) return null;
  let classNo: number;
  let studentNo: number;
  if (s[1] === "0") {
    classNo = Number(s.slice(1, 3));
    studentNo = Number(s.slice(3));
  } else {
    classNo = Number(s[1]);
    studentNo = Number(s.slice(2));
  }
  if (classNo < 1 || classNo > 10 || studentNo < 1 || studentNo > 999) return null;
  return { classId: `2-${classNo}`, label: `${grade}학년 ${classNo}반 ${studentNo}번` };
}

function tierLabel(tier: number) {
  return `${tier}등`;
}

/* ------------------------------------------------------------------ */
/* 컴포넌트                                                              */
/* ------------------------------------------------------------------ */

export default function TreasureHuntPage() {
  // 로그인 세션
  const [authReady, setAuthReady] = useState(false);
  const [student, setStudent] = useState<StudentSession | null>(null);
  const [mustChange, setMustChange] = useState(false);

  // 인증 폼 상태
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [signupId, setSignupId] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupPw, setSignupPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPwConfirm, setNewPwConfirm] = useState("");
  const [authMsg, setAuthMsg] = useState<Message | null>(null);

  // 관리/탭 상태
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [mainTab, setMainTab] = useState<"register" | "classRank" | "goat">("register");
  const [inputMode, setInputMode] = useState<"scan" | "manual">("scan");

  // 관리자 보물 등록 폼
  const [adminTier, setAdminTier] = useState(1);
  const [adminMode, setAdminMode] = useState<"generate" | "manual">("generate");
  const [adminCount, setAdminCount] = useState("1");
  const [adminManualCode, setAdminManualCode] = useState("");
  const [lastCreatedCodes, setLastCreatedCodes] = useState<string[] | null>(null);
  const [adminMsg, setAdminMsg] = useState<Message | null>(null);

  // 카메라
  const scannerRef = useRef<Html5QrcodeLike | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // 데이터
  const [claims, setClaims] = useState<Record<string, Claim>>({});
  const [stock, setStock] = useState<Stock[]>([]);
  const [unusedCodes, setUnusedCodes] = useState<Array<{ tier: number; codes: string[] }> | null>(null);
  const [studentItems, setStudentItems] = useState<StudentItemGroup[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");

  // UI 상태
  const [message, setMessage] = useState<Message | null>(null);
  const [treasureCodeInput, setTreasureCodeInput] = useState("");

  const adminPanelRef = useRef<HTMLElement | null>(null);

  const myInfo = student ? parseStudentIdClient(student.studentId) : null;

  /* ------------------------- 세션 복원 ------------------------- */

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data.student) {
            setStudent(data.student);
            setMustChange(Boolean(data.mustChangePassword));
          }
        }
      } catch {
        /* 오프라인 - 로그인 화면 유지 */
      }
      setAuthReady(true);
    })();
  }, []);

  /* ------------------------- 실시간 동기화 ------------------------- */

  const fetchTreasures = useCallback(async () => {
    try {
      const res = await fetch("/api/treasures", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: {
        claims: Array<Claim & { code: string }>;
        stock: Stock[];
        unusedCodes?: Array<{ tier: number; codes: string[] }>;
        studentItems?: StudentItemGroup[];
      } = await res.json();

      setClaims(() => {
        const next: Record<string, Claim> = {};
        for (const c of data.claims) {
          next[c.code] = c;
        }
        return next;
      });
      setStock(data.stock);
      if (data.studentItems) setStudentItems(data.studentItems); // 관리자 전용 응답
      if (data.unusedCodes) {
        setUnusedCodes(data.unusedCodes); // 관리자 세션만 받음
        setIsAdminUser(true); // 관리자 쿠키가 살아있으면 패널도 복원
      }
      setSyncStatus("online");
    } catch {
      setSyncStatus("offline");
    }
  }, []);

  useEffect(() => {
    fetchTreasures();
    const timer = window.setInterval(fetchTreasures, 2000);
    return () => window.clearInterval(timer);
  }, [fetchTreasures]);

  /* ------------------------- 인증 액션 ------------------------- */

  const handleLogin = useCallback(async (studentId: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: String(data.message ?? "로그인에 실패했습니다.") };
    }
    setStudent(data.student);
    setMustChange(Boolean(data.mustChangePassword));
    return { ok: true, message: "" };
  }, []);

  const loginSubmit = async () => {
    setAuthMsg({ kind: "info", text: "확인 중..." });
    const result = await handleLogin(loginId.trim(), loginPw);
    if (!result.ok) {
      setAuthMsg({ kind: "error", text: result.message });
      return;
    }
    setLoginPw("");
    fetchTreasures();
  };

  const signupSubmit = async () => {
    setAuthMsg({ kind: "info", text: "초기 등록 중..." });
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: signupId.trim(),
        name: signupName.trim(),
        password: signupPw,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAuthMsg({ kind: "error", text: String(data.message ?? "초기 등록에 실패했습니다.") });
      return;
    }

    // 등록 성공 → 자동 로그인
    const login = await handleLogin(signupId.trim(), signupPw);
    if (!login.ok) {
      setAuthMode("login");
      setAuthMsg({ kind: "info", text: "초기 등록 완료! 로그인해주세요." });
      return;
    }
    setAuthMsg(null);
    setSignupPw("");
    fetchTreasures();
  };

  const changePasswordSubmit = async () => {
    if (newPw !== newPwConfirm) {
      setAuthMsg({ kind: "warning", text: "새 비밀번호가 서로 일치하지 않습니다." });
      return;
    }
    setAuthMsg({ kind: "info", text: "설정 중..." });
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: newPw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAuthMsg({ kind: "error", text: String(data.message ?? "비밀번호 변경에 실패했습니다.") });
      return;
    }
    setMustChange(false);
    setNewPw("");
    setNewPwConfirm("");
    setAuthMsg(null);
    showMessage(`🎉 ${student?.name ?? ""} 학생, 개인 비밀번호 설정 완료! 보물찾기를 시작하세요.`, "success");
  };

  const logoutStudent = async () => {
    void fetch("/api/auth/logout", { method: "POST" });
    setStudent(null);
    setMustChange(false);
    setAuthMode("login");
    setLoginId("");
    setLoginPw("");
    setAuthMsg(null);
  };

  /* ------------------------- 보물 획득 ------------------------- */

  const showMessage = (text: string, kind: MessageKind) => setMessage({ kind, text });

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    setIsScanning(false);
    if (!scanner) return;
    try {
      await scanner.stop();
      scanner.clear();
    } catch (err) {
      console.error("Camera stop error:", err);
    }
  }, []);

  const processTreasureCode = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim().toUpperCase();

      if (!code) {
        showMessage("보물 코드를 입력해 주세요.", "warning");
        return;
      }

      try {
        const res = await fetch("/api/treasures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await res.json().catch(() => ({}));

        if (res.status === 401) {
          void logoutStudent();
          showMessage(String(data.message ?? "다시 로그인해주세요."), "warning");
          return;
        }
        if (res.status === 409) {
          // code는 1회성 — 먼저 등록한 학생 소유 (선착순)
          const ex = data.claim as Claim & { code: string };
          showMessage(
            `❌ 이미 [${ex.classId}반](${ex.studentName})에서 등록한 보물입니다! (${ex.time})`,
            "error"
          );
          return;
        }
        if (res.status === 400) {
          showMessage(String(data.message ?? "유효하지 않은 보물 코드 형식입니다."), "warning");
          return;
        }
        if (!res.ok) {
          showMessage(String(data.message ?? "보물 등록에 실패했습니다."), "error");
          return;
        }

        // 성공! — 반점수 + 상품 획득
        const t = data.claim as Claim & { code: string };
        setClaims((prev) => ({ ...prev, [t.code]: t }));

        if (typeof window !== "undefined" && window.confetti) {
          window.confetti({
            particleCount: 120,
            spread: 70,
            origin: { y: 0.7 },
          });
        }

        const itemText = t.item ? `, 상품: ${t.item}` : "";
        showMessage(`🎉 ${tierLabel(t.tier)} 보물 발견! +${t.points}점${itemText}`, "success");
        setTreasureCodeInput("");
        fetchTreasures();
      } catch {
        showMessage("서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.", "error");
      }
    },
    [fetchTreasures]
  );

  const submitManualCode = () => processTreasureCode(treasureCodeInput);

  /* ------------------------- 카메라 제어 ------------------------- */

  const startCamera = async () => {
    const placeholderMounted = document.getElementById("scannerPlaceholder");
    if (placeholderMounted) placeholderMounted.classList.add("hidden");

    const Html5 = window.Html5Qrcode;
    if (!Html5) {
      showMessage("스캐너 라이브러리를 불러오지 못했습니다. 직접 입력 모드를 이용해주세요.", "error");
      return;
    }

    // HTTP(localhost 제외) 등 보안 컨텍스트 문제 — getUserMedia를 못 쓰는 환경 선차단
    if (!navigator.mediaDevices?.getUserMedia) {
      showMessage(
        "카메라 API를 사용할 수 없습니다. https 또는 localhost 주소로 접속해주세요.",
        "error"
      );
      return;
    }

    // 권한이 이미 차단된 경우 시도 전에 바로 안내 (차단 해제 방법 제시)
    try {
      const perm = await navigator.permissions?.query({ name: "camera" as PermissionName });
      if (perm?.state === "denied") {
        showMessage(
          "카메라 권한이 차단돼 있습니다. 주소창 왼쪽 카메라 아이콘을 눌러 '허용'으로 바꾼 뒤 다시 시도해주세요.",
          "error"
        );
        return;
      }
    } catch {
      // permissions API 미지원 브라우저는 그냥 진행
    }

    try {
      let scanner = new Html5("reader");
      scannerRef.current = scanner;

      // 표시 박스에 맞춰 QR 스캔 영역 크기 산정
      const readerEl = document.getElementById("reader");
      const side = Math.max(120, Math.min(220, Math.floor((readerEl?.clientWidth ?? 240) * 0.7)));

      const onSuccess = (decodedText: string) => {
        void processTreasureCode(decodedText);
        void stopCamera();
      };

      const startOnce = async (sc: Html5QrcodeLike, constraints: Record<string, unknown>) => {
        await sc.start(constraints, { fps: 10, qrbox: { width: side, height: side } }, onSuccess, () => {});
      };

      // 후면 카메라를 우선 시도하되, 장치가 없으면(OverconstrainedError) 아무 카메라나 사용
      try {
        await startOnce(scanner, { facingMode: "environment" });
      } catch (err1) {
        const raw1 = String((err1 as Error)?.message ?? err1);
        if (!/OverconstrainedError|constraint/i.test(raw1)) throw err1;
        // 후면 카메라가 없는 장치 → 사용 가능한 카메라를 직접 선택
        try { await scanner.stop(); } catch {}
        try { scanner.clear(); } catch {}
        const node = document.getElementById("reader");
        if (node) node.innerHTML = "";
        let nextCameras: Array<{ id: string; label: string }> = [];
        try {
          nextCameras = (await Html5.getCameras?.()) ?? [];
        } catch {}
        scanner = new Html5("reader");
        scannerRef.current = scanner;
        if (nextCameras.length > 0) {
          await startOnce(scanner, { deviceId: { exact: nextCameras[0].id } });
        } else {
          await startOnce(scanner, {});
        }
      }

      setIsScanning(true);
    } catch (err) {
      console.error("Camera start error:", err);
      scannerRef.current = null;
      const raw = String((err as Error)?.message ?? err) || "";
      if (/NotAllowedError|Permission|권한/i.test(raw)) {
        showMessage(
          "카메라 권한이 거부됐습니다. 브라우저 주소창의 카메라 아이콘에서 권한을 '허용'으로 바꾼 뒤 다시 시도해주세요.",
          "error"
        );
      } else if (/NotFoundError|no camera|DevicesNotFound/i.test(raw)) {
        showMessage(
          "사용 가능한 카메라가 없습니다. 직접 입력 모드를 이용해주세요.",
          "error"
        );
      } else if (/NotReadableError|TrackStart|in use/i.test(raw)) {
        showMessage(
          "다른 프로그램이 카메라를 사용 중입니다. 종료한 뒤 다시 시도해주세요.",
          "error"
        );
      } else {
        showMessage(
          `카메라를 실행할 수 없습니다. 직접 입력 모드를 이용해주세요. (${raw.slice(0, 60)})`,
          "error"
        );
      }
    }
  };

  const toggleCamera = () => (isScanning ? void stopCamera() : void startCamera());

  /* ------------------------- 탭 전환 ------------------------- */

  const switchMainTab = (tab: "register" | "classRank" | "goat") => {
    setMainTab(tab);
    if (tab !== "register") void stopCamera();
  };

  const switchInputMode = (mode: "scan" | "manual") => {
    setInputMode(mode);
    if (mode === "manual") void stopCamera();
  };

  /* ------------------------- 관리자 모드 ------------------------- */

  const openAdminModal = () => {
    if (isAdminUser) {
      adminPanelRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setAdminModalOpen(true);
  };

  const closeAdminModal = () => {
    setAdminModalOpen(false);
    setAdminPassword("");
  };

  const loginAdmin = async () => {
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
      });
      if (res.ok) {
        setIsAdminUser(true);
        closeAdminModal();
      } else {
        window.alert("비밀번호가 일치하지 않습니다.");
      }
    } catch {
      window.alert("서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
    }
    setAdminPassword("");
  };

  const logoutAdmin = () => {
    void fetch("/api/admin", { method: "DELETE" });
    setIsAdminUser(false);
    setUnusedCodes(null);
    setStudentItems([]);
  };

  /* ------------------------- 관리자: 보물 등록 ------------------------- */

  const submitAdminCreate = async () => {
    setAdminMsg({ kind: "info", text: "처리 중..." });
    try {
      const body =
        adminMode === "generate"
          ? { tier: adminTier, count: parseInt(adminCount, 10) || 0 }
          : { tier: adminTier, code: adminManualCode };
      const res = await fetch("/api/admin/codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAdminMsg({ kind: "error", text: String(data.message ?? "보물 등록에 실패했습니다.") });
        return;
      }
      setLastCreatedCodes(data.created);
      setAdminManualCode("");
      setAdminMsg({ kind: "success", text: String(data.message) });
      fetchTreasures();
    } catch {
      setAdminMsg({ kind: "error", text: "서버에 연결할 수 없습니다." });
    }
  };

  const copyCreatedCodes = async () => {
    if (!lastCreatedCodes) return;
    try {
      await navigator.clipboard.writeText(lastCreatedCodes.join("\n"));
      setAdminMsg({ kind: "info", text: "발급된 코드가 클립보드에 복사되었습니다." });
    } catch {
      window.alert("복사에 실패했습니다. 코드를 직접 선택해주세요.");
    }
  };

  const deleteUnusedCode = async (code: string) => {
    if (!window.confirm(`미사용 코드 '${code}'를 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch("/api/admin/codes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAdminMsg({ kind: "error", text: String(data.message ?? "삭제에 실패했습니다.") });
        return;
      }
      fetchTreasures();
    } catch {
      setAdminMsg({ kind: "error", text: "서버에 연결할 수 없습니다." });
    }
  };

  /* ------------------------- 관리자: 획득 내역 ------------------------- */

  const deleteClaimByCode = async (code: string) => {
    if (!window.confirm(`'${code}' 획득 내역을 취소하시겠습니까? (코드는 재사용 가능)`)) return;
    try {
      const res = await fetch(`/api/treasures/${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      if (res.status === 401) {
        showMessage("관리자 인증이 필요합니다.", "error");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showMessage(String(data.message ?? "삭제에 실패했습니다."), "error");
        return;
      }
      fetchTreasures();
      showMessage(`'${code}' 획득 내역이 취소되었습니다.`, "info");
    } catch {
      showMessage("서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.", "error");
    }
  };

  const resetAllClaims = async () => {
    if (!window.confirm("🚨 경고: 정말로 모든 획득 내역을 초기화하시겠습니까? (보물 코드는 유지)")) return;
    try {
      const res = await fetch("/api/treasures", { method: "DELETE" });
      if (res.status === 401) {
        showMessage("관리자 인증이 필요합니다.", "error");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showMessage(String(data.message ?? "초기화에 실패했습니다."), "error");
        return;
      }
      fetchTreasures();
      showMessage("관리자 권한으로 모든 획득 내역이 초기화되었습니다.", "info");
    } catch {
      showMessage("서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.", "error");
    }
  };

  /* ------------------------- 파생 데이터 ------------------------- */

  // 반별 순위 (반점수 합계)
  const classStats = useMemo(() => {
    const list = Array.from({ length: 10 }, (_, i) => ({
      className: `2-${i + 1}반`,
      score: 0,
      count: 0,
    }));
    let totalCount = 0;
    Object.values(claims).forEach((item) => {
      const idx = parseInt(item.classId.replace("2-", ""), 10) - 1;
      if (list[idx]) {
        list[idx].score += item.points || 0;
        list[idx].count += 1;
        totalCount += 1;
      }
    });
    list.sort((a, b) =>
      b.score !== a.score ? b.score - a.score : b.count - a.count
    );
    return { list, totalCount };
  }, [claims]);

  // 개인별 점수 (획득한 반점수의 합계)
  const personStats = useMemo(() => {
    const map = new Map<
      string,
      { studentId: string; studentName: string; classId: string; score: number; count: number }
    >();
    Object.values(claims).forEach((item) => {
      if (!item.studentId) return;
      const cur = map.get(item.studentId) ?? {
        studentId: item.studentId,
        studentName: item.studentName || "",
        classId: item.classId,
        score: 0,
        count: 0,
      };
      cur.score += item.points || 0;
      cur.count += 1;
      map.set(item.studentId, cur);
    });
    const list = Array.from(map.values());
    list.sort((a, b) =>
      b.score !== a.score ? b.score - a.score : b.count - a.count
    );
    return list;
  }, [claims]);

  const goat = personStats[0];
  const isGoatMe = goat?.studentId === student?.studentId;
  const mine = personStats.find((p) => p.studentId === student?.studentId);
  const myRank = personStats.findIndex((p) => p.studentId === student?.studentId) + 1;

  /* ------------------------- 렌더링 ------------------------- */

  const msgBoxClass = message
    ? message.kind === "success"
      ? "bg-emerald-950 text-emerald-300 border-emerald-500"
      : message.kind === "error"
        ? "bg-rose-950 text-rose-300 border-rose-500"
        : message.kind === "warning"
          ? "bg-amber-950 text-amber-300 border-amber-500"
          : "bg-slate-800 text-slate-300 border-slate-600"
    : "";
  const msgIconClass = message
    ? message.kind === "success"
      ? "fa-solid fa-circle-check text-emerald-400"
      : message.kind === "error"
        ? "fa-solid fa-circle-xmark text-rose-400"
        : message.kind === "warning"
          ? "fa-solid fa-triangle-exclamation text-amber-400"
          : "fa-solid fa-circle-info text-cyan-400"
    : "";

  /* ---- 화면 0: 세션 확인 중 ---- */
  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
        <i className="fa-solid fa-spinner animate-spin mr-2"></i> 불러오는 중...
      </div>
    );
  }

  /* ---- 화면 1: 로그인 / 최초 등록 ---- */
  if (!student) {
    return (
      <div className="max-w-md mx-auto px-4 py-10">
        <div className="bg-slate-900 rounded-none p-6 pixel-box text-center space-y-5 border-cyan-400">
          <div>
            <div className="inline-block bg-yellow-400 text-black px-2 py-0.5 font-bold text-[10px] pixel-box-sm mb-2">
              ★ 2학년 수학여행 탐험 ★
            </div>
            <h1 className="text-lg font-extrabold tracking-wider text-cyan-300 flex items-center justify-center gap-2">
              <i className="fa-solid fa-gamepad text-pink-500 animate-bounce"></i> 보물찾기 대작전
            </h1>
            <p className="text-xs text-slate-400 mt-2">
              학번으로 로그인하고 탐험을 시작하세요!
            </p>
          </div>

          {/* 로그인 / 최초 등록 탭 */}
          <div className="flex bg-slate-950 p-1 pixel-box-sm">
            <button
              onClick={() => {
                setAuthMode("login");
                setAuthMsg(null);
              }}
              className={`flex-1 py-1.5 text-xs font-bold ${
                authMode === "login" ? "bg-cyan-400 text-black" : "text-slate-400"
              }`}
            >
              <i className="fa-solid fa-right-to-bracket mr-1"></i> 로그인
            </button>
            <button
              onClick={() => {
                setAuthMode("signup");
                setAuthMsg(null);
              }}
              className={`flex-1 py-1.5 text-xs font-bold ${
                authMode === "signup" ? "bg-cyan-400 text-black" : "text-slate-400"
              }`}
            >
              <i className="fa-solid fa-user-plus mr-1"></i> 처음이신가요?
            </button>
          </div>

          {authMode === "login" ? (
            <div className="space-y-3 text-left">
              <div>
                <label className="block text-xs text-slate-400 mb-1">학번 (5자리)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void loginSubmit();
                  }}
                  placeholder="예: 20921"
                  className="w-full font-mono tracking-widest text-center text-base py-3 px-4 bg-slate-950 border-2 border-slate-700 text-yellow-300 focus:outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">비밀번호</label>
                <input
                  type="password"
                  value={loginPw}
                  onChange={(e) => setLoginPw(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void loginSubmit();
                  }}
                  placeholder="비밀번호"
                  className="w-full text-center py-3 px-4 bg-slate-950 border-2 border-slate-700 text-yellow-300 focus:outline-none focus:border-cyan-400"
                />
              </div>
              <button
                onClick={() => void loginSubmit()}
                className="w-full py-3.5 bg-cyan-400 hover:bg-cyan-300 text-black font-extrabold text-base pixel-btn flex items-center justify-center gap-2"
              >
                <span>로그인하고 입장하기</span>
                <i className="fa-solid fa-play"></i>
              </button>
              <p className="text-[11px] text-slate-500 text-center">
                처음 로그인이면 개인 비밀번호 변경 화면이 나옵니다.
              </p>
            </div>
          ) : (
            <div className="space-y-3 text-left">
              <div>
                <label className="block text-xs text-slate-400 mb-1">학번 (5자리)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={signupId}
                  onChange={(e) => setSignupId(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void signupSubmit();
                  }}
                  placeholder="예: 20921 (2학년 9반 21번)"
                  className="w-full font-mono tracking-widest text-center text-base py-3 px-4 bg-slate-950 border-2 border-slate-700 text-yellow-300 focus:outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">이름</label>
                <input
                  type="text"
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void signupSubmit();
                  }}
                  placeholder="실제 이름"
                  className="w-full text-center py-3 px-4 bg-slate-950 border-2 border-slate-700 text-yellow-300 focus:outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">비밀번호</label>
                <input
                  type="password"
                  value={signupPw}
                  onChange={(e) => setSignupPw(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void signupSubmit();
                  }}
                  placeholder={`기본 비밀번호: ${DEFAULT_PASSWORD}`}
                  className="w-full text-center py-3 px-4 bg-slate-950 border-2 border-slate-700 text-yellow-300 focus:outline-none focus:border-cyan-400"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  반은 학번에서 자동 연결됩니다. (예: 20921 → 2-9반)
                </p>
              </div>
              <button
                onClick={() => void signupSubmit()}
                className="w-full py-3.5 bg-cyan-400 hover:bg-cyan-300 text-black font-extrabold text-base pixel-btn flex items-center justify-center gap-2"
              >
                <span>초기 등록하고 입장하기</span>
                <i className="fa-solid fa-play"></i>
              </button>
              <p className="text-[11px] text-slate-500 text-center">
                선생님께 안내받은 기본 비밀번호({DEFAULT_PASSWORD})를 입력해주세요.
              </p>
            </div>
          )}

          {authMsg && (
            <div
              className={`p-3 text-xs font-bold flex items-center gap-2 pixel-box-sm ${
                authMsg.kind === "error"
                  ? "bg-rose-950 text-rose-300 border-rose-500"
                  : authMsg.kind === "warning"
                    ? "bg-amber-950 text-amber-300 border-amber-500"
                    : "bg-slate-800 text-slate-300 border-slate-600"
              }`}
            >
              <span>{authMsg.text}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ---- 화면 2: 개인 비밀번호 변경 (필수) ---- */
  if (mustChange) {
    const info = myInfo;
    return (
      <div className="max-w-md mx-auto px-4 py-10">
        <div className="bg-slate-900 rounded-none p-6 pixel-box text-center space-y-5 border-pink-500">
          <div className="w-16 h-16 bg-pink-500 text-white rounded-none flex items-center justify-center mx-auto text-3xl pixel-box">
            <i className="fa-solid fa-key"></i>
          </div>
          <div>
            <h2 className="text-lg font-bold text-yellow-300">첫 로그인입니다!</h2>
            <p className="text-xs text-slate-400 mt-2">
              {info ? `${info.label} ${student.name} 학생` : student.name}님, 안전을 위해
              <br />
              개인 비밀번호로 변경해주세요.
            </p>
          </div>
          <div className="space-y-3 text-left">
            <div>
              <label className="block text-xs text-slate-400 mb-1">새 개인 비밀번호 (6자 이상)</label>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="새 비밀번호"
                className="w-full text-center py-3 px-4 bg-slate-950 border-2 border-slate-700 text-yellow-300 focus:outline-none focus:border-pink-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">새 비밀번호 확인</label>
              <input
                type="password"
                value={newPwConfirm}
                onChange={(e) => setNewPwConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void changePasswordSubmit();
                }}
                placeholder="한 번 더 입력"
                className="w-full text-center py-3 px-4 bg-slate-950 border-2 border-slate-700 text-yellow-300 focus:outline-none focus:border-pink-500"
              />
            </div>
            <button
              onClick={() => void changePasswordSubmit()}
              className="w-full py-3.5 bg-cyan-400 hover:bg-cyan-300 text-black font-extrabold text-base pixel-btn flex items-center justify-center gap-2"
            >
              <span>비밀번호 변경하고 입장하기</span>
              <i className="fa-solid fa-check"></i>
            </button>
            <button
              onClick={() => void logoutStudent()}
              className="w-full py-1 text-[11px] text-slate-500 hover:text-slate-300"
            >
              <i className="fa-solid fa-right-from-bracket"></i> 로그아웃
            </button>
          </div>

          {authMsg && (
            <div
              className={`p-3 text-xs font-bold flex items-center gap-2 pixel-box-sm ${
                authMsg.kind === "error"
                  ? "bg-rose-950 text-rose-300 border-rose-500"
                  : authMsg.kind === "warning"
                    ? "bg-amber-950 text-amber-300 border-amber-500"
                    : "bg-slate-800 text-slate-300 border-slate-600"
              }`}
            >
              <span>{authMsg.text}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ---- 화면 3: 메인 앱 ---- */
  return (
    <>
      {/* 상단 아케이드 전광판 헤더 */}
      <header className="arcade-header-bg text-white py-4 px-4 shadow-2xl text-center relative overflow-hidden">
        <div className="max-w-md mx-auto relative z-10 flex items-center justify-between">
          <div className="text-left">
            <div className="inline-block bg-yellow-400 text-black px-2 py-0.5 font-bold text-[10px] pixel-box-sm mb-1">
              ★ 2학년 수학여행 탐험 ★
            </div>
            <h1 className="text-lg font-extrabold tracking-wider text-cyan-300 flex items-center gap-2">
              <i className="fa-solid fa-gamepad text-pink-500 animate-bounce"></i> 보물찾기
              대작전
            </h1>
          </div>

          {/* 우측 영역: 내 정보 & 관리자 버튼 */}
          <div className="flex items-center gap-2">
            <div className="bg-cyan-400 text-black px-2.5 py-1 text-xs font-bold pixel-btn flex items-center gap-1.5">
              <span>{myInfo ? `${myInfo.label}` : student.name}</span>
              <button onClick={() => void logoutStudent()} title="로그아웃">
                <i className="fa-solid fa-right-from-bracket text-[11px]"></i>
              </button>
            </div>
            <button
              onClick={openAdminModal}
              className="bg-pink-500 hover:bg-pink-400 text-white px-2.5 py-1 text-xs font-bold pixel-btn flex items-center gap-1"
            >
              <i className="fa-solid fa-user-shield"></i>
              <span>{isAdminUser ? "관리자 모드" : "관리자"}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 mt-4 space-y-4">
        {/* 탭 선택 네비게이션 (보물 등록 / 반별 순위 / G.O.A.T) */}
        <div className="flex bg-slate-900 p-1.5 pixel-box">
          <button
            onClick={() => switchMainTab("register")}
            className={`flex-1 py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-1 ${
              mainTab === "register" ? "bg-cyan-400 text-black pixel-btn" : "text-slate-400"
            }`}
          >
            <i className="fa-solid fa-qrcode"></i> 보물 등록
          </button>
          <button
            onClick={() => switchMainTab("classRank")}
            className={`flex-1 py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-1 ${
              mainTab === "classRank" ? "bg-cyan-400 text-black pixel-btn" : "text-slate-400"
            }`}
          >
            <i className="fa-solid fa-trophy text-yellow-400"></i> 반별 순위
          </button>
          <button
            onClick={() => switchMainTab("goat")}
            className={`flex-1 py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-1 ${
              mainTab === "goat" ? "bg-cyan-400 text-black pixel-btn" : "text-slate-400"
            }`}
          >
            <i className="fa-solid fa-crown text-yellow-400"></i> G.O.A.T
          </button>
        </div>

        {/* TAB 1: 보물 등록 섹션 */}
        <div className={`space-y-4 ${mainTab === "register" ? "" : "hidden"}`}>
          {/* 내 정보 요약 */}
          {myInfo && (
            <div className="bg-slate-900 px-4 py-2.5 pixel-box-sm flex items-center justify-between">
              <span className="text-[11px] text-slate-300 font-bold">
                <i className="fa-solid fa-id-card text-cyan-400 mr-1"></i>
                {myInfo.label} {student.name}
              </span>
              <span className="text-[11px] font-bold text-yellow-300">
                누적 {mine ? mine.score : 0}점 ({mine ? mine.count : 0}개){myRank ? ` • ${myRank}위` : ""}
              </span>
            </div>
          )}

          {/* 보물 현황 (실시간 남은 개수) */}
          <section className="bg-slate-900 p-4 pixel-box space-y-2">
            <h2 className="text-xs font-bold text-yellow-300 flex items-center gap-2 mb-1">
              <i className="fa-solid fa-box-open text-yellow-400"></i> 남은 보물 현황
            </h2>
            {stock.map((s) => {
              const left = Math.max(0, s.remaining);
              const critical = left <= Math.ceil(s.total * 0.2);
              return (
                <div
                  key={s.tier}
                  className={`flex items-center justify-between p-2 pixel-box-sm ${
                    left === 0 ? "bg-slate-950 border-slate-800 opacity-60" : "bg-slate-950 border-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-7 h-7 ${critical ? "bg-rose-500" : left === 0 ? "bg-slate-700" : "bg-yellow-400"} text-black font-black flex items-center justify-center text-xs pixel-box-sm`}
                    >
                      {s.tier}등
                    </span>
                    <div>
                      <span className="text-[11px] font-bold text-cyan-300">+{s.points}점</span>
                      <span className="text-[11px] text-slate-300 ml-1">
                        {s.item ? s.item : "(상품 없음)"}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-bold ${left === 0 ? "text-slate-500" : critical ? "text-rose-400" : "text-yellow-300"}`}
                  >
                    {left === 0 ? "모두 발견!" : `남음 ${left}/${s.total}개`}
                  </span>
                </div>
              );
            })}
          </section>

          <section className="bg-slate-900 p-5 pixel-box space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-xs font-bold text-cyan-300 flex items-center gap-2">
                <i className="fa-solid fa-coins text-yellow-400"></i> 보물 코드 입력하기
              </h2>
              {myInfo && (
                <span className="text-xs font-bold text-black bg-yellow-400 px-2 py-0.5 pixel-box-sm">
                  {myInfo.classId}반 전용
                </span>
              )}
            </div>

            {/* 서브 탭 전환 버튼 (카메라 스캔 / 직접 입력) */}
            <div className="flex bg-slate-950 p-1 pixel-box-sm">
              <button
                onClick={() => switchInputMode("scan")}
                className={`flex-1 py-1.5 text-xs font-bold ${
                  inputMode === "scan" ? "bg-cyan-400 text-black" : "text-slate-400"
                }`}
              >
                <i className="fa-solid fa-camera mr-1"></i> 카메라 스캔
              </button>
              <button
                onClick={() => switchInputMode("manual")}
                className={`flex-1 py-1.5 text-xs font-bold ${
                  inputMode === "manual" ? "bg-cyan-400 text-black" : "text-slate-400"
                }`}
              >
                <i className="fa-solid fa-keyboard mr-1"></i> 직접 입력
              </button>
            </div>

            {/* 카메라 스캔 영역 */}
            <div className={`space-y-3 ${inputMode === "scan" ? "" : "hidden"}`}>
              <div className="w-44 sm:w-52 max-w-full mx-auto bg-black aspect-square flex flex-col items-center justify-center pixel-box-sm border-cyan-400 overflow-hidden min-h-0">
                <div id="reader" className="w-full h-full"></div>
                {!isScanning && (
                  <div className="text-center p-2 text-slate-400">
                    <i className="fa-solid fa-camera-retro text-2xl mb-1 block text-cyan-400"></i>
                    <p className="text-[10px]">
                      카메라 권한을 허용하고
                      <br />
                      카메라 켜기 버튼을 눌러주세요
                    </p>
                  </div>
                )}
              </div>
              <button
                onClick={toggleCamera}
                className="w-full py-3 bg-pink-500 hover:bg-pink-400 text-white font-bold text-xs pixel-btn flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-power-off"></i>{" "}
                <span>{isScanning ? "카메라 끄기" : "카메라 켜기"}</span>
              </button>
            </div>

            {/* 직접 입력 영역 */}
            <div className={`space-y-3 ${inputMode === "manual" ? "" : "hidden"}`}>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  보물 코드 (관리자 발급 코드)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={treasureCodeInput}
                    onChange={(e) => setTreasureCodeInput(e.target.value)}
                    onBlur={(e) => setTreasureCodeInput(e.target.value.toUpperCase())}
                    placeholder="예: A7K2M9QX"
                    className="w-full uppercase font-mono tracking-widest text-center text-base py-3 px-4 bg-slate-950 border-2 border-slate-700 text-yellow-300 focus:outline-none focus:border-cyan-400"
                  />
                  <button
                    onClick={() => setTreasureCodeInput("")}
                    className="absolute right-3 top-3 text-slate-500 hover:text-white"
                  >
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                </div>
              </div>
              <button
                onClick={submitManualCode}
                className="w-full py-3 bg-cyan-400 hover:bg-cyan-300 text-black font-extrabold text-xs pixel-btn flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-check"></i> 보물 등록 완료
              </button>
            </div>

            {/* 알림 메시지 박스 */}
            {message && (
              <div
                className={`p-3 text-xs font-bold flex items-center gap-2 pixel-box-sm ${msgBoxClass}`}
              >
                <i className={`${msgIconClass} text-sm`}></i>
                <span>{message.text}</span>
              </div>
            )}
          </section>
        </div>

        {/* TAB 2: 반별 실시간 순위 */}
        <div className={`space-y-4 ${mainTab === "classRank" ? "" : "hidden"}`}>
          <section className="bg-slate-900 p-5 pixel-box">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h2 className="text-xs font-bold text-yellow-300 flex items-center gap-2">
                <i className="fa-solid fa-trophy text-yellow-400"></i> 실시간 반별 순위
              </h2>
              <span className="text-[11px] text-slate-400 bg-slate-800 px-2 py-1 pixel-box-sm">
                총 {classStats.totalCount}개 발견됨
              </span>
            </div>

            <div className="space-y-2.5">
              {classStats.list.map((item, index) => {
                const rank = index + 1;
                let rankBadge = (
                  <span className="w-6 h-6 bg-slate-800 text-slate-400 font-bold flex items-center justify-center text-xs pixel-box-sm">
                    {rank}
                  </span>
                );
                if (rank === 1) {
                  rankBadge = (
                    <span className="w-6 h-6 bg-yellow-400 text-black font-black flex items-center justify-center text-xs pixel-box-sm">
                      <i className="fa-solid fa-crown"></i>
                    </span>
                  );
                } else if (rank === 2) {
                  rankBadge = (
                    <span className="w-6 h-6 bg-slate-300 text-black font-black flex items-center justify-center text-xs pixel-box-sm">
                      2
                    </span>
                  );
                } else if (rank === 3) {
                  rankBadge = (
                    <span className="w-6 h-6 bg-amber-600 text-white font-black flex items-center justify-center text-xs pixel-box-sm">
                      3
                    </span>
                  );
                }

                const isMyClass = myInfo && item.className === `${myInfo.classId}반`;
                return (
                  <div
                    key={item.className}
                    className={`flex items-center justify-between p-2.5 pixel-box-sm transition ${
                      isMyClass
                        ? "bg-indigo-950 border-cyan-400 font-bold"
                        : "bg-slate-950 border-slate-800"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {rankBadge}
                      <div>
                        <span
                          className={`text-xs font-bold ${
                            isMyClass ? "text-cyan-300" : "text-slate-200"
                          }`}
                        >
                          {item.className}
                        </span>
                        {isMyClass && (
                          <span className="ml-1 text-[10px] bg-pink-500 text-white px-1.5 py-0.5">
                            우리반
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-yellow-300">{item.score}점</span>
                      <span className="text-[10px] text-slate-400 block">{item.count}개 발견</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* TAB 3: G.O.A.T 플레이어 (개인 1등) */}
        <div className={`space-y-4 ${mainTab === "goat" ? "" : "hidden"}`}>
          <section className="bg-slate-900 p-6 pixel-box text-center space-y-4 border-yellow-400">
            <h2 className="text-xs font-bold text-yellow-300 flex items-center justify-center gap-2">
              <i className="fa-solid fa-crown text-yellow-400"></i> G.O.A.T 플레이어
            </h2>
            {/* G.O.A.T 이미지 */}
            <img
              src="/goat.jpg"
              alt="G.O.A.T — 메시와 월드컵 트로피"
              className="w-48 max-w-full border-2 border-yellow-400 pixel-box mx-auto"
            />
            {goat ? (
              <div>
                <div className="w-20 h-20 bg-yellow-400 text-black rounded-none flex items-center justify-center mx-auto text-4xl pixel-box">
                  <i className="fa-solid fa-crown"></i>
                </div>
                <p className="text-2xl font-black text-yellow-300 mt-4">
                  {isGoatMe ? student.name : goat.studentName}{" "}
                  {isGoatMe && (
                    <span className="ml-1 text-[11px] bg-cyan-400 text-black px-1.5 py-0.5 align-middle">
                      나
                    </span>
                  )}
                </p>
                {(() => {
                  const parsed = parseStudentIdClient(goat.studentId);
                  return (
                    <p className="text-[11px] text-slate-400 font-mono mt-1">
                      {parsed ? parsed.label : goat.studentId} • {goat.classId}반
                    </p>
                  );
                })()}
                <div className="flex items-center justify-center gap-3 mt-3">
                  <span className="text-xl font-black text-cyan-300 font-pixel-num">
                    {goat.score}
                  </span>
                  <i className="fa-solid fa-star text-yellow-400 text-sm"></i>
                  <p className="text-xs text-slate-300">반점수 합계 ({goat.count}개 발견)</p>
                </div>
              </div>
            ) : (
              <div className="py-6 text-slate-500 text-xs">
                <i className="fa-solid fa-hourglass-half text-2xl block mb-3"></i>
                아직 보물을 찾은 학생이 없습니다.
              </div>
            )}
          </section>
        </div>

        {/* 관리자 전용 대시보드 */}
        {isAdminUser && (
          <section
            ref={adminPanelRef}
            className="bg-slate-900 p-5 border-2 border-pink-500 pixel-box space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-pink-400 text-xs flex items-center gap-2">
                <i className="fa-solid fa-user-shield"></i> 관리자 모드
              </h3>
              <button
                onClick={logoutAdmin}
                className="text-[11px] font-bold text-black bg-pink-400 px-2 py-0.5 pixel-btn"
              >
                나가기
              </button>
            </div>

            {/* 보물 등록 (등급 선택) */}
            <div className="space-y-2.5">
              <span className="text-xs font-bold text-slate-300">
                보물 등록 — 몇등 보물인지 선택
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => {
                  const s = stock.find((x) => x.tier === n);
                  const budgetLeft = s ? s.total - (s.claimed + (unusedCodes?.find((g) => g.tier === n)?.codes.length ?? 0)) : 0;
                  const active = adminTier === n;
                  return (
                    <button
                      key={n}
                      onClick={() => setAdminTier(n)}
                      className={`py-2 font-bold text-[11px] pixel-btn ${
                        active ? "bg-yellow-400 text-black" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      {n}등
                      <span className="block text-[9px] font-normal">
                        잔여 {Math.max(0, budgetLeft)}개
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* 생성 방식 */}
              <div className="flex bg-slate-950 p-1 pixel-box-sm">
                <button
                  onClick={() => setAdminMode("generate")}
                  className={`flex-1 py-1.5 text-[11px] font-bold ${
                    adminMode === "generate" ? "bg-cyan-400 text-black" : "text-slate-400"
                  }`}
                >
                  자동 생성
                </button>
                <button
                  onClick={() => setAdminMode("manual")}
                  className={`flex-1 py-1.5 text-[11px] font-bold ${
                    adminMode === "manual" ? "bg-cyan-400 text-black" : "text-slate-400"
                  }`}
                >
                  직접 입력
                </button>
              </div>

              {adminMode === "generate" ? (
                <div className="flex gap-2 items-center">
                  <label className="text-[11px] text-slate-300 font-bold whitespace-nowrap">
                    수량
                  </label>
                  <select
                    value={adminCount}
                    onChange={(e) => setAdminCount(e.target.value)}
                    className="flex-1 bg-slate-950 border-2 border-slate-700 text-yellow-300 text-sm px-2 py-2 focus:outline-none focus:border-cyan-400"
                  >
                    {Array.from({ length: 50 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}개
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input
                  type="text"
                  value={adminManualCode}
                  onChange={(e) => setAdminManualCode(e.target.value.toUpperCase())}
                  placeholder="직접 입력할 코드 (예: ABC12345)"
                  className="w-full uppercase font-mono text-center py-2 px-3 bg-slate-950 border-2 border-slate-700 text-yellow-300 text-sm focus:outline-none focus:border-cyan-400"
                />
              )}

              <button
                onClick={() => void submitAdminCreate()}
                className="w-full py-2.5 bg-cyan-400 hover:bg-cyan-300 text-black font-extrabold text-xs pixel-btn"
              >
                <i className="fa-solid fa-plus mr-1"></i> {adminTier}등 보물 등록하기
              </button>

              {adminMsg && (
                <div
                  className={`p-2.5 text-[11px] font-bold pixel-box-sm ${
                    adminMsg.kind === "success"
                      ? "bg-emerald-950 text-emerald-300"
                      : adminMsg.kind === "error"
                        ? "bg-rose-950 text-rose-300"
                        : "bg-slate-800 text-slate-300"
                  }`}
                >
                  {adminMsg.text}
                </div>
              )}

              {/* 발급 결과 */}
              {lastCreatedCodes && lastCreatedCodes.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300">
                      발급된 코드 ({lastCreatedCodes.length}개)
                    </span>
                    <button
                      onClick={() => void copyCreatedCodes()}
                      className="text-[10px] font-bold text-black bg-cyan-400 px-2 py-0.5 pixel-btn"
                    >
                      <i className="fa-solid fa-copy"></i> 전체 복사
                    </button>
                  </div>
                  <div className="max-h-32 overflow-y-auto bg-slate-950 p-2 border border-slate-800 font-mono text-[11px] text-cyan-300">
                    {lastCreatedCodes.map((c) => (
                      <div key={c} className="py-0.5">
                        {c}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 남은(미사용) 코드 관리 */}
            {unusedCodes && unusedCodes.length > 0 && (
              <div className="space-y-1.5 border-t border-slate-800 pt-3">
                <span className="text-xs font-bold text-slate-300">
                  남은 보물 코드 (미사용)
                </span>
                <div className="max-h-40 overflow-y-auto space-y-1 bg-slate-950 p-2 border border-slate-800 text-[10px] font-mono">
                  {unusedCodes.map((g) => (
                    <div key={g.tier}>
                      <span className="font-bold text-yellow-300">[{g.tier}등]</span>{" "}
                      {g.codes.map((c, i) => (
                        <span key={c}>
                          {c}
                          {i < g.codes.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="flex flex-col items-start gap-0.5">
                  {unusedCodes.map((g) =>
                    g.codes.slice(0, 3).map((c) => (
                      <button
                        key={c}
                        onClick={() => void deleteUnusedCode(c)}
                        className="text-[10px] font-bold text-rose-400 hover:underline"
                      >
                        <i className="fa-solid fa-xmark"></i> {g.tier}등 {c} 삭제
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* 학생별 획득 상품 (관리자 전용) */}
            <div className="space-y-2 border-t border-slate-800 pt-3">
              <span className="text-xs font-bold text-slate-300">
                <i className="fa-solid fa-gift text-pink-400 mr-1"></i>
                학생별 획득 상품 현황
              </span>
              <div className="max-h-48 overflow-y-auto space-y-1.5 bg-slate-950 p-2 border border-slate-800 text-[11px]">
                {studentItems.length === 0 ? (
                  <div className="text-center py-3 text-slate-500">
                    아직 상품을 받은 학생이 없습니다.
                  </div>
                ) : (
                  studentItems.map((g) => (
                    <div
                      key={g.studentId}
                      className="flex items-start justify-between p-2 bg-slate-900 border border-slate-800"
                    >
                      <div>
                        <span className="font-bold text-cyan-300">{g.studentName}</span>
                        <span className="text-slate-400 ml-1">{g.classId}반</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {g.items.map((it) => (
                            <span
                              key={it.code}
                              className="inline-block bg-pink-950 text-pink-300 border border-pink-700 px-1.5 py-0.5 text-[10px] font-bold"
                            >
                              {it.tier}등 · {it.item}
                            </span>
                          ))}
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-yellow-300 whitespace-nowrap">
                        상품 {g.items.length}개
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 획득 내역 관리 */}
            <div className="space-y-2 border-t border-slate-800 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">
                  전체 획득 내역 ({Object.keys(claims).length}건)
                </span>
                <button
                  onClick={resetAllClaims}
                  className="text-[10px] font-bold text-rose-400 hover:underline"
                >
                  <i className="fa-solid fa-trash-can"></i> 획득 내역 전체 초기화
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 bg-slate-950 p-2 border border-slate-800 text-xs font-mono">
                {Object.keys(claims).length === 0 ? (
                  <div className="text-center py-4 text-slate-500">
                    획득 내역이 없습니다.
                  </div>
                ) : (
                  Object.keys(claims).map((code) => {
                    const c = claims[code];
                    return (
                      <div
                        key={code}
                        className="flex items-center justify-between p-2 bg-slate-900 border border-slate-800"
                      >
                        <div>
                          <span className="font-mono font-bold text-yellow-300">[{code}]</span>
                          <span className="text-slate-300 ml-1">
                            {c.tier}등 {c.item && `${c.item} `}
                            {c.classId}반 {c.studentName} +{c.points}점
                          </span>
                          <span className="text-slate-500 text-[10px] ml-1">{c.time}</span>
                        </div>
                        <button
                          onClick={() => void deleteClaimByCode(code)}
                          className="text-rose-400 font-bold px-1.5 py-0.5 hover:bg-rose-950"
                        >
                          취소
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        )}

        {/* 네트워크 연결 상태 아이콘 */}
        <div className="text-center">
          {syncStatus === "online" ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 bg-slate-900 px-3 py-1 pixel-box-sm">
              <span className="w-2 h-2 bg-emerald-400 animate-pulse"></span>
              실시간 연동 중 ({Object.keys(claims).length}개 등록됨)
            </span>
          ) : syncStatus === "offline" ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-rose-400 bg-slate-900 px-3 py-1 pixel-box-sm">
              <span className="w-2 h-2 bg-rose-500"></span> 오프라인 모드
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 bg-slate-900 px-3 py-1 pixel-box-sm">
              <span className="w-2 h-2 bg-emerald-400 animate-pulse"></span> 실시간 데이터
              연동 중
            </span>
          )}
        </div>
      </main>

      {/* 관리자 로그인 모달 */}
      <div
        className={`fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 ${
          adminModalOpen ? "" : "hidden"
        }`}
      >
        <div className="bg-slate-900 p-6 max-w-sm w-full space-y-4 pixel-box border-pink-500">
          <div className="text-center">
            <div className="w-12 h-12 bg-pink-500 text-white flex items-center justify-center mx-auto text-xl mb-2 pixel-box">
              <i className="fa-solid fa-user-shield"></i>
            </div>
            <h3 className="font-bold text-yellow-300 text-base">관리자 인증</h3>
            <p className="text-xs text-slate-400 mt-1">
              관리자 비밀번호를 입력해주세요.
            </p>
          </div>

          <div>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void loginAdmin();
              }}
              placeholder="비밀번호 입력"
              className="w-full text-center py-2.5 px-3 bg-slate-950 border-2 border-slate-700 text-yellow-300 font-bold focus:outline-none focus:border-pink-500 text-sm"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={closeAdminModal}
              className="flex-1 py-2.5 bg-slate-800 text-slate-300 font-bold text-xs pixel-btn"
            >
              취소
            </button>
            <button
              onClick={() => void loginAdmin()}
              className="flex-1 py-2.5 bg-pink-500 text-white font-bold text-xs pixel-btn"
            >
              확인 및 입장
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
