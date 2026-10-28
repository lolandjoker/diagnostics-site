/**
 * Приложение в Telegram-боте (Mini App): сайт открывается внутри бота по кнопке меню.
 * - Telegram передаёт странице подписанные данные пользователя (initData). Сервер проверяет подпись
 *   токеном бота и по id пользователя находит его заявку — человек снова попадает в свой чат, даже
 *   если Telegram сбросил cookie.
 * - Ответил эксперт (или админ от его имени) или пришёл подробный разбор — бот пишет человеку
 *   с кнопкой «Открыть чат».
 * Без TELEGRAM_BOT_TOKEN и SITE_DOMAIN в .env всё это выключено, сайт работает как обычно.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, experts, leads } from "@/db/schema";

export interface TelegramConfig {
  token: string;
  /** Адрес сайта без косой черты в конце: https://diagnostics-free.com */
  siteUrl: string;
}

export function telegramConfig(env: Record<string, string | undefined> = process.env): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const domain = env.SITE_DOMAIN?.trim() ?? "";
  if (!/^\d+:[\w-]{30,}$/.test(token) || domain === "") return null;
  return { token, siteUrl: `https://${domain}` };
}

export interface TelegramUser {
  id: number;
  firstName: string;
}

/** Данные из Telegram старше суток не принимаем — переоткрытое приложение получит свежие. */
export const INIT_DATA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Проверка initData по правилам Telegram: HMAC-SHA256 от строки «ключ=значение» (по алфавиту,
 * без hash) с ключом HMAC-SHA256("WebAppData", токен бота). Подделка или старые данные — null.
 */
export function verifyInitData(initData: string, token: string, now: Date): TelegramUser | null {
  if (initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete("hash");
  const checkString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || now.getTime() - authDate * 1000 > INIT_DATA_MAX_AGE_MS) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "") as { id?: unknown; first_name?: unknown };
    if (typeof user.id !== "number" || !Number.isSafeInteger(user.id)) return null;
    return { id: user.id, firstName: typeof user.first_name === "string" ? user.first_name : "" };
  } catch {
    return null;
  }
}

/** Последняя заявка этого пользователя Telegram; null — ещё не заполнял форму в приложении. */
export async function leadForTelegramUser(db: Db, telegramUserId: number): Promise<string | null> {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.telegramUserId, telegramUserId))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return lead?.id ?? null;
}

/** Секрет вебхука: Telegram присылает его в заголовке — так видно, что запрос именно от Telegram. */
export function webhookSecret(token: string): string {
  return createHmac("sha256", "telegram-webhook").update(token).digest("hex");
}

/** Вызов Bot API. Токен — в адресе запроса, поэтому адрес нигде не пишем в лог. */
export async function botApi(token: string, method: string, body: object): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.warn(`Telegram ${method}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.ok;
  } catch (err) {
    console.warn(`Telegram ${method}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Сообщение от бота; button — кнопка, открывающая страницу сайта внутри Telegram. */
export function sendMessage(cfg: TelegramConfig, chatId: number, text: string, button?: { text: string; url: string }) {
  return botApi(cfg.token, "sendMessage", {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
    ...(button && { reply_markup: { inline_keyboard: [[{ text: button.text, web_app: { url: button.url } }]] } }),
  });
}

/** Клиент открывал чат совсем недавно — значит, смотрит его сейчас, уведомление не нужно. */
export const CLIENT_ACTIVE_MS = 15_000;
const PREVIEW_LENGTH = 200;

export type ClientNotice = { kind: "message"; expertId: number | null; body: string } | { kind: "fullText" };

export function noticeText(notice: ClientNotice, expertName: string, clientName: string): string {
  if (notice.kind === "fullText") return `✨ ${clientName}, ваш подробный разбор готов — откройте чат, чтобы прочитать.`;
  const body = notice.body.trim();
  const preview = body.length > PREVIEW_LENGTH ? `${body.slice(0, PREVIEW_LENGTH).trimEnd()}…` : body;
  return `💬 ${expertName}:\n${preview || "📷 Фото"}`;
}

/**
 * Уведомить клиента в Telegram о новом сообщении в чате. Только для заявок из приложения в боте;
 * ошибки не мешают самому чату (сообщение уже сохранено).
 */
export async function notifyClient(db: Db, conversationId: string, notice: ClientNotice, now = new Date()): Promise<void> {
  const cfg = telegramConfig();
  if (!cfg) return;
  try {
    const [row] = await db
      .select({
        leadId: leads.id,
        clientName: leads.name,
        telegramUserId: leads.telegramUserId,
        expertId: conversations.expertId,
        clientReadAt: conversations.clientReadAt,
      })
      .from(conversations)
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .where(eq(conversations.id, conversationId));
    if (!row?.telegramUserId) return;
    if (row.clientReadAt && now.getTime() - row.clientReadAt.getTime() < CLIENT_ACTIVE_MS) return;
    // Сообщение админа клиент видит от эксперта чата
    const expertId = notice.kind === "message" ? (notice.expertId ?? row.expertId) : row.expertId;
    const [expert] = await db.select({ name: experts.name }).from(experts).where(eq(experts.id, expertId));
    await sendMessage(cfg, row.telegramUserId, noticeText(notice, expert?.name ?? "Эксперт", row.clientName), {
      text: "Открыть чат",
      url: `${cfg.siteUrl}/razbor/${row.leadId}/chat?c=${conversationId}`,
    });
  } catch (err) {
    console.warn(`Уведомление в Telegram: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Настройка бота при запуске сайта: кнопка меню открывает сайт, сообщения боту приходят на вебхук.
 * Повторный вызов ничего не ломает — Telegram просто перезаписывает настройки.
 */
export async function configureBot(cfg: TelegramConfig): Promise<void> {
  await botApi(cfg.token, "setWebhook", {
    url: `${cfg.siteUrl}/api/telegram/webhook`,
    secret_token: webhookSecret(cfg.token),
    allowed_updates: ["message"],
  });
  await botApi(cfg.token, "setChatMenuButton", {
    menu_button: { type: "web_app", text: "Открыть", web_app: { url: cfg.siteUrl } },
  });
}

export const WELCOME_TEXT =
  "Здравствуйте! Здесь можно получить бесплатный разбор по дате рождения и задать вопросы эксперту.\n\n" +
  "Нажмите «Открыть», чтобы начать. Когда эксперт ответит, я пришлю уведомление сюда.";
