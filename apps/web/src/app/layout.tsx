import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
// Шрифты лежат в пакетах и попадают в сборку — без запросов к внешним сервисам
import "@fontsource-variable/manrope";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Бесплатный разбор по дате рождения",
  description: "Натальная карта, матрица судьбы и персональный гороскоп по дате рождения.",
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
      <body>{children}</body>
    </html>
  );
}
