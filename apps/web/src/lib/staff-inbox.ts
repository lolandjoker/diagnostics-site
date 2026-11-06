/**
 * Список чатов сотрудников — с заботой о сервере (каждый сотрудник опрашивает его раз в 5 секунд):
 * - staffInbox: общий для процесса кеш на INBOX_CACHE_MS по ключу (все чаты / чаты эксперта) — десять открытых
 *   панелей дают один запрос к базе раз в 2 секунды, а не десять;
 * - inboxExperts: эксперты, у которых есть чаты, — для переключателя «Эксперт»;
 * - searchMessages: поиск по тексту сообщений, как в Telegram (от SEARCH_MIN символов, не больше SEARCH_LIMIT
 *   результатов, свежие сверху). На Postgres ускоряется trigram-индексом (миграция 0031), в PGlite — без него.
 */
import { and, count, desc, eq, ilike, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, experts, leads, messages } from "@/db/schema";
import { type InboxItem, deliverDueFullTexts, inbox } from "./chat";

export const INBOX_CACHE_MS = 2000;
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;
export const SEARCH_LIMIT = 50;

const holder = globalThis as unknown as { __diagInbox?: Map<string, { at: number; data: Promise<InboxItem[]> }> };
const cache = (holder.__diagInbox ??= new Map());

/** Чаты для панели: все или одного эксперта; не чаще раза в INBOX_CACHE_MS на ключ. */
export function staffInbox(db: Db, expertId: number | undefined, now = Date.now()): Promise<InboxItem[]> {
  const key = expertId === undefined ? "all" : `e${expertId}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < INBOX_CACHE_MS) return hit.data;
  const data = (async () => {
    await deliverDueFullTexts(db, new Date(now));
    return inbox(db, { expertId });
  })();
  cache.set(key, { at: now, data });
  // Ошибка — не держим её в кеше
  data.catch(() => cache.delete(key));
  if (cache.size > 50) cache.delete(cache.keys().next().value!);
  return data;
}

/** Сбросить кеш (например, после правки или блокировки — чтобы список обновился сразу). */
export function resetInboxCache(): void {
  cache.clear();
}

/** Параметр ?expert=<id> из адреса; нет или не число — все эксперты. */
export function expertParam(req: Request): number | undefined {
  const v = Number(new URL(req.url).searchParams.get("expert"));
  return Number.isInteger(v) && v > 0 ? v : undefined;
}

export interface InboxExpert {
  id: number;
  name: string;
  chats: number;
}

/** Эксперты, у которых есть чаты (для переключателя), — больше чатов выше. */
export async function inboxExperts(db: Db): Promise<InboxExpert[]> {
  const rows = await db
    .select({ id: experts.id, name: experts.name, chats: count(conversations.id) })
    .from(experts)
    .innerJoin(conversations, eq(conversations.expertId, experts.id))
    .where(isNull(experts.deletedAt))
    .groupBy(experts.id, experts.name)
    .orderBy(desc(count(conversations.id)));
  return rows.map((r) => ({ id: r.id, name: r.name, chats: Number(r.chats) }));
}

export interface SearchHit {
  conversationId: string;
  messageId: number;
  leadName: string;
  expertName: string;
  author: string;
  /** Кусок текста вокруг найденного. */
  snippet: string;
  createdAt: string;
}

/** Кусок текста вокруг первого совпадения (~120 символов). */
export function snippetAround(body: string, q: string): string {
  const text = body.replace(/\s+/g, " ").trim();
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 120);
  const start = Math.max(0, i - 40);
  const end = Math.min(text.length, i + q.length + 80);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** Поиск по тексту сообщений (без учёта регистра). expertId — только в чатах этого эксперта. */
export async function searchMessages(db: Db, raw: string, expertId?: number): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, SEARCH_MAX);
  if (q.length < SEARCH_MIN) return [];
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db
    .select({
      conversationId: messages.conversationId,
      messageId: messages.id,
      body: messages.body,
      author: messages.author,
      createdAt: messages.createdAt,
      leadName: leads.name,
      expertName: experts.name,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .where(and(ilike(messages.body, pattern), expertId !== undefined ? eq(conversations.expertId, expertId) : undefined))
    .orderBy(desc(messages.id))
    .limit(SEARCH_LIMIT);
  return rows.map((r) => ({
    conversationId: r.conversationId,
    messageId: r.messageId,
    leadName: r.leadName,
    expertName: r.expertName,
    author: r.author,
    snippet: snippetAround(r.body, q),
    createdAt: r.createdAt.toISOString(),
  }));
}
