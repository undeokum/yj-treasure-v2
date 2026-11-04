import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "수학여행 보물찾기 대작전",
  description: "2학년 수학여행 탐험 - 보물 코드를 찾아 반별 실시간 순위 경쟁!",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        {/* Tailwind CSS (플레이 CDN — 원본 index.html과 동일) */}
        <Script src="https://cdn.tailwindcss.com" strategy="beforeInteractive" />
        {/* FontAwesome Icons */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
        />
        {/* Google Fonts: 레트로 픽셀 폰트 (DungGeunMo, Press Start 2P) 및 Noto Sans KR */}
        <link
          href="https://fonts.googleapis.com/css2?family=DungGeunMo&family=Press+Start+2P&family=Noto+Sans+KR:wght@500;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen pb-16 bg-slate-950">
        {children}
        {/* tesseract.js: 인쇄된 코드 텍스트 글자 인식(OCR) */}
        <Script src="https://unpkg.com/tesseract.js@5/dist/tesseract.min.js" strategy="lazyOnload" />
        {/* Canvas Confetti: 등록 성공 축하 효과 */}
        <Script
          src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
