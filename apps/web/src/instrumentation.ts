/**
 * Запуск сервера. Если подключён Telegram-бот: настраиваем его (кнопка меню, вебхук) и раз
 * в 15 секунд отправляем подробные разборы, которым пора, — чтобы уведомление в Telegram пришло,
 * даже когда чат сейчас никто не открыл. Без бота разбор по-прежнему приходит при опросе чата.
 */
const FULL_TEXT_CHECK_MS = 15_000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configureBot, telegramConfig } = await import("./lib/telegram");
  const cfg = telegramConfig();
  if (!cfg) return;
  void configureBot(cfg);

  const { getDb } = await import("./db");
  const { deliverDueFullTexts } = await import("./lib/chat");
  setInterval(() => {
    getDb()
      .then((db) => deliverDueFullTexts(db, new Date()))
      .catch((err: unknown) => console.warn(`Подробные разборы: ${err instanceof Error ? err.message : String(err)}`));
  }, FULL_TEXT_CHECK_MS).unref();
}
