import type { NextConfig } from "next";

/**
 * Заголовки безопасности для всех страниц.
 * Политики источников скриптов (CSP script-src) нет: на клиентских страницах грузится пиксель Meta
 * (app/MetaPixel.tsx) с connect.facebook.net — если её добавлять, разрешить его и www.facebook.com.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Встраивать сайт в чужие страницы можно только веб-версии Telegram: там сайт открывается
  // как приложение бота. В приложениях Telegram на телефоне и компьютере встраивания нет.
  { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://web.telegram.org" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Микрофон — только для своего сайта: голосовые звонки в чате
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
];

/** Админку и панель эксперта не встраивать никуда. */
const panelHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@diag/engine"],
  // Драйверы базы грузятся из node_modules как есть, без упаковки сборщиком
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  // Шрифт плашки эксперта для бота (lib/bot-card.tsx) читается с диска — взять его в сборку
  outputFileTracingIncludes: { "/**": ["./assets/fonts/*.woff"] },
  // Фото эксперта и сертификаты загружаются через серверные действия, по нескольку файлов за раз
  // (до 10 штук по 5 МБ); по умолчанию лимит 1 МБ
  experimental: {
    serverActions: { bodySizeLimit: "55mb" },
  },
  async headers() {
    // Совпадающий заголовок из более позднего правила заменяет ранний
    return [
      { source: "/:path*", headers: securityHeaders },
      ...["/admin", "/admin/:path*", "/expert", "/expert/:path*", "/operator", "/operator/:path*"].map((source) => ({
        source,
        headers: panelHeaders,
      })),
    ];
  },
};

export default nextConfig;
