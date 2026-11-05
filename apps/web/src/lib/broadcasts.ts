/**
 * Рассылки в Telegram-бот из админки — всем, кто подключил бота (заявка привязана к Telegram и не отключена
 * командой /stop). Отправка идёт в фоне, не быстрее BROADCAST_PER_SECOND сообщений в секунду (лимит Telegram —
 * около 30): страница показывает, сколько ушло. Внизу каждой рассылки — «Отключить сообщения — /stop».
 * Разметка текста: **жирный**. Заблокировавшим бота сообщение не доходит — оно в «не дошло».
 */
import { desc, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { broadcasts, leads } from "@/db/schema";
import { em } from "./bot-emoji";
import { type BotButton, type TelegramConfig, ensureBotEmoji, esc, sendMessage } from "./telegram";

export const MAX_BROADCAST_LENGTH = 3500;
export const BROADCAST_PER_SECOND = 20;
/** Чаще раза в сутки — предупреждаем: частые рассылки — частые блокировки бота. */
export const BROADCAST_GAP_MS = 24 * 60 * 60 * 1000;

export type Broadcast = typeof broadcasts.$inferSelect;

export interface BroadcastInput {
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
  return null;
}

/** Текст рассылки для Telegram (HTML): **жирный**, значок подарка, внизу — как отключить. */
export function broadcastHtml(input: BroadcastInput): string {
  const body = esc(input.body.replace(/\r\n/g, "\n").trim()).replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  return `${input.gift ? em("gift") : ""}${body}\n\n<i>Отключить сообщения — /stop</i>`;
}

function buttons(input: BroadcastInput): BotButton[] {
  return input.buttonText.trim() ? [{ text: input.buttonText.trim(), url: input.buttonUrl.trim() }] : [];
}

/** Кому рассылать: все пользователи Telegram с привязанной заявкой (каждый один раз). */
export async function broadcastRecipients(db: Db): Promise<number[]> {
  const rows = await db.selectDistinct({ id: leads.telegramUserId }).from(leads).where(isNotNull(leads.telegramUserId));
  return rows.map((r) => r.id).filter((id): id is number => id !== null);
}

export async function listBroadcasts(db: Db, limit = 20): Promise<Broadcast[]> {
  return db.select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(limit);
}

/** Проба: отправить рассылку одному человеку (себе), без записи в историю. */
export async function sendTestBroadcast(cfg: TelegramConfig, chatId: number, input: BroadcastInput): Promise<boolean> {
  await ensureBotEmoji(cfg);
  return (await sendMessage(cfg, chatId, broadcastHtml(input), buttons(input))) !== null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Начать рассылку всем: запись в истории сразу, отправка — в фоне (страница не ждёт). Если сайт перезапустится
 * посреди рассылки, остаток не уйдёт — в истории она останется незаконченной.
 */
export async function startBroadcast(db: Db, cfg: TelegramConfig, input: BroadcastInput): Promise<{ id: number; total: number }> {
  const recipients = await broadcastRecipients(db);
  const [row] = await db
    .insert(broadcasts)
    .values({ body: input.body.trim(), buttonText: input.buttonText.trim(), buttonUrl: input.buttonUrl.trim(), total: recipients.length })
    .returning({ id: broadcasts.id });
  const id = row!.id;
  void runBroadcast(db, cfg, id, recipients, input);
  return { id, total: recipients.length };
}

export async function runBroadcast(db: Db, cfg: TelegramConfig, id: number, recipients: number[], input: BroadcastInput): Promise<void> {
  await ensureBotEmoji(cfg);
  const html = broadcastHtml(input);
  const kb = buttons(input);
  let sent = 0;
  let failed = 0;
  const save = (finished: boolean) =>
    db
      .update(broadcasts)
      .set({ sent, failed, ...(finished && { finishedAt: new Date() }) })
      .where(sql`${broadcasts.id} = ${id}`);
  try {
    for (let i = 0; i < recipients.length; i++) {
      if ((await sendMessage(cfg, recipients[i]!, html, kb)) !== null) sent++;
      else failed++;
      if ((i + 1) % 25 === 0) await save(false);
      await sleep(1000 / BROADCAST_PER_SECOND);
    }
  } catch (err) {
    console.warn(`Рассылка ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
  await save(true);
}
