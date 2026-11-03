import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // QR 카메라 스캔(html5-qrcode)을 위해 카메라 권한 허용
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
