/**
 * Приложение в Telegram-боте (Mini App): сайт открывается внутри бота по кнопке меню.
 * - Telegram передаёт странице подписанные данные пользователя (initData). Сервер проверяет подпись
 *   токеном бота и по id пользователя находит его заявку — человек снова попадает в свой чат, даже
 *   если Telegram сбросил cookie.
 * - Заявку с обычного сайта можно привязать к Telegram: ссылка t.me/<бот>?start=<код> (linkCode),
 *   бот проверяет код и запоминает пользователя. /stop — отвязать.
 * - Из бота можно войти на сайт в браузере: кнопка «Открыть на сайте» ведёт на /api/telegram/vhod
 *   с подписанным кодом (loginCode) — сайт запоминает заявку в cookie.
 * - Переписка в боте: сообщения эксперта приходят в бот целиком, ответы из бота — в чат на сайте
 *   (lib/bot-delivery.ts и lib/bot-inbox.ts).
 * Без TELEGRAM_BOT_TOKEN и SITE_DOMAIN в .env всё это выключено, сайт работает как обычно.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, leads, telegramStarts } from "@/db/schema";
import { type EmojiKey, botEmojiDue, em, emojiId, emojiSetName, setBotEmoji } from "./bot-emoji";
import { isTelegramBlockedCached } from "./blocks";
import { isSource } from "./sources";

export interface TelegramConfig {
  token: string;
  /** Адрес сайта без косой черты в конце: https://taromba.com */
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

/** Источник, по ссылке с которым человек впервые открыл бота (t.me/<бот>?start=<источник>); null — без ссылки. */
export async function telegramStartSource(db: Db, telegramUserId: number): Promise<string | null> {
  const [row] = await db.select({ source: telegramStarts.source }).from(telegramStarts).where(eq(telegramStarts.telegramUserId, telegramUserId));
  return row && isSource(row.source) ? row.source : null;
}

/** Секрет вебхука: Telegram присылает его в заголовке — так видно, что запрос именно от Telegram. */
export function webhookSecret(token: string): string {
  return createHmac("sha256", "telegram-webhook").update(token).digest("hex");
}

/** Текст для parse_mode HTML: экранируем &, < и >. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Вызов Bot API: result из ответа или null при ошибке. Токен — в адресе запроса, поэтому адрес нигде не пишем в лог.
 * file — загрузить файл (multipart): поля body уходят рядом, объекты — строкой JSON.
 */
export async function botCall(
  token: string,
  method: string,
  body: object,
  file?: { field: string; data: Buffer; name: string; type: string },
): Promise<unknown> {
  // Заблокированный клиент (lib/blocks.ts): бот ему ничего не шлёт
  if (/^(send|copy|forward)/.test(method) && isTelegramBlockedCached((body as { chat_id?: unknown }).chat_id)) return null;
  try {
    let init: RequestInit;
    if (file) {
      const form = new FormData();
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      }
      form.set(file.field, new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
      init = { method: "POST", body: form };
    } else {
      init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { ...init, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      console.warn(`Telegram ${method}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    return ((await res.json()) as { result?: unknown }).result ?? null;
  } catch (err) {
    console.warn(`Telegram ${method}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function botApi(token: string, method: string, body: object): Promise<boolean> {
  return (await botCall(token, method, body)) !== null;
}

let username: Promise<string | null> | null = null;

/** Имя бота для ссылок t.me/<имя> — спрашиваем у Telegram один раз; не ответил — спросим в следующий раз. */
export function botUsername(cfg: TelegramConfig): Promise<string | null> {
  username ??= botCall(cfg.token, "getMe", {}).then((r) => {
    const name = (r as { username?: unknown } | null)?.username;
    if (typeof name === "string" && /^\w{5,32}$/.test(name)) return name;
    username = null;
    return null;
  });
  return username;
}

/**
 * Кнопка под сообщением бота: webApp — страница сайта внутри Telegram, url — в браузере, callback — ответ
 * боту без перехода (до 64 байт); icon — свой значок слева.
 */
export type BotButton = ({ text: string; webApp: string } | { text: string; url: string } | { text: string; callback: string }) & {
  icon?: EmojiKey;
};

const button = (b: BotButton) => {
  const icon = b.icon ? emojiId(b.icon) : undefined;
  return {
    text: b.text,
    ...("webApp" in b ? { web_app: { url: b.webApp } } : "url" in b ? { url: b.url } : { callback_data: b.callback }),
    ...(icon && { icon_custom_emoji_id: icon }),
  };
};

/** Кнопки под сообщением: кнопка — на своей строке, массив кнопок — одной строкой. Значок — если набор эмодзи загружен. */
export const keyboard = (buttons: (BotButton | BotButton[])[]) =>
  buttons.length === 0
    ? {}
    : { reply_markup: { inline_keyboard: buttons.map((b) => (Array.isArray(b) ? b.map(button) : [button(b)])) } };

/** Номер отправленного сообщения в чате Telegram; null — не ушло. */
export const sentId = (r: unknown) => {
  const id = (r as { message_id?: unknown } | null)?.message_id;
  return typeof id === "number" ? id : null;
};

/** Сообщение от бота (text — в разметке HTML). Возвращает его номер в чате или null, если не ушло. */
export async function sendMessage(
  cfg: TelegramConfig,
  chatId: number,
  text: string,
  buttons: (BotButton | BotButton[])[] = [],
): Promise<number | null> {
  return sentId(
    await botCall(cfg.token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...keyboard(buttons),
    }),
  );
}

const sign = (token: string, purpose: string, value: string) =>
  createHmac("sha256", token).update(`${purpose}:${value}`).digest("hex");

function sameHex(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const uuidFromHex = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

/**
 * Код привязки заявки к Telegram для ссылки t.me/<бот>?start=<код>: id заявки без дефисов и подпись.
 * Telegram пропускает в start только буквы, цифры, _ и - и не больше 64 символов — здесь 49.
 * Код даёт не больше, чем сам адрес заявки (по нему и так открывается чат).
 */
export function linkCode(token: string, leadId: string): string {
  return `l${leadId.replace(/-/g, "")}${sign(token, "link", leadId).slice(0, 16)}`;
}

export function leadFromLinkCode(token: string, code: string): string | null {
  const m = /^l([0-9a-f]{32})([0-9a-f]{16})$/.exec(code);
  if (!m) return null;
  const leadId = uuidFromHex(m[1]!);
  return sameHex(m[2]!, sign(token, "link", leadId).slice(0, 16)) ? leadId : null;
}

/** Ссылка «Открыть на сайте» из бота действует столько. */
export const LOGIN_CODE_MS = 7 * 24 * 60 * 60 * 1000;

/** Код входа на сайт из бота: заявка, срок и подпись. */
export function loginCode(token: string, leadId: string, now: Date): string {
  const exp = Math.floor((now.getTime() + LOGIN_CODE_MS) / 1000);
  return `${leadId}.${exp}.${sign(token, "login", `${leadId}.${exp}`).slice(0, 32)}`;
}

export function leadFromLoginCode(token: string, code: string, now: Date): string | null {
  const m = /^([0-9a-f-]{36})\.(\d{1,12})\.([0-9a-f]{32})$/.exec(code);
  if (!m) return null;
  const [, leadId, exp, sig] = m as unknown as [string, string, string, string];
  if (Number(exp) * 1000 < now.getTime()) return null;
  return sameHex(sig, sign(token, "login", `${leadId}.${exp}`).slice(0, 32)) ? leadId : null;
}

/** Привязать заявку к пользователю Telegram (прежняя привязка этой заявки заменяется). false — заявки нет. */
export async function linkLead(db: Db, leadId: string, telegramUserId: number): Promise<boolean> {
  const rows = await db.update(leads).set({ telegramUserId }).where(eq(leads.id, leadId)).returning({ id: leads.id });
  return rows.length > 0;
}

/** /stop: отвязать от этого пользователя Telegram все его заявки — уведомления больше не придут. */
export async function unlinkTelegramUser(db: Db, telegramUserId: number): Promise<number> {
  const rows = await db
    .update(leads)
    .set({ telegramUserId: null })
    .where(eq(leads.telegramUserId, telegramUserId))
    .returning({ id: leads.id });
  return rows.length;
}

/**
 * Настройка бота при запуске сайта: кнопка меню открывает сайт, сообщения боту приходят на вебхук.
 * Повторный вызов ничего не ломает — Telegram просто перезаписывает настройки.
 */
export async function configureBot(cfg: TelegramConfig): Promise<void> {
  await botApi(cfg.token, "setWebhook", {
    url: `${cfg.siteUrl}/api/telegram/webhook`,
    secret_token: webhookSecret(cfg.token),
    allowed_updates: ["message", "callback_query"],
  });
  await loadBotEmoji(cfg);
  await botApi(cfg.token, "setChatMenuButton", {
    menu_button: { type: "web_app", text: "Открыть", web_app: { url: cfg.siteUrl } },
  });
  await botApi(cfg.token, "setMyCommands", {
    commands: [
      { command: "start", description: "Открыть чат с экспертом" },
      { command: "experts", description: "Выбрать эксперта" },
      { command: "forecast", description: "Карта дня по утрам: включить или отключить" },
      { command: "stop", description: "Отключить уведомления" },
    ],
  });
}

/**
 * Перед отправкой: значков ещё нет (только запустились или Telegram не ответил) — читаем набор,
 * не чаще раза в 5 минут.
 */
export async function ensureBotEmoji(cfg: TelegramConfig): Promise<void> {
  if (botEmojiDue(Date.now(), 5 * 60 * 1000)) await loadBotEmoji(cfg);
}

/** Свои эмодзи бота из его набора (bot-emoji.ts). Набора ещё нет — бот пишет без значков. */
export async function loadBotEmoji(cfg: TelegramConfig): Promise<void> {
  const name = await botUsername(cfg);
  if (!name) return;
  const set = (await botCall(cfg.token, "getStickerSet", { name: emojiSetName(name) })) as { stickers?: unknown } | null;
  if (Array.isArray(set?.stickers)) setBotEmoji(set.stickers as { emoji?: unknown; custom_emoji_id?: unknown }[]);
}

export const welcomeText = () =>
  `${em("moon")}Здравствуйте! Это <b>Таромба</b> — бесплатный разбор по дате рождения и чат с экспертами по астрологии, таро и нумерологии.\n\n` +
  "Нажмите «Открыть», чтобы начать. Ответы эксперта будут приходить сюда — отвечать можно прямо в этом чате.";

/** Ответ бота на сообщение: текст (HTML) и кнопки (отправляет webhook). linked — только что привязанная заявка. */
export interface BotReply {
  text: string;
  buttons: BotButton[];
  linked?: string;
}

/**
 * Что ответить пользователю Telegram на сообщение text:
 * - /start <код> со ссылки «Подключить Telegram» на сайте — привязать заявку;
 * - /stop — отвязать все заявки;
 * - остальное — свой человек (заявка привязана): кнопки «Открыть чат» и «Открыть на сайте»;
 *   новый — приветствие с кнопкой «Открыть».
 */
export async function botReply(db: Db, cfg: TelegramConfig, telegramUserId: number, text: string, now: Date): Promise<BotReply> {
  const [command = "", arg = ""] = text.trim().split(/\s+/, 2);
  if (command === "/stop") {
    const n = await unlinkTelegramUser(db, telegramUserId);
    return {
      text: n
        ? `${em("bellOff")}Уведомления отключены. Чтобы снова получать ответы эксперта здесь, нажмите «Получать ответы в Telegram» в чате на сайте.`
        : "Уведомления и так не подключены.",
      buttons: [],
    };
  }

  // t.me/<бот>?start=r3 — реклама с ссылкой на бота: запоминаем источник (первое касание),
  // «Открыть» ведёт через короткий адрес — сайт тоже запомнит источник
  const source = command === "/start" && isSource(arg) ? arg : null;
  if (source) await db.insert(telegramStarts).values({ telegramUserId, source }).onConflictDoNothing();
  const withCode = command === "/start" && arg !== "" && !source;
  let linked: string | null = null;
  if (withCode) {
    const leadId = leadFromLinkCode(cfg.token, arg);
    if (leadId && (await linkLead(db, leadId, telegramUserId))) linked = leadId;
  }
  const leadId = linked ?? (await leadForTelegramUser(db, telegramUserId));
  if (!leadId) {
    return {
      text: withCode ? `Ссылка не подошла — откройте её на сайте ещё раз.\n\n${welcomeText()}` : welcomeText(),
      buttons: [
        { text: "Открыть", webApp: source ? `${cfg.siteUrl}/${source}` : cfg.siteUrl, icon: "moon" },
        { text: "Выбрать эксперта", callback: "exl", icon: "star" },
      ],
    };
  }

  const [lead] = await db.select({ name: leads.name }).from(leads).where(eq(leads.id, leadId));
  const [chat] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.leadId, leadId)).limit(1);
  const name = esc(lead?.name ?? "");
  const hello = linked
    ? `${em("check")}<b>${name}, Telegram подключён</b>\n\nОтветы экспертов будут приходить сюда — отвечать можно прямо в этом чате.`
    : `Здравствуйте, ${name}! Ответы экспертов приходят сюда — отвечать можно прямо в этом чате.`;
  return {
    text: `${hello}\n\nЧат можно открыть и на сайте в браузере. Отключить уведомления — /stop.`,
    buttons: [
      {
        text: chat ? "Открыть чат" : "Открыть разбор",
        webApp: `${cfg.siteUrl}/razbor/${leadId}${chat ? "/chat" : ""}`,
        icon: "chat",
      },
      { text: "Выбрать эксперта", callback: "exl", icon: "star" },
      { text: "Открыть на сайте", url: `${cfg.siteUrl}/api/telegram/vhod?t=${loginCode(cfg.token, leadId, now)}`, icon: "globe" },
    ],
    ...(linked && { linked }),
  };
}

/** Telegram на страницах клиента: подключён ли к заявке и ссылка на бота (подключить или открыть). */
export interface TelegramLinkView {
  connected: boolean;
  href: string;
}

/** null — бот выключен или Telegram не ответил, как его зовут: кнопку не показываем. */
export async function telegramLink(lead: { id: string; telegramUserId: number | null }): Promise<TelegramLinkView | null> {
  const cfg = telegramConfig();
  const name = cfg ? await botUsername(cfg) : null;
  if (!cfg || !name) return null;
  if (lead.telegramUserId) return { connected: true, href: `https://t.me/${name}` };
  return { connected: false, href: `https://t.me/${name}?start=${linkCode(cfg.token, lead.id)}` };
}
