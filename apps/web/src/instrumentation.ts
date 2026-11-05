/**
 * Запуск сервера. Если подключён Telegram-бот: настраиваем его (кнопка меню, вебхук) и раз
 * в 5 секунд отправляем приветствия и подробные разборы, которым пора (раз в минуту — напоминания
 * и просьбы оценить эксперта), — чтобы уведомление в Telegram пришло,
 * даже когда чат сейчас никто не открыл. Без бота разбор по-прежнему приходит при опросе чата.
 */
const FULL_TEXT_CHECK_MS = 5_000;
/** Напоминания и просьбы оценить эксперта (lib/bot-chores.ts) — раз в минуту. */
const CHORES_MS = 60_000;

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

  const { runBotChores } = await import("./lib/bot-chores");
  setInterval(() => {
    getDb()
      .then((db) => runBotChores(db))
      .catch((err: unknown) => console.warn(`Бот, плановое: ${err instanceof Error ? err.message : String(err)}`));
  }, CHORES_MS).unref();
}
