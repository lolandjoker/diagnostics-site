/**
 * Переписка с экспертом в Telegram-боте — для заявок, привязанных к Telegram, когда клиент не смотрит чат
 * на сайте прямо сейчас:
 * - сообщение эксперта (или админа от его имени) приходит в бот целиком. Первое в серии — с плашкой
 *   эксперта (lib/bot-card.tsx: фото, имя, рейтинг, статус), следующие подряд — просто текстом;
 * - подробная диагностика — с плашкой и текстом в сворачиваемой цитате;
 * - звонок — приглашение ответить.
 * Под последним сообщением — кнопка «Ответить на сайте»; ответить можно и прямо в боте (lib/bot-inbox.ts):
 * каждое сообщение бота запомнено вместе с чатом на сайте (telegram_messages).
 * Ошибки Telegram не мешают самому чату (сообщение на сайте уже сохранено).
 */
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, expertPhotos, experts, leads, messagePhotos, messages, telegramMessages } from "@/db/schema";
import { expertCardPng } from "./bot-card";
import { em } from "./bot-emoji";
import { expertStatus } from "./experts";
import { type BotButton, type TelegramConfig, botApi, botCall, ensureBotEmoji, esc, keyboard, sentId, telegramConfig } from "./telegram";

/** Клиент смотрел чат совсем недавно (чат опрашивается раз в 3 секунды) — значит, видит его сейчас, в бот не шлём. */
export const CLIENT_ACTIVE_MS = 10_000;
/** Плашка эксперта снова — если писал другой эксперт или с прошлого сообщения прошло столько. */
export const CARD_AGAIN_MS = 30 * 60 * 1000;
/** Подпись к картинке в Telegram — до 1024 символов, текст — до 4096; режем с запасом. */
const CAPTION_LIMIT = 900;
const CHUNK_LIMIT = 3500;

export type ClientNotice =
  | { kind: "message"; messageId: number }
  | { kind: "call"; expertId: number | null }
  | { kind: "fullText"; messageId: number };

/**
 * Сообщения одного чата уходят в Telegram по очереди — в том же порядке, что на сайте. Очереди общие для
 * процесса (globalThis): ответ эксперта и ответ из бота приходят через разные обработчики запросов.
 */
const queues = ((globalThis as unknown as { __diagBotQueues?: Map<string, Promise<void>> }).__diagBotQueues ??= new Map());

export function enqueue(key: string, job: () => Promise<void>): Promise<void> {
  const cfg = telegramConfig();
  const next = (queues.get(key) ?? Promise.resolve())
    .then(async () => {
      if (cfg) await ensureBotEmoji(cfg);
      await job();
    })
    .catch((err: unknown) => console.warn(`Telegram: ${err instanceof Error ? err.message : String(err)}`));
  queues.set(key, next);
  void next.then(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

/** Длинный текст — кусками по границе строк (или слов), каждый не длиннее limit. */
export function splitText(text: string, limit = CHUNK_LIMIT): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit / 2) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export interface ChatContext {
  conversationId: string;
  leadId: string;
  clientName: string;
  chatId: number;
  expertId: number;
  chatUrl: string;
}

/** Чат на сайте → куда писать в Telegram. null — заявка не привязана, эксперт в архиве или клиент сейчас на сайте. */
export async function chatContext(db: Db, cfg: TelegramConfig, conversationId: string, now: Date, force: boolean): Promise<ChatContext | null> {
  const [row] = await db
    .select({
      leadId: leads.id,
      clientName: leads.name,
      telegramUserId: leads.telegramUserId,
      expertId: conversations.expertId,
      clientReadAt: conversations.clientReadAt,
      archivedAt: experts.archivedAt,
      blockedAt: leads.blockedAt,
    })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .where(eq(conversations.id, conversationId));
  // Чат с экспертом из архива клиент не видит — и не зовём в него
  if (!row?.telegramUserId || row.archivedAt || row.blockedAt) return null;
  if (!force && row.clientReadAt && now.getTime() - row.clientReadAt.getTime() < CLIENT_ACTIVE_MS) return null;
  return {
    conversationId,
    leadId: row.leadId,
    clientName: row.clientName,
    chatId: row.telegramUserId,
    expertId: row.expertId,
    chatUrl: `${cfg.siteUrl}/razbor/${row.leadId}/chat?c=${conversationId}`,
  };
}

/**
 * Плашки: готовые картинки (png) и их file_id в Telegram — общие для процесса (globalThis), чтобы каждый
 * обработчик запросов не рисовал заново. Ключ меняется вместе с плашкой (имя, рейтинг, статус, фото).
 * Одну и ту же плашку одновременно рисуем один раз (rendering).
 */
const cardCache = ((globalThis as unknown as { __diagBotCards?: CardCache }).__diagBotCards ??= {
  files: new Map(),
  pngs: new Map(),
  rendering: new Map(),
});
interface CardCache {
  files: Map<string, string>;
  pngs: Map<string, Buffer>;
  rendering: Map<string, Promise<Buffer | null>>;
}
const CARD_CACHE_LIMIT = 300;

export interface ExpertCardRef {
  key: string;
  /** Уже загружена в Telegram — шлём по file_id. */
  fileId?: string;
  /** Картинка (из памяти или нарисовать — фото эксперта читается из базы только тут). */
  png: () => Promise<Buffer | null>;
}

/** Плашка эксперта для отправки. Лёгкий запрос: без самого фото, только когда оно обновлялось. */
export async function expertCard(db: Db, expertId: number, now: Date): Promise<ExpertCardRef | null> {
  const [e] = await db
    .select({
      id: experts.id,
      name: experts.name,
      rating: experts.rating,
      online: experts.online,
      onlineUntil: experts.onlineUntil,
      busy: experts.busy,
      photoAt: expertPhotos.updatedAt,
    })
    .from(experts)
    .leftJoin(expertPhotos, eq(expertPhotos.expertId, experts.id))
    .where(eq(experts.id, expertId));
  if (!e) return null;
  const status = expertStatus(e, now);
  const key = [e.id, e.name, e.rating, status, e.photoAt?.getTime() ?? 0].join("|");
  const png = () => {
    const ready = cardCache.pngs.get(key);
    if (ready) return Promise.resolve(ready);
    let job = cardCache.rendering.get(key);
    if (!job) {
      job = (async () => {
        const [photo] = e.photoAt
          ? await db.select({ mime: expertPhotos.mime, data: expertPhotos.data }).from(expertPhotos).where(eq(expertPhotos.expertId, e.id))
          : [];
        const out = await expertCardPng({ name: e.name, rating: e.rating, status, photo: photo ?? null });
        if (cardCache.pngs.size > CARD_CACHE_LIMIT) cardCache.pngs.clear();
        cardCache.pngs.set(key, out);
        return out;
      })()
        .catch((err: unknown) => {
          console.warn(`Плашка эксперта: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        })
        .finally(() => cardCache.rendering.delete(key));
      cardCache.rendering.set(key, job);
    }
    return job;
  };
  const fileId = cardCache.files.get(key);
  return { key, ...(fileId && { fileId }), png };
}

/** Нарисовать плашки заранее (в фоне), чтобы следующая карточка открылась сразу. */
export function warmExpertCards(db: Db, expertIds: number[], now: Date): void {
  for (const id of expertIds) {
    void expertCard(db, id, now)
      .then((c) => (c && !c.fileId ? c.png() : null))
      .catch(() => {});
  }
}

/** Запомнить file_id плашки из ответа Telegram (sendPhoto или editMessageMedia). */
export function rememberCardFile(key: string, sent: unknown): void {
  const fileId = (sent as { photo?: { file_id?: string }[] } | null)?.photo?.at(-1)?.file_id;
  if (!fileId) return;
  if (cardCache.files.size > CARD_CACHE_LIMIT) cardCache.files.clear();
  cardCache.files.set(key, fileId);
}

/** Забыть все плашки (для тестов: у каждого теста своя база). */
export function clearCardCache(): void {
  cardCache.files.clear();
  cardCache.pngs.clear();
}

export function forgetCardFile(key: string): void {
  cardCache.files.delete(key);
}

export async function sendCard(
  db: Db,
  cfg: TelegramConfig,
  chatId: number,
  expertId: number,
  now: Date,
  caption: string | null,
  buttons: (BotButton | BotButton[])[],
): Promise<number | null> {
  const card = await expertCard(db, expertId, now);
  if (!card) return null;
  const fields = { chat_id: chatId, ...(caption && { caption, parse_mode: "HTML" }), ...keyboard(buttons) };
  if (card.fileId) {
    const id = sentId(await botCall(cfg.token, "sendPhoto", { ...fields, photo: card.fileId }));
    if (id !== null) return id;
    forgetCardFile(card.key);
  }
  const png = await card.png();
  if (!png) return null;
  const sent = await botCall(cfg.token, "sendPhoto", fields, { field: "photo", data: png, name: "expert.png", type: "image/png" });
  rememberCardFile(card.key, sent);
  return sentId(sent);
}

export async function sendText(cfg: TelegramConfig, chatId: number, html: string, buttons: (BotButton | BotButton[])[]): Promise<number | null> {
  return sentId(
    await botCall(cfg.token, "sendMessage", {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...keyboard(buttons),
    }),
  );
}

/**
 * Запомнить отправленное сообщение бота (ответ на него уйдёт в этот чат). С кнопками — у прежних сообщений
 * в Telegram кнопку убираем: «Ответить на сайте» остаётся только под последним.
 */
export async function remember(
  db: Db,
  cfg: TelegramConfig,
  ctx: ChatContext,
  messageId: number | null,
  info: { siteMessageId?: number; expertId?: number; withButtons: boolean; purpose?: "reminder" | "review" },
): Promise<void> {
  if (messageId === null) return;
  if (info.withButtons) {
    const old = await db
      .update(telegramMessages)
      .set({ withButtons: false })
      .where(and(eq(telegramMessages.chatId, ctx.chatId), eq(telegramMessages.withButtons, true)))
      .returning({ messageId: telegramMessages.messageId });
    for (const o of old) {
      await botApi(cfg.token, "editMessageReplyMarkup", { chat_id: ctx.chatId, message_id: o.messageId, reply_markup: { inline_keyboard: [] } });
    }
  }
  await db
    .insert(telegramMessages)
    .values({
      chatId: ctx.chatId,
      messageId,
      conversationId: ctx.conversationId,
      siteMessageId: info.siteMessageId ?? null,
      expertId: info.expertId ?? null,
      withButtons: info.withButtons,
      purpose: info.purpose ?? null,
    })
    .onConflictDoNothing();
}

/** Последнее сообщение бота этому человеку — по нему решаем, нужна ли плашка снова. */
async function lastBotMessage(db: Db, chatId: number) {
  const [row] = await db
    .select()
    .from(telegramMessages)
    .where(eq(telegramMessages.chatId, chatId))
    .orderBy(desc(telegramMessages.createdAt), desc(telegramMessages.messageId))
    .limit(1);
  return row ?? null;
}

const REPLY_HINT = () => `\n\n<i>${em("pen")}Ответить можно прямо здесь — просто напишите сообщение.</i>`;

/** Отправить по кускам; кнопки — под последним. Номера отправленных — по порядку. */
async function sendChunks(cfg: TelegramConfig, chatId: number, chunks: string[], buttons: BotButton[]): Promise<(number | null)[]> {
  const ids: (number | null)[] = [];
  for (let i = 0; i < chunks.length; i++) {
    ids.push(await sendText(cfg, chatId, chunks[i]!, i === chunks.length - 1 ? buttons : []));
  }
  return ids;
}

/** Сообщение эксперта (или админа от его имени) — в бот. force — даже если клиент сейчас на сайте. */
async function deliverMessage(db: Db, cfg: TelegramConfig, messageId: number, now: Date, force: boolean): Promise<void> {
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!m || (m.author !== "expert" && m.author !== "admin")) return;
  const ctx = await chatContext(db, cfg, m.conversationId, now, force);
  if (!ctx) return;
  const [photo] = await db.select({ data: messagePhotos.data, mime: messagePhotos.mime }).from(messagePhotos).where(eq(messagePhotos.messageId, m.id));
  if (!photo && m.body.trim() === "") return;

  // Сообщение админа клиент видит от эксперта чата
  const expertId = m.author === "expert" ? (m.expertId ?? ctx.expertId) : ctx.expertId;
  const last = await lastBotMessage(db, ctx.chatId);
  const withCard =
    !last || last.conversationId !== ctx.conversationId || last.expertId !== expertId || now.getTime() - last.createdAt.getTime() > CARD_AGAIN_MS;
  const hint = last ? "" : REPLY_HINT();
  const buttons: BotButton[] = [{ text: "Ответить на сайте", webApp: ctx.chatUrl, icon: "reply" }];
  const info = { siteMessageId: m.id, expertId };
  const body = m.body.trim();

  if (photo) {
    const [e] = await db.select({ name: experts.name }).from(experts).where(eq(experts.id, expertId));
    const short = body.length <= CAPTION_LIMIT;
    const caption = (withCard && e ? `<b>${esc(e.name)}</b>\n` : "") + (short ? esc(body) + hint : "");
    const id = sentId(
      await botCall(
        cfg.token,
        "sendPhoto",
        { chat_id: ctx.chatId, ...(caption && { caption, parse_mode: "HTML" }), ...(short ? keyboard(buttons) : {}) },
        { field: "photo", data: photo.data, name: "photo", type: photo.mime },
      ),
    );
    await remember(db, cfg, ctx, id, { ...info, withButtons: short });
    if (!short) {
      const chunks = splitText(body).map(esc);
      chunks[chunks.length - 1] += hint;
      const ids = await sendChunks(cfg, ctx.chatId, chunks, buttons);
      for (let i = 0; i < ids.length; i++) await remember(db, cfg, ctx, ids[i]!, { ...info, withButtons: i === ids.length - 1 });
    }
    return;
  }

  if (withCard && body.length <= CAPTION_LIMIT) {
    const id = await sendCard(db, cfg, ctx.chatId, expertId, now, esc(body) + hint, buttons);
    await remember(db, cfg, ctx, id, { ...info, withButtons: true });
    return;
  }
  if (withCard) {
    // Длинное сообщение: плашка отдельно, текст — следом
    await remember(db, cfg, ctx, await sendCard(db, cfg, ctx.chatId, expertId, now, null, []), { ...info, withButtons: false });
  }
  const chunks = splitText(body).map(esc);
  chunks[chunks.length - 1] += hint;
  const ids = await sendChunks(cfg, ctx.chatId, chunks, buttons);
  for (let i = 0; i < ids.length; i++) await remember(db, cfg, ctx, ids[i]!, { ...info, withButtons: i === ids.length - 1 });
}

/** Подробная диагностика — в бот: плашка эксперта с заголовком, текст — в сворачиваемой цитате. */
async function deliverFullText(db: Db, cfg: TelegramConfig, messageId: number, now: Date, force: boolean): Promise<void> {
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!m || m.author !== "system" || m.body.trim() === "") return;
  const ctx = await chatContext(db, cfg, m.conversationId, now, force);
  if (!ctx) return;
  const last = await lastBotMessage(db, ctx.chatId);
  const buttons: BotButton[] = [{ text: "Ответить на сайте", webApp: ctx.chatUrl, icon: "reply" }];
  const title = `${em("sparkle")}<b>${esc(ctx.clientName)}, ваш подробный разбор готов</b>`;
  const card = await sendCard(db, cfg, ctx.chatId, ctx.expertId, now, title, []);
  await remember(db, cfg, ctx, card, { siteMessageId: m.id, expertId: ctx.expertId, withButtons: false });
  const chunks = splitText(m.body).map((c) => `<blockquote expandable>${esc(c)}</blockquote>`);
  chunks[chunks.length - 1] += last ? "" : REPLY_HINT();
  const ids = await sendChunks(cfg, ctx.chatId, chunks, buttons);
  for (let i = 0; i < ids.length; i++) {
    await remember(db, cfg, ctx, ids[i]!, { siteMessageId: m.id, expertId: ctx.expertId, withButtons: i === ids.length - 1 });
  }
}

/** Звонит эксперт (или админ от его имени) — ответить можно только на сайте. */
async function deliverCall(db: Db, cfg: TelegramConfig, conversationId: string, expertId: number | null, now: Date): Promise<void> {
  const ctx = await chatContext(db, cfg, conversationId, now, false);
  if (!ctx) return;
  const [e] = await db.select({ name: experts.name }).from(experts).where(eq(experts.id, expertId ?? ctx.expertId));
  const id = await sendText(cfg, ctx.chatId, `${em("phone")}<b>${esc(e?.name ?? "Эксперт")}</b> звонит вам — откройте чат, чтобы ответить.`, [
    { text: "Ответить на звонок", webApp: ctx.chatUrl, icon: "phone" },
  ]);
  await remember(db, cfg, ctx, id, { expertId: expertId ?? ctx.expertId, withButtons: true });
}

/**
 * Новое в чате — клиенту в Telegram: сообщение эксперта, звонок, подробный разбор. Только для заявок,
 * привязанных к Telegram; клиент смотрит чат на сайте прямо сейчас — не дублируем.
 */
export function notifyClient(db: Db, conversationId: string, notice: ClientNotice, now = new Date()): Promise<void> {
  const cfg = telegramConfig();
  if (!cfg) return Promise.resolve();
  return enqueue(conversationId, () =>
    notice.kind === "message"
      ? deliverMessage(db, cfg, notice.messageId, now, false)
      : notice.kind === "fullText"
        ? deliverFullText(db, cfg, notice.messageId, now, false)
        : deliverCall(db, cfg, conversationId, notice.expertId, now),
  );
}

/**
 * Человек только что подключил Telegram: последнее сообщение эксперта (или диагностика) из его текущего
 * чата приходит в бот — переписку можно продолжить прямо там.
 */
export async function sendLatestToTelegram(db: Db, cfg: TelegramConfig, leadId: string, now = new Date()): Promise<void> {
  const [c] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .where(and(eq(conversations.leadId, leadId)))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  if (!c) return;
  const recent = await db
    .select({ id: messages.id, author: messages.author })
    .from(messages)
    .where(eq(messages.conversationId, c.id))
    .orderBy(desc(messages.id))
    .limit(20);
  const m = recent.find((r) => r.author !== "client");
  if (!m) return;
  await enqueue(c.id, () =>
    m.author === "system" ? deliverFullText(db, cfg, m.id, now, true) : deliverMessage(db, cfg, m.id, now, true),
  );
}

/** Эксперт набирает ответ — в боте «печатает…» (Telegram держит его ~5 с; шлём не чаще раза в 4 с). */
const typingSent = new Map<string, number>();

export async function botTyping(db: Db, conversationId: string, now = new Date()): Promise<void> {
  const cfg = telegramConfig();
  if (!cfg) return;
  const prev = typingSent.get(conversationId) ?? 0;
  if (now.getTime() - prev < 4000) return;
  typingSent.set(conversationId, now.getTime());
  if (typingSent.size > 1000) typingSent.clear();
  try {
    const ctx = await chatContext(db, cfg, conversationId, now, false);
    if (ctx) await botApi(cfg.token, "sendChatAction", { chat_id: ctx.chatId, action: "typing" });
  } catch {
    // «печатает…» — не важно, если не дошло
  }
}

/** Сообщение сайта удалили — убрать его и из Telegram клиента (бот может удалять свои сообщения до 48 часов). */
export async function deleteFromTelegram(db: Db, siteMessageId: number): Promise<number> {
  const cfg = telegramConfig();
  if (!cfg) return 0;
  const rows = await db
    .delete(telegramMessages)
    .where(eq(telegramMessages.siteMessageId, siteMessageId))
    .returning({ chatId: telegramMessages.chatId, messageId: telegramMessages.messageId });
  for (const r of rows) await botApi(cfg.token, "deleteMessage", { chat_id: r.chatId, message_id: r.messageId });
  return rows.length;
}

/**
 * Сообщение исправили — если оно уже ушло клиенту в Telegram: старое там убираем, исправленное присылаем
 * заново тем же оформлением (плашка эксперта, кнопка «Ответить на сайте»).
 */
export function resendEditedToTelegram(db: Db, conversationId: string, siteMessageId: number, now = new Date()): Promise<void> {
  const cfg = telegramConfig();
  if (!cfg) return Promise.resolve();
  return enqueue(conversationId, async () => {
    if ((await deleteFromTelegram(db, siteMessageId)) === 0) return;
    await deliverMessage(db, cfg, siteMessageId, now, true);
  });
}
