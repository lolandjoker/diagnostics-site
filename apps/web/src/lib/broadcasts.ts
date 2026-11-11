/**
 * Рассылки в Telegram-бот из админки — тем, кто подключил бота (заявка привязана к Telegram и не отключена
 * командой /stop): всем или только тем, кто не ответил нам в чате / ни разу не писал (AUDIENCES).
 * Заблокированных клиентов (lib/blocks.ts) в рассылке нет. Отправка идёт в фоне, не быстрее BROADCAST_PER_SECOND сообщений в секунду (лимит Telegram —
 * около 30): страница показывает, сколько ушло. Внизу каждой рассылки — «Отключить сообщения — /stop».
 * Личная кнопка (PERSONAL_PAGES) открывает каждому его собственную страницу внутри Telegram — «Мой день», чат,
 * квиз — по его последней заявке, без ввода имени и даты. Разметка текста: **жирный**. Заблокировавшим бота сообщение не доходит — оно в «не дошло».
 * Условия к «Кому» (BroadcastFilters): заявка оставлена больше N часов назад, клиент не писал нам больше N часов.
 * Серия: до MAX_BROADCAST_MESSAGES сообщений подряд, к каждому — фото или видео. Файл грузится в Telegram один раз
 * (первому получателю), остальным уходит по file_id. Кнопка и «/stop» — под последним сообщением серии.
 * Сами файлы в базе не храним (в истории — только имя и размер): рассылка, прерванная перезапуском, не доотправится.
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { broadcasts, conversations, leads } from "@/db/schema";
import { em } from "./bot-emoji";
import {
  AUDIENCES,
  type Audience,
  MAX_BROADCAST_MESSAGES,
  MAX_CAPTION,
  MAX_FILTER_HOURS,
  MAX_MEDIA_BYTES,
  MAX_PHOTO_BYTES,
  PERSONAL_PAGES,
  type PersonalPage,
  SERIES_GAP_MS,
  isAudience,
  isPersonalPage,
  mediaKind,
} from "./broadcast-pages";
import { type BotButton, type TelegramConfig, botCall, ensureBotEmoji, esc, keyboard, sendMessage, sentId } from "./telegram";

export const MAX_BROADCAST_LENGTH = 3500;
export const BROADCAST_PER_SECOND = 20;
/** Чаще раза в сутки — предупреждаем: частые рассылки — частые блокировки бота. */
export const BROADCAST_GAP_MS = 24 * 60 * 60 * 1000;

export type Broadcast = typeof broadcasts.$inferSelect;

export {
  MAX_BROADCAST_MESSAGES,
  MAX_CAPTION,
  MAX_FILTER_HOURS,
  MAX_MEDIA_BYTES,
  MAX_PHOTO_BYTES,
  SERIES_GAP_MS,
  mediaKind,
};

export interface BroadcastMedia {
  kind: "photo" | "video";
  data: Buffer;
  name: string;
  type: string;
}

/** Одно сообщение серии: текст (может быть пустым, если есть файл) и фото или видео. */
export interface BroadcastMessage {
  body: string;
  media?: BroadcastMedia | undefined;
}

/** Условия к «Кому»; не задано — без условия. */
export interface BroadcastFilters {
  /** Первая заявка человека оставлена больше N часов назад. */
  registeredHours?: number | undefined;
  /** Клиент не писал нам в чат больше N часов (или не писал вовсе). */
  silentHours?: number | undefined;
}

export { AUDIENCES, type Audience, isAudience };

// Личная кнопка: куда ведёт и надпись по умолчанию (chat — последний чат человека, нет чата — выбор эксперта)
export { PERSONAL_PAGES, type PersonalPage, isPersonalPage };

export interface BroadcastInput {
  /** Кому; по умолчанию — всем. */
  audience?: Audience;
  /** Личная кнопка — куда ведёт; не задана — без неё. */
  personalPage?: PersonalPage | undefined;
  /** Надпись личной кнопки; пусто — по умолчанию (PERSONAL_PAGES). */
  personalText?: string;
  body: string;
  buttonText: string;
  buttonUrl: string;
  /** Подарок/новость — значок в начале. */
  gift: boolean;
  /** Серия сообщений; не задана — одно сообщение из body. */
  messages?: BroadcastMessage[];
  filters?: BroadcastFilters;
}

/** Сообщения рассылки: серия или одно из body. */
export const messagesOf = (input: BroadcastInput): BroadcastMessage[] =>
  input.messages?.length ? input.messages : [{ body: input.body }];

export function validateBroadcast(input: BroadcastInput): string | null {
  const list = messagesOf(input);
  if (list.length > MAX_BROADCAST_MESSAGES) return `Не больше ${MAX_BROADCAST_MESSAGES} сообщений в рассылке`;
  let mediaBytes = 0;
  for (const [i, m] of list.entries()) {
    const where = list.length > 1 ? `Сообщение ${i + 1}: ` : "";
    const body = m.body.trim();
    if (body === "" && !m.media) return list.length > 1 ? `${where}нужен текст, фото или видео` : "Напишите текст рассылки";
    if (body.length > MAX_BROADCAST_LENGTH) return `${where}текст длиннее ${MAX_BROADCAST_LENGTH} символов`;
    if (m.media) {
      if (m.media.kind === "photo" && m.media.data.length > MAX_PHOTO_BYTES) return `${where}фото больше 10 МБ`;
      mediaBytes += m.media.data.length;
    }
  }
  if (mediaBytes > MAX_MEDIA_BYTES) return "Фото и видео вместе — до 50 МБ";
  for (const h of [input.filters?.registeredHours, input.filters?.silentHours]) {
    if (h !== undefined && (!Number.isInteger(h) || h < 1 || h > MAX_FILTER_HOURS)) return `Часы в условиях — от 1 до ${MAX_FILTER_HOURS}`;
  }
  const t = input.buttonText.trim();
  const u = input.buttonUrl.trim();
  if ((t === "") !== (u === "")) return "Для кнопки нужны и надпись, и адрес";
  if (t.length > 40) return "Надпись на кнопке — до 40 символов";
  if (u && !/^https:\/\/[^\s]+$/.test(u)) return "Адрес кнопки должен начинаться с https://";
  if ((input.personalText ?? "").trim().length > 40) return "Надпись личной кнопки — до 40 символов";
  return null;
}

/** Последняя заявка и последний чат каждого человека Telegram — для личной кнопки. */
async function personalTargets(db: Db, telegramUserIds: number[]): Promise<Map<number, { leadId: string; chatId: string | null }>> {
  const out = new Map<number, { leadId: string; chatId: string | null }>();
  for (let i = 0; i < telegramUserIds.length; i += 500) {
    const part = telegramUserIds.slice(i, i + 500);
    const rows = await db
      .select({ tg: leads.telegramUserId, leadId: leads.id, createdAt: leads.createdAt })
      .from(leads)
      .where(inArray(leads.telegramUserId, part));
    const latest = new Map<number, { leadId: string; at: number }>();
    for (const r of rows) {
      if (r.tg === null) continue;
      const prev = latest.get(r.tg);
      if (!prev || r.createdAt.getTime() > prev.at) latest.set(r.tg, { leadId: r.leadId, at: r.createdAt.getTime() });
    }
    const leadIds = [...latest.values()].map((v) => v.leadId);
    const chats = leadIds.length
      ? await db
          .select({ leadId: conversations.leadId, id: conversations.id, at: conversations.lastMessageAt })
          .from(conversations)
          .where(inArray(conversations.leadId, leadIds))
      : [];
    const lastChat = new Map<string, { id: string; at: number }>();
    for (const c of chats) {
      const prev = lastChat.get(c.leadId);
      if (!prev || c.at.getTime() > prev.at) lastChat.set(c.leadId, { id: c.id, at: c.at.getTime() });
    }
    for (const [tg, v] of latest) out.set(tg, { leadId: v.leadId, chatId: lastChat.get(v.leadId)?.id ?? null });
  }
  return out;
}

/** Адрес личной страницы человека. */
export function personalUrl(siteUrl: string, page: PersonalPage, target: { leadId: string; chatId: string | null }): string {
  if (page === "chat") {
    return target.chatId ? `${siteUrl}/razbor/${target.leadId}/chat?c=${target.chatId}` : `${siteUrl}/razbor/${target.leadId}/eksperty`;
  }
  return `${siteUrl}/razbor/${target.leadId}/${page}`;
}

const FOOTER = "<i>Отключить сообщения — /stop</i>";

/** Текст одного сообщения серии (HTML): **жирный**; значок подарка — у первого, «/stop» — у последнего. */
export function messageHtml(body: string, opts: { gift: boolean; last: boolean }): string {
  const text = esc(body.replace(/\r\n/g, "\n").trim()).replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  const head = `${opts.gift ? em("gift") : ""}${text}`;
  return [head, opts.last ? FOOTER : ""].filter(Boolean).join("\n\n");
}

/** Текст рассылки из одного сообщения: **жирный**, значок подарка, внизу — как отключить. */
export function broadcastHtml(input: BroadcastInput): string {
  return messageHtml(input.body, { gift: input.gift, last: true });
}

/** Сообщение серии при отправке: файл после первой загрузки — по file_id. */
interface Slot {
  body: string;
  media?: BroadcastMedia | undefined;
  fileId?: string | undefined;
}

/** file_id загруженного файла из ответа Telegram (видео Telegram может принять как анимацию или документ). */
function fileIdOf(sent: unknown, kind: "photo" | "video"): string | undefined {
  const r = sent as {
    photo?: { file_id?: string }[];
    video?: { file_id?: string };
    animation?: { file_id?: string };
    document?: { file_id?: string };
  } | null;
  if (!r) return undefined;
  return kind === "photo" ? r.photo?.at(-1)?.file_id : (r.video ?? r.animation ?? r.document)?.file_id;
}

async function sendMedia(cfg: TelegramConfig, chatId: number, slot: Slot, fields: object): Promise<boolean> {
  const m = slot.media!;
  const method = m.kind === "photo" ? "sendPhoto" : "sendVideo";
  const body = { chat_id: chatId, ...fields, ...(m.kind === "video" && { supports_streaming: true }) };
  const sent = slot.fileId
    ? await botCall(cfg.token, method, { ...body, [m.kind]: slot.fileId })
    : await botCall(cfg.token, method, body, { field: m.kind, data: m.data, name: m.name, type: m.type });
  slot.fileId ??= fileIdOf(sent, m.kind);
  return sentId(sent) !== null;
}

/** Серия одному человеку по порядку; что-то не ушло (заблокировал бота) — дальше не шлём. Всё дошло — true. */
async function sendSeries(
  cfg: TelegramConfig,
  chatId: number,
  slots: Slot[],
  input: BroadcastInput,
  target?: { leadId: string; chatId: string | null },
): Promise<boolean> {
  const kb = buttons(input, cfg.siteUrl, target);
  for (const [i, s] of slots.entries()) {
    const last = i === slots.length - 1;
    const html = messageHtml(s.body, { gift: input.gift && i === 0, last });
    const marks = last ? kb : [];
    let ok: boolean;
    if (!s.media) {
      ok = (await sendMessage(cfg, chatId, html, marks)) !== null;
    } else if (s.body.trim().length <= MAX_CAPTION) {
      ok = await sendMedia(cfg, chatId, s, { ...(html && { caption: html, parse_mode: "HTML" }), ...keyboard(marks) });
    } else {
      // Длинный текст в подпись не влезет — файл, следом текст
      ok = (await sendMedia(cfg, chatId, s, {})) && (await sendMessage(cfg, chatId, html, marks)) !== null;
    }
    if (!ok) return false;
    if (!last) await sleep(SERIES_GAP_MS);
  }
  return true;
}

const slotsOf = (input: BroadcastInput): Slot[] => messagesOf(input).map((m) => ({ body: m.body, media: m.media }));

/** Запись серии в историю — без самих файлов. */
export const partsRecord = (input: BroadcastInput) =>
  messagesOf(input).map((m) => ({
    body: m.body.trim(),
    media: m.media ? { kind: m.media.kind, name: m.media.name, size: m.media.data.length } : null,
  }));

/** Кнопки рассылки: личная (своя у каждого, открывается внутри Telegram) и обычная ссылка. */
function buttons(input: BroadcastInput, siteUrl?: string, target?: { leadId: string; chatId: string | null }): BotButton[] {
  const out: BotButton[] = [];
  if (input.personalPage && siteUrl && target) {
    const text = input.personalText?.trim() || PERSONAL_PAGES[input.personalPage].button;
    out.push({ text, webApp: personalUrl(siteUrl, input.personalPage, target), icon: input.personalPage === "chat" ? "chat" : "sparkle" });
  }
  if (input.buttonText.trim()) out.push({ text: input.buttonText.trim(), url: input.buttonUrl.trim() });
  return out;
}

/**
 * Кому рассылать (каждый человек Telegram один раз, по всем его заявкам и чатам):
 * - all — все с привязанной заявкой;
 * - silent — писал в чат, но самое последнее сообщение во всех его чатах — наше (эксперт, оператор, авторазбор);
 * - never — ни одного своего сообщения ни в одном чате;
 * - no_archetype / no_compat / no_yesno — не проходил этот квиз ни по одной своей заявке, no_card — ни разу не тянул
 *   карту дня, no_quiz — ни одного квиза.
 * Заблокированных не берём.
 */
const AUDIENCE_WHERE: Record<Audience, ReturnType<typeof sql>> = {
  all: sql`true`,
  silent: sql`wrote and last_author <> 'client'`,
  never: sql`not wrote`,
  no_archetype: sql`not did_archetype`,
  no_compat: sql`not did_compat`,
  no_yesno: sql`not did_yesno`,
  no_card: sql`not did_card`,
  no_quiz: sql`not did_archetype and not did_compat and not did_yesno`,
};

/** Момент «N часов назад» для условия. */
const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

export async function broadcastRecipients(
  db: Db,
  audience: Audience = "all",
  filters: BroadcastFilters = {},
  now: Date = new Date(),
): Promise<number[]> {
  const where = [AUDIENCE_WHERE[audience]];
  // Регистрация — первая заявка человека (из всех его заявок с этим Telegram)
  if (filters.registeredHours) where.push(sql`first_at <= ${hoursAgo(now, filters.registeredHours)}::timestamptz`);
  // Молчит — его последнее сообщение в любом чате давнее, или он не писал вовсе
  if (filters.silentHours) {
    where.push(sql`(last_client_at is null or last_client_at <= ${hoursAgo(now, filters.silentHours)}::timestamptz)`);
  }
  const res = await db.execute<{ tg: number | string }>(sql`
    with people as (
      select l.telegram_user_id as tg, min(l.created_at) as first_at from leads l
      where l.telegram_user_id is not null and l.blocked_at is null
        and not exists (select 1 from telegram_blocks b where b.telegram_user_id = l.telegram_user_id)
      group by l.telegram_user_id
    ),
    stats as (
      select p.tg, p.first_at,
        (select max(m.created_at) from messages m join conversations c on c.id = m.conversation_id join leads l on l.id = c.lead_id
         where l.telegram_user_id = p.tg and m.author = 'client') as last_client_at,
        (select m.author from messages m join conversations c on c.id = m.conversation_id join leads l on l.id = c.lead_id
         where l.telegram_user_id = p.tg order by m.created_at desc, m.id desc limit 1) as last_author,
        exists (select 1 from club_quizzes q join leads l on l.id = q.lead_id where l.telegram_user_id = p.tg and q.kind = 'archetype') as did_archetype,
        exists (select 1 from club_quizzes q join leads l on l.id = q.lead_id where l.telegram_user_id = p.tg and q.kind = 'compat') as did_compat,
        exists (select 1 from club_quizzes q join leads l on l.id = q.lead_id where l.telegram_user_id = p.tg and q.kind = 'yesno') as did_yesno,
        exists (select 1 from daily_cards d join leads l on l.id = d.lead_id where l.telegram_user_id = p.tg) as did_card
      from people p
    )
    select tg from (select stats.*, last_client_at is not null as wrote from stats) s
    where ${sql.join(where, sql` and `)}
    order by tg`);
  const rows = (Array.isArray(res) ? res : (res as { rows: { tg: number | string }[] }).rows) as { tg: number | string }[];
  return rows.map((r) => Number(r.tg));
}

/** Сколько получателей у каждого условия — для формы. */
export async function audienceCounts(db: Db): Promise<Record<Audience, number>> {
  const keys = Object.keys(AUDIENCES) as Audience[];
  const lists = await Promise.all(keys.map((a) => broadcastRecipients(db, a)));
  return Object.fromEntries(keys.map((a, i) => [a, lists[i]!.length])) as Record<Audience, number>;
}

export async function listBroadcasts(db: Db, limit = 20): Promise<Broadcast[]> {
  return db.select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(limit);
}

/** Проба: отправить рассылку одному человеку (себе), без записи в историю. */
export async function sendTestBroadcast(db: Db, cfg: TelegramConfig, chatId: number, input: BroadcastInput): Promise<boolean> {
  await ensureBotEmoji(cfg);
  const target = input.personalPage ? (await personalTargets(db, [chatId])).get(chatId) : undefined;
  return sendSeries(cfg, chatId, slotsOf(input), input, target);
}

/** Есть ли у этого Telegram заявка — личной кнопке в пробе нужно куда вести. */
export async function hasLead(db: Db, telegramUserId: number): Promise<boolean> {
  const [row] = await db.select({ id: leads.id }).from(leads).where(eq(leads.telegramUserId, telegramUserId)).limit(1);
  return row !== undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Начать рассылку всем: запись в истории сразу, отправка — в фоне (страница не ждёт). Если сайт перезапустится
 * посреди рассылки, остаток не уйдёт — в истории она останется незаконченной.
 */
export async function startBroadcast(db: Db, cfg: TelegramConfig, input: BroadcastInput): Promise<{ id: number; total: number }> {
  const audience = input.audience ?? "all";
  const recipients = await broadcastRecipients(db, audience, input.filters);
  const list = messagesOf(input);
  const [row] = await db
    .insert(broadcasts)
    .values({
      body: list.find((m) => m.body.trim())?.body.trim() ?? "",
      parts: list.length > 1 || list.some((m) => m.media) ? partsRecord(input) : [],
      registeredHours: input.filters?.registeredHours ?? null,
      silentHours: input.filters?.silentHours ?? null,
      buttonText: input.buttonText.trim(),
      buttonUrl: input.buttonUrl.trim(),
      total: recipients.length,
      audience,
      personalPage: input.personalPage ?? "",
    })
    .returning({ id: broadcasts.id });
  const id = row!.id;
  void runBroadcast(db, cfg, id, recipients, input);
  return { id, total: recipients.length };
}

export async function runBroadcast(db: Db, cfg: TelegramConfig, id: number, recipients: number[], input: BroadcastInput): Promise<void> {
  await ensureBotEmoji(cfg);
  // Слоты общие на всю рассылку: файл грузится первому, дальше — по file_id
  const slots = slotsOf(input);
  const targets = input.personalPage ? await personalTargets(db, recipients) : new Map();
  let sent = 0;
  let failed = 0;
  const save = (finished: boolean) =>
    db
      .update(broadcasts)
      .set({ sent, failed, ...(finished && { finishedAt: new Date() }) })
      .where(sql`${broadcasts.id} = ${id}`);
  try {
    for (let i = 0; i < recipients.length; i++) {
      const tg = recipients[i]!;
      if (await sendSeries(cfg, tg, slots, input, targets.get(tg))) sent++;
      else failed++;
      if ((i + 1) % 25 === 0) await save(false);
      await sleep(1000 / BROADCAST_PER_SECOND);
    }
  } catch (err) {
    console.warn(`Рассылка ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
  await save(true);
}
