/**
 * Рассылки в Telegram-бот из админки — тем, кто подключил бота (заявка привязана к Telegram и не отключена
 * командой /stop): всем или только тем, кто не ответил нам в чате / ни разу не писал (AUDIENCES).
 * Заблокированных клиентов (lib/blocks.ts) в рассылке нет. Отправка идёт в фоне, не быстрее BROADCAST_PER_SECOND сообщений в секунду (лимит Telegram —
 * около 30): страница показывает, сколько ушло. Внизу каждой рассылки — «Отключить сообщения — /stop».
 * Личная кнопка (PERSONAL_PAGES) открывает каждому его собственную страницу внутри Telegram — «Мой день», чат,
 * квиз — по его последней заявке, без ввода имени и даты. Разметка текста: **жирный**. Заблокировавшим бота сообщение не доходит — оно в «не дошло».
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { broadcasts, conversations, leads } from "@/db/schema";
import { em } from "./bot-emoji";
import { PERSONAL_PAGES, type PersonalPage, isPersonalPage } from "./broadcast-pages";
import { type BotButton, type TelegramConfig, ensureBotEmoji, esc, sendMessage } from "./telegram";

export const MAX_BROADCAST_LENGTH = 3500;
export const BROADCAST_PER_SECOND = 20;
/** Чаще раза в сутки — предупреждаем: частые рассылки — частые блокировки бота. */
export const BROADCAST_GAP_MS = 24 * 60 * 60 * 1000;

export type Broadcast = typeof broadcasts.$inferSelect;

export const AUDIENCES = {
  all: "Всем, кто подключил Telegram",
  silent: "Не ответили нам в чате — последнее сообщение наше, клиент молчит",
  never: "Ни разу не написали в чат",
} as const;

export type Audience = keyof typeof AUDIENCES;

export const isAudience = (v: unknown): v is Audience => typeof v === "string" && Object.hasOwn(AUDIENCES, v);

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
}

export function validateBroadcast(input: BroadcastInput): string | null {
  const body = input.body.trim();
  if (body === "") return "Напишите текст рассылки";
  if (body.length > MAX_BROADCAST_LENGTH) return `Текст длиннее ${MAX_BROADCAST_LENGTH} символов`;
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

/** Текст рассылки для Telegram (HTML): **жирный**, значок подарка, внизу — как отключить. */
export function broadcastHtml(input: BroadcastInput): string {
  const body = esc(input.body.replace(/\r\n/g, "\n").trim()).replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  return `${input.gift ? em("gift") : ""}${body}\n\n<i>Отключить сообщения — /stop</i>`;
}

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
 * - never — ни одного своего сообщения ни в одном чате.
 * Заблокированных не берём.
 */
export async function broadcastRecipients(db: Db, audience: Audience = "all"): Promise<number[]> {
  const res = await db.execute<{ tg: number | string }>(sql`
    with people as (
      select distinct l.telegram_user_id as tg from leads l
      where l.telegram_user_id is not null and l.blocked_at is null
        and not exists (select 1 from telegram_blocks b where b.telegram_user_id = l.telegram_user_id)
    ),
    stats as (
      select p.tg,
        exists (select 1 from messages m join conversations c on c.id = m.conversation_id join leads l on l.id = c.lead_id
                where l.telegram_user_id = p.tg and m.author = 'client') as wrote,
        (select m.author from messages m join conversations c on c.id = m.conversation_id join leads l on l.id = c.lead_id
         where l.telegram_user_id = p.tg order by m.created_at desc, m.id desc limit 1) as last_author
      from people p
    )
    select tg from stats
    where ${audience === "silent" ? sql`wrote and last_author <> 'client'` : audience === "never" ? sql`not wrote` : sql`true`}
    order by tg`);
  const rows = (Array.isArray(res) ? res : (res as { rows: { tg: number | string }[] }).rows) as { tg: number | string }[];
  return rows.map((r) => Number(r.tg));
}

/** Сколько получателей у каждого условия — для формы. */
export async function audienceCounts(db: Db): Promise<Record<Audience, number>> {
  const [all, silent, never] = await Promise.all([broadcastRecipients(db, "all"), broadcastRecipients(db, "silent"), broadcastRecipients(db, "never")]);
  return { all: all.length, silent: silent.length, never: never.length };
}

export async function listBroadcasts(db: Db, limit = 20): Promise<Broadcast[]> {
  return db.select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(limit);
}

/** Проба: отправить рассылку одному человеку (себе), без записи в историю. */
export async function sendTestBroadcast(db: Db, cfg: TelegramConfig, chatId: number, input: BroadcastInput): Promise<boolean> {
  await ensureBotEmoji(cfg);
  const target = input.personalPage ? (await personalTargets(db, [chatId])).get(chatId) : undefined;
  return (await sendMessage(cfg, chatId, broadcastHtml(input), buttons(input, cfg.siteUrl, target))) !== null;
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
  const recipients = await broadcastRecipients(db, audience);
  const [row] = await db
    .insert(broadcasts)
    .values({
      body: input.body.trim(),
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
  const html = broadcastHtml(input);
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
      if ((await sendMessage(cfg, tg, html, buttons(input, cfg.siteUrl, targets.get(tg)))) !== null) sent++;
      else failed++;
      if ((i + 1) % 25 === 0) await save(false);
      await sleep(1000 / BROADCAST_PER_SECOND);
    }
  } catch (err) {
    console.warn(`Рассылка ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
  await save(true);
}
