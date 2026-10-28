"use client";

/**
 * Связь с Telegram, когда сайт открыт в приложении бота (вне Telegram ничего не делает и
 * скрипт Telegram не грузит):
 * - разворачивает приложение на весь экран и красит шапку Telegram в цвет сайта;
 * - на главной спрашивает сервер, есть ли у этого пользователя Telegram заявка, — и сразу ведёт
 *   в его чат. Cookie внутри Telegram может сброситься, а аккаунт Telegram — тот же.
 */
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { telegramInitData } from "./telegramWebApp";

interface TelegramWebApp {
  ready(): void;
  expand(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  /** Приложение на экране; false — свёрнуто или закрыто другим окном Telegram (Bot API 8.0+). */
  isActive?: boolean;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const SCRIPT_SRC = "https://telegram.org/js/telegram-web-app.js";
/** Фон сайта — как themeColor в layout.tsx. */
const BACKGROUND = "#0e0b16";

function loadTelegramScript() {
  if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return;
  const script = document.createElement("script");
  script.src = SCRIPT_SRC;
  script.async = true;
  script.onload = () => {
    const app = window.Telegram?.WebApp;
    if (!app) return;
    app.ready();
    app.expand();
    try {
      app.setHeaderColor(BACKGROUND);
      app.setBackgroundColor(BACKGROUND);
    } catch {
      // Старые версии Telegram не умеют произвольный цвет — остаётся цвет темы
    }
  };
  document.head.appendChild(script);
}

export function TelegramBridge() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const initData = telegramInitData();
    if (!initData) return;
    loadTelegramScript();
    // ?new=1 — человек сам начинает новый разбор, в старый чат не уводим
    if (pathname !== "/" || new URLSearchParams(window.location.search).get("new") === "1") return;
    let alive = true;
    fetch("/api/telegram/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ redirect: string | null }>) : null))
      .then((data) => {
        if (alive && data?.redirect) router.replace(data.redirect);
      })
      .catch(() => {
        // Нет связи — человек просто увидит форму
      });
    return () => {
      alive = false;
    };
  }, [pathname, router]);

  return null;
}
