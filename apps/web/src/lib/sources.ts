/**
 * Источники трафика. В TikTok нет кликабельной ссылки, поэтому в каждом ролике на экране —
 * свой короткий адрес (taromba.com/karta). Человек набирает его, сайт запоминает источник в cookie
 * (первое касание, навсегда — см. keepSource) и открывает главную; дальше источник попадает в воронку
 * и в заявку (в заявке хранится всегда). Кто открыл просто taromba.com, тому в чате задаём необязательный
 * вопрос «Откуда вы о нас узнали?».
 *
 * Ещё 10 адресов taromba.com/r1 … /r10 — для других площадок; их названия в сводке меняются в «Текстах сайта»
 * → «Источники» (source.r1 …). Новый источник: ключ в SOURCES и папка app/<ключ>/route.ts
 * с `export const GET = sourceEntry("<ключ>")`.
 */
import { and, count, countDistinct, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import type { Db } from "@/db";
import { conversations, funnelEvents, leads, messages } from "@/db/schema";

export const SOURCES = {
  karta: "TikTok · Твоя карта",
  tayna: "TikTok · Необъяснимое",
  r1: "Ссылка 1",
  r2: "Ссылка 2",
  r3: "Ссылка 3",
  r4: "Ссылка 4",
  r5: "Ссылка 5",
  r6: "Ссылка 6",
  r7: "Ссылка 7",
  r8: "Ссылка 8",
  r9: "Ссылка 9",
  r10: "Ссылка 10",
} as const;

export type SourceKey = keyof typeof SOURCES;

export function isSource(s: unknown): s is SourceKey {
  return typeof s === "string" && Object.hasOwn(SOURCES, s);
}

export const SOURCE_COOKIE = "src";
/** «Навсегда»: дольше 400 дней браузеры cookie не хранят, поэтому срок продлевается при каждом заходе (keepSource). */
const SOURCE_COOKIE_DAYS = 400;

function setSourceCookie(jar: Awaited<ReturnType<typeof cookies>>, key: SourceKey): void {
  jar.set(SOURCE_COOKIE, key, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SOURCE_COOKIE_DAYS * 86_400,
  });
}

/**
 * Продлить запомненный источник ещё на SOURCE_COOKIE_DAYS — при каждом шаге воронки (api/track), чтобы
 * у того, кто возвращается на сайт, источник не истекал никогда. Только в обработчиках и server actions.
 */
export async function keepSource(): Promise<SourceKey | null> {
  const jar = await cookies();
  const value = jar.get(SOURCE_COOKIE)?.value;
  if (!isSource(value)) return null;
  setSourceCookie(jar, value);
  return value;
}

/** Источник этого браузера; только на сервере (cookie). */
export async function rememberedSource(): Promise<SourceKey | null> {
  const value = (await cookies()).get(SOURCE_COOKIE)?.value;
  return isSource(value) ? value : null;
}

/**
 * Обработчик короткого адреса: запомнить источник и открыть главную. Уже запомненный источник
 * не меняем — засчитываем ролик, с которого человек пришёл впервые.
 */
export function sourceEntry(key: SourceKey) {
  return async function GET(): Promise<Response> {
    const jar = await cookies();
    const current = jar.get(SOURCE_COOKIE)?.value;
    // Уже запомненный — продлеваем как есть, новый — запоминаем
    setSourceCookie(jar, isSource(current) ? current : key);
    return new Response(null, { status: 307, headers: { Location: "/" } });
  };
}

/** Варианты ответа на «Откуда вы о нас узнали?». */
export const HEARD_FROM = [
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube" },
  { key: "vk", label: "ВКонтакте" },
  { key: "telegram", label: "Telegram" },
  { key: "friends", label: "Посоветовали" },
  { key: "search", label: "Поиск" },
  { key: "other", label: "Другое" },
] as const;

export type HeardFrom = (typeof HEARD_FROM)[number]["key"];

export function isHeardFrom(s: unknown): s is HeardFrom {
  return HEARD_FROM.some((o) => o.key === s);
}

/** Ответ на вопрос сохраняется один раз: повторный ответ не перезаписывает первый. */
export async function setHeardFrom(db: Db, leadId: string, answer: HeardFrom): Promise<boolean> {
  const rows = await db
    .update(leads)
    .set({ heardFrom: answer })
    .where(and(eq(leads.id, leadId), isNull(leads.heardFrom)))
    .returning({ id: leads.id });
  return rows.length > 0;
}

export interface SourceRow {
  /** Ключ источника; null — открыли просто taromba.com (или из Telegram-бота). */
  key: SourceKey | null;
  label: string;
  visitors: number;
  leads: number;
  chats: number;
  wrote: number;
}

/**
 * Воронка по источникам за период (since; null — за всё время). Как в общей воронке: «Открыли главную» —
 * по браузерам, остальное — по заявкам, созданным за период.
 */
export async function sourceStats(db: Db, since: Date | null): Promise<SourceRow[]> {
  const leadsInPeriod = since ? gte(leads.createdAt, since) : undefined;
  const [visitorRows, leadRows, chatRows, wroteRows] = await Promise.all([
    db
      .select({ key: funnelEvents.source, n: countDistinct(funnelEvents.visitorId) })
      .from(funnelEvents)
      .where(and(eq(funnelEvents.step, "home"), since ? gte(funnelEvents.createdAt, since) : undefined))
      .groupBy(funnelEvents.source),
    db.select({ key: leads.source, n: count() }).from(leads).where(leadsInPeriod).groupBy(leads.source),
    db
      .select({ key: leads.source, n: countDistinct(conversations.leadId) })
      .from(conversations)
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .where(leadsInPeriod)
      .groupBy(leads.source),
    db
      .select({ key: leads.source, n: countDistinct(conversations.leadId) })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .where(and(eq(messages.author, "client"), leadsInPeriod))
      .groupBy(leads.source),
  ]);
  const byKey = (rows: { key: string | null; n: number }[]) => new Map(rows.map((r) => [r.key, Number(r.n)]));
  const visitors = byKey(visitorRows);
  const leadCounts = byKey(leadRows);
  const chats = byKey(chatRows);
  const wrote = byKey(wroteRows);
  const keys: (SourceKey | null)[] = [...(Object.keys(SOURCES) as SourceKey[]), null];
  return keys.map((key) => ({
    key,
    label: key ? SOURCES[key] : "По главной ссылке",
    visitors: visitors.get(key) ?? 0,
    leads: leadCounts.get(key) ?? 0,
    chats: chats.get(key) ?? 0,
    wrote: wrote.get(key) ?? 0,
  }));
}

export interface HeardFromRow {
  key: HeardFrom;
  label: string;
  leads: number;
  chats: number;
}

/** Ответы на «Откуда вы о нас узнали?» среди заявок за период и сколько из них начали чат. */
export async function heardFromStats(db: Db, since: Date | null): Promise<HeardFromRow[]> {
  const inPeriod = and(isNotNull(leads.heardFrom), since ? gte(leads.createdAt, since) : undefined);
  const [leadRows, chatRows] = await Promise.all([
    db.select({ key: leads.heardFrom, n: count() }).from(leads).where(inPeriod).groupBy(leads.heardFrom),
    db
      .select({ key: leads.heardFrom, n: countDistinct(conversations.leadId) })
      .from(conversations)
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .where(inPeriod)
      .groupBy(leads.heardFrom),
  ]);
  const leadCounts = new Map(leadRows.map((r) => [r.key, Number(r.n)]));
  const chats = new Map(chatRows.map((r) => [r.key, Number(r.n)]));
  return HEARD_FROM.map((o) => ({ key: o.key, label: o.label, leads: leadCounts.get(o.key) ?? 0, chats: chats.get(o.key) ?? 0 }));
}
