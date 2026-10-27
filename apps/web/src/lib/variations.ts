/**
 * Варианты диагностики. В варианте два текста, одинаковые для всех — от имени и даты рождения
 * не зависят: текст 1 (страница разбора) и текст 2 (приходит в чат через 3 минуты после того,
 * как человек выбрал эксперта). Новому человеку вариант достаётся случайно или по кругу
 * (settings: variation_mode).
 */
import { randomInt } from "node:crypto";
import { and, asc, count, countDistinct, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { calls, conversations, leads, messages, settings, variationTexts, variations } from "@/db/schema";

export type Variation = typeof variations.$inferSelect;

/**
 * Способ расчёта больше не используется. Столбец variations.method обязательный, поэтому новым
 * вариантам пишем это значение; тексты лежат в variation_texts под значением TEXTS_VALUE.
 * Тексты старых вариантов под другими значениями остаются в базе, но не показываются.
 */
export const NO_METHOD = "none";
const TEXTS_VALUE = 0;

export const VARIATION_MODES = {
  random: "Случайно",
  sequential: "По кругу (поровну)",
} as const;
export type VariationMode = keyof typeof VARIATION_MODES;

const MODE_KEY = "variation_mode";

export async function getVariationMode(db: Db): Promise<VariationMode> {
  const [row] = await db.select().from(settings).where(eq(settings.key, MODE_KEY));
  return row?.value === "sequential" ? "sequential" : "random";
}

export async function setVariationMode(db: Db, mode: VariationMode): Promise<void> {
  await db
    .insert(settings)
    .values({ key: MODE_KEY, value: mode })
    .onConflictDoUpdate({ target: settings.key, set: { value: mode } });
}

/** Вариант для нового человека или null, если активных вариантов нет. */
export async function pickVariation(db: Db): Promise<number | null> {
  const active = await db
    .select({ id: variations.id, leads: count(leads.id) })
    .from(variations)
    .leftJoin(leads, eq(leads.variationId, variations.id))
    .where(and(eq(variations.active, true), isNull(variations.deletedAt)))
    .groupBy(variations.id)
    .orderBy(asc(variations.id));
  if (active.length === 0) return null;
  if ((await getVariationMode(db)) === "sequential") {
    // Тому, у кого меньше всего людей; при равенстве — более раннему
    return active.reduce((min, v) => (v.leads < min.leads ? v : min)).id;
  }
  return (active[randomInt(active.length)] as { id: number }).id;
}

export interface VariationTexts {
  shortText: string;
  fullText: string;
}

/** Тексты варианта: текст 1 — на страницу разбора, текст 2 — в чат. null — варианта нет. */
export async function variationFor(db: Db, variationId: number | null): Promise<VariationTexts | null> {
  if (variationId === null) return null;
  const [texts] = await db
    .select()
    .from(variationTexts)
    .where(and(eq(variationTexts.variationId, variationId), eq(variationTexts.value, TEXTS_VALUE)));
  return { shortText: texts?.shortText ?? "", fullText: texts?.fullText ?? "" };
}

// --- Для админки ---

export function listVariations(db: Db) {
  return db.select().from(variations).where(isNull(variations.deletedAt)).orderBy(asc(variations.id));
}

/** Вариант для админки; удалённый — null. */
export async function getVariation(db: Db, id: number) {
  const [v] = await db
    .select()
    .from(variations)
    .where(and(eq(variations.id, id), isNull(variations.deletedAt)));
  return v ?? null;
}

/**
 * Удаление варианта: новым людям больше не выдаётся, из списка и воронки пропадает.
 * Тем, кому он уже достался, тексты по-прежнему показываются (variationFor не смотрит на удаление).
 */
export async function deleteVariation(db: Db, id: number, now: Date): Promise<boolean> {
  const done = await db
    .update(variations)
    .set({ deletedAt: now, active: false })
    .where(and(eq(variations.id, id), isNull(variations.deletedAt)))
    .returning({ id: variations.id });
  return done.length > 0;
}

export async function getVariationTexts(db: Db, variationId: number): Promise<VariationTexts> {
  return (await variationFor(db, variationId)) ?? { shortText: "", fullText: "" };
}

/** Сохраняет тексты варианта. Оба текста пустые — запись удаляется. */
export async function saveVariationTexts(db: Db, variationId: number, texts: VariationTexts): Promise<void> {
  const shortText = texts.shortText.trim();
  const fullText = texts.fullText.trim();
  const where = and(eq(variationTexts.variationId, variationId), eq(variationTexts.value, TEXTS_VALUE));
  if (shortText === "" && fullText === "") {
    await db.delete(variationTexts).where(where);
    return;
  }
  await db
    .insert(variationTexts)
    .values({ variationId, value: TEXTS_VALUE, shortText, fullText })
    .onConflictDoUpdate({
      target: [variationTexts.variationId, variationTexts.value],
      set: { shortText, fullText, updatedAt: new Date() },
    });
}

export interface VariationStats {
  variationId: number;
  title: string;
  active: boolean;
  /** Получили короткую диагностику (заявки с этим вариантом). */
  leads: number;
  /** Выбрали эксперта и перешли в чат. */
  chats: number;
  /** Написали в чат хотя бы одно сообщение. */
  replied: number;
  /** Поговорили с экспертом по телефону в чате (был принятый звонок). */
  called: number;
}

/** Воронка по каждому варианту: заявка → чат → ответ → звонок. */
export async function variationStats(db: Db): Promise<VariationStats[]> {
  const base = await db
    .select({ id: variations.id, title: variations.title, active: variations.active, leads: count(leads.id) })
    .from(variations)
    .leftJoin(leads, eq(leads.variationId, variations.id))
    .where(isNull(variations.deletedAt))
    .groupBy(variations.id)
    .orderBy(asc(variations.id));

  const chatRows = await db
    .select({
      variationId: leads.variationId,
      // У человека может быть несколько чатов (перевод к другому эксперту) — считаем людей, а не чаты
      chats: countDistinct(conversations.leadId),
      replied: sql<number>`count(distinct ${conversations.leadId}) filter (where ${messages.author} = 'client')`.mapWith(
        Number,
      ),
    })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .groupBy(leads.variationId);

  const callRows = await db
    .select({ variationId: leads.variationId, called: countDistinct(conversations.leadId) })
    .from(calls)
    .innerJoin(conversations, eq(conversations.id, calls.conversationId))
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .where(isNotNull(calls.answeredAt))
    .groupBy(leads.variationId);

  const chats = new Map(chatRows.map((r) => [r.variationId, r]));
  const called = new Map(callRows.map((r) => [r.variationId, r.called]));
  return base.map((v) => ({
    variationId: v.id,
    title: v.title,
    active: v.active,
    leads: v.leads,
    chats: chats.get(v.id)?.chats ?? 0,
    replied: chats.get(v.id)?.replied ?? 0,
    called: called.get(v.id) ?? 0,
  }));
}
