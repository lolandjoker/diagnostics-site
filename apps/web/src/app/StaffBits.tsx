/**
 * Мелочи чатов сотрудников (без состояния — работают и на сервере, и в браузере):
 * значки «Telegram подключён» и «указал почту», метка города, птички прочтения.
 */
import { geoLabel } from "@/lib/geo-label";

export function TelegramIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#2aabee" />
      <path fill="#fff" d="M5.4 11.7 16.9 7.3c.5-.2 1 .1.8.9l-1.9 9.2c-.1.6-.5.8-1.1.5l-3-2.2-1.4 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.6-5c.2-.2 0-.3-.3-.1l-6.9 4.3-3-.9c-.6-.2-.6-.6.1-.9Z" />
    </svg>
  );
}

/** Конверт — клиент указал почту (подробный разбор приходит и письмом). */
export function MailIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#c9a45c" />
      <rect x="6" y="8" width="12" height="8.5" rx="1.6" fill="none" stroke="#fff" strokeWidth="1.6" />
      <path d="m6.8 9 5.2 4 5.2-4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** «Telegram» — клиент подключил бота: ответы уходят и туда. compact — только значок (в списке чатов). */
export function TelegramBadge({ compact = false }: { compact?: boolean }) {
  return compact ? (
    <span className="tg-badge tg-badge--dot" title="Подключил Telegram — ответы приходят ему и в бот">
      <TelegramIcon size={16} />
      <span className="sr-only">Telegram подключён</span>
    </span>
  ) : (
    <span className="tg-badge" title="Ответы приходят клиенту и в Telegram-бот, отвечать он может оттуда же">
      <TelegramIcon />
      Telegram
    </span>
  );
}

/** «📍 Москва» (значком: флаги-эмодзи Windows не рисует); не знаем — ничего. */
export function GeoTag({ country, city }: { country: string | null; city: string | null }) {
  const label = geoLabel(country, city);
  if (!country || !label) return null;
  return (
    <span className="geo-tag" title="Определено по IP при заявке">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
        <circle cx="12" cy="10" r="2.3" />
      </svg>
      {label}
    </span>
  );
}

/** ✓ — отправлено, ✓✓ — клиент прочитал. */
export function ReadTicks({ read }: { read: boolean }) {
  return (
    <span className={read ? "ticks ticks--read" : "ticks"} title={read ? "Прочитано" : "Отправлено, ещё не прочитано"}>
      <svg viewBox="0 0 20 12" width="18" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1.5 6.5 5 10l7-8" />
        {read && <path d="M8.5 9 9.6 10l7-8" />}
      </svg>
      <span className="sr-only">{read ? "прочитано" : "отправлено"}</span>
    </span>
  );
}
