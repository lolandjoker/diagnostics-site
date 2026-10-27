import type { NextConfig } from "next";

/**
 * Заголовки безопасности для всех страниц.
 * Политика источников (CSP) добавится, когда появятся внешние скрипты (Метрика, капча).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Микрофон — только для своего сайта: голосовые звонки в чате
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@diag/engine"],
  // Драйверы базы грузятся из node_modules как есть, без упаковки сборщиком
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  // Загрузка фото эксперта (до 2 МБ) и сертификатов (до 5 МБ) идёт через серверные действия; по умолчанию лимит 1 МБ
  experimental: {
    serverActions: { bodySizeLimit: "6mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
