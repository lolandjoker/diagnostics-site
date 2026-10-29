import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
// Шрифты лежат в пакетах и попадают в сборку — без запросов к внешним сервисам
import "@fontsource-variable/manrope";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "./globals.css";
import { BRAND } from "./Brand";
import { SiteHeader } from "./SiteHeader";
import { TelegramBridge } from "./TelegramBridge";

export const metadata: Metadata = {
  title: { default: `${BRAND} — разбор по дате рождения`, template: `%s · ${BRAND}` },
  description: "Таромба: бесплатный разбор по дате рождения — знак, стихия, числа — и чат с экспертами по астрологии, таро и нумерологии.",
  applicationName: BRAND,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e0b16",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <SiteHeader />
        {children}
        <TelegramBridge />
      </body>
    </html>
  );
}
