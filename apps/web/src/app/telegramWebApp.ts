/**
 * Сайт внутри приложения Telegram-бота. Telegram передаёт странице подписанные данные пользователя
 * (initData) в адресе: #tgWebAppData=… — только на первой открытой странице, поэтому запоминаем их
 * на время сессии. Подпись проверяет сервер (lib/telegram.ts), здесь данным не доверяем.
 */
const STORAGE_KEY = "tgInitData";

/** initData; null — сайт открыт не в Telegram. */
export function telegramInitData(): string | null {
  if (typeof window === "undefined") return null;
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("tgWebAppData");
  try {
    if (fromHash) sessionStorage.setItem(STORAGE_KEY, fromHash);
    return fromHash ?? sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return fromHash;
  }
}

/**
 * Человек сейчас не смотрит на страницу: вкладка скрыта, окно не в фокусе (открыто другое окно,
 * например админка рядом) или приложение в Telegram свёрнуто. Тогда сообщения не отмечаются
 * прочитанными, и клиенту из Telegram приходит уведомление.
 */
export function pageAway(): boolean {
  return document.hidden || !document.hasFocus() || window.Telegram?.WebApp?.isActive === false;
}

/** Имя из профиля Telegram — подставить в форму (человек может исправить). */
export function telegramFirstName(initData: string): string {
  try {
    const user = JSON.parse(new URLSearchParams(initData).get("user") ?? "") as { first_name?: unknown };
    return typeof user.first_name === "string" ? user.first_name.trim() : "";
  } catch {
    return "";
  }
}
