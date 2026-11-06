/**
 * Блокировка клиента — админ и операторы чатов, из шапки чата.
 * - На сайте: клиент не может писать и начинать чаты (видит «Переписка недоступна»). Заблокированы все его
 *   заявки с тем же Telegram; браузер получает пометку — новая заявка из него тоже создаётся заблокированной.
 * - В Telegram: бот не принимает от него сообщения и нажатия и ничего ему не отправляет (ни ответов, ни карты дня,
 *   ни рассылок) — проверка в самом вызове Bot API (telegram.ts), по списку в памяти процесса.
 * Разблокировать — той же кнопкой.
 */
import { eq, inArray, or } from "drizzle-orm";
import { cookies } from "next/headers";
import type { Db } from "@/db";
import { leads, telegramBlocks } from "@/db/schema";

/** Пометка браузера заблокированного клиента — новые заявки из него сразу в блоке. */
export const BLOCK_COOKIE = "hb";

/** Заблокированные аккаунты Telegram — общие для процесса (вебхук, фоновые задачи и серверные действия). */
const holder = globalThis as unknown as { __diagTgBlocks?: { ids: Set<number>; loadedAt: number } };
const state = (holder.__diagTgBlocks ??= { ids: new Set(), loadedAt: 0 });
const RELOAD_MS = 60_000;

export function isTelegramBlockedCached(chatId: unknown): boolean {
  const id = typeof chatId === "string" ? Number(chatId) : chatId;
  return typeof id === "number" && state.ids.has(id);
}

/** Освежить список из базы (раз в минуту хватает: при блокировке список обновляется сразу). */
export async function loadTelegramBlocks(db: Db, force = false): Promise<void> {
  if (!force && Date.now() - state.loadedAt < RELOAD_MS) return;
  const rows = await db.select({ id: telegramBlocks.telegramUserId }).from(telegramBlocks);
  state.ids = new Set(rows.map((r) => r.id));
  state.loadedAt = Date.now();
}

export async function isTelegramBlocked(db: Db, telegramUserId: number): Promise<boolean> {
  await loadTelegramBlocks(db);
  return state.ids.has(telegramUserId);
}

/** Заявки клиента: эта и все с тем же Telegram. */
async function relatedLeads(db: Db, leadId: string) {
  const [lead] = await db.select({ id: leads.id, tg: leads.telegramUserId }).from(leads).where(eq(leads.id, leadId));
  if (!lead) return null;
  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(lead.tg ? or(eq(leads.id, lead.id), eq(leads.telegramUserId, lead.tg)) : eq(leads.id, lead.id));
  return { ids: rows.map((r) => r.id), tg: lead.tg };
}

export async function blockClient(db: Db, leadId: string, now = new Date()): Promise<boolean> {
  const r = await relatedLeads(db, leadId);
  if (!r) return false;
  await db.update(leads).set({ blockedAt: now }).where(inArray(leads.id, r.ids));
  if (r.tg) {
    await db.insert(telegramBlocks).values({ telegramUserId: r.tg, createdAt: now }).onConflictDoNothing();
    state.ids.add(r.tg);
  }
  return true;
}

export async function unblockClient(db: Db, leadId: string): Promise<boolean> {
  const r = await relatedLeads(db, leadId);
  if (!r) return false;
  await db.update(leads).set({ blockedAt: null }).where(inArray(leads.id, r.ids));
  if (r.tg) {
    await db.delete(telegramBlocks).where(eq(telegramBlocks.telegramUserId, r.tg));
    state.ids.delete(r.tg);
  }
  return true;
}

/** Новая заявка: из заблокированного браузера или Telegram — сразу в блоке. */
export async function inheritBlock(db: Db, leadId: string, telegramUserId: number | null, now = new Date()): Promise<void> {
  const jar = await cookies();
  const fromBrowser = jar.get(BLOCK_COOKIE)?.value === "1";
  const fromTelegram = telegramUserId !== null && (await isTelegramBlocked(db, telegramUserId));
  if (fromBrowser || fromTelegram) await db.update(leads).set({ blockedAt: now }).where(eq(leads.id, leadId));
}

/** Пометить браузер заблокированного клиента (в обработчике запроса или серверном действии). */
export async function markBrowserBlocked(): Promise<void> {
  try {
    (await cookies()).set(BLOCK_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 400 * 24 * 3600 });
  } catch {
    // На странице (не в обработчике) cookie ставить нельзя — пометим при следующем запросе к чату
  }
}
