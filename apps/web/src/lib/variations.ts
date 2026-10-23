/**
 * Варианты диагностики. В варианте — способ расчёта и для каждого значения короткий текст
 * (страница разбора) и полный (приходит в чат, когда человек выбрал эксперта).
 * Новому человеку вариант достаётся случайно или по кругу (settings: variation_mode).
 */
import { randomInt } from "node:crypto";
import { and, asc, count, countDistinct, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, leads, messages, orders, settings, variationTexts, variations } from "@/db/schema";
import { getMethod } from "./diagnostic";
import type { MethodInput } from "./diagnostic";

export type Variation = typeof variations.$inferSelect;

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
    .where(eq(variations.active, true))
    .groupBy(variations.id)
    .orderBy(asc(variations.id));
  if (active.length === 0) return null;
  if ((await getVariationMode(db)) === "sequential") {
    // Тому, у кого меньше всего людей; при равенстве — более раннему
    return active.reduce((min, v) => (v.leads < min.leads ? v : min)).id;
  }
  return (active[randomInt(active.length)] as { id: number }).id;
}

export interface VariationResult {
  value: number;
  valueLabel: string;
  shortText: string;
  fullText: string;
}

/** Тексты варианта для человека: значение по способу расчёта варианта и тексты для него. */
export async function variationFor(db: Db, variationId: number | null, input: MethodInput): Promise<VariationResult | null> {
  if (variationId === null) return null;
  const [variation] = await db.select().from(variations).where(eq(variations.id, variationId));
  const method = variation && getMethod(variation.method);
  if (!method) return null;
  const value = method.compute(input);
  if (value === null) return null;
  const [texts] = await db
    .select()
    .from(variationTexts)
    .where(and(eq(variationTexts.variationId, variationId), eq(variationTexts.value, value)));
  return {
    value,
    valueLabel: method.valueLabel(value),
    shortText: texts?.shortText ?? "",
    fullText: texts?.fullText ?? "",
  };
}

// --- Для админки ---

export function listVariations(db: Db) {
  return db.select().from(variations).orderBy(asc(variations.id));
}

export async function getVariation(db: Db, id: number) {
  const [v] = await db.select().from(variations).where(eq(variations.id, id));
  return v ?? null;
}

export async function getVariationTexts(db: Db, variationId: number) {
  const rows = await db.select().from(variationTexts).where(eq(variationTexts.variationId, variationId));
  return new Map(rows.map((r) => [r.value, { shortText: r.shortText, fullText: r.fullText }]));
}

/** Сохраняет тексты варианта. Оба текста пустые — запись по значению удаляется. */
export async function saveVariationTexts(
  db: Db,
  variationId: number,
  texts: Map<number, { shortText: string; fullText: string }>,
): Promise<void> {
  for (const [value, t] of texts) {
    const shortText = t.shortText.trim();
    const fullText = t.fullText.trim();
    if (shortText === "" && fullText === "") {
      await db
        .delete(variationTexts)
        .where(and(eq(variationTexts.variationId, variationId), eq(variationTexts.value, value)));
    } else {
      await db
        .insert(variationTexts)
        .values({ variationId, value, shortText, fullText })
        .onConflictDoUpdate({
          target: [variationTexts.variationId, variationTexts.value],
          set: { shortText, fullText, updatedAt: new Date() },
        });
    }
  }
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
  paid: number;
  revenueKopecks: number;
}

/** Воронка по каждому варианту: заявка → чат → ответ → оплата. */
export async function variationStats(db: Db): Promise<VariationStats[]> {
  const base = await db
    .select({ id: variations.id, title: variations.title, active: variations.active, leads: count(leads.id) })
    .from(variations)
    .leftJoin(leads, eq(leads.variationId, variations.id))
    .groupBy(variations.id)
    .orderBy(asc(variations.id));

  const chatRows = await db
    .select({
      variationId: leads.variationId,
      chats: countDistinct(conversations.id),
      replied: sql<number>`count(distinct ${conversations.id}) filter (where ${messages.author} = 'client')`.mapWith(
        Number,
      ),
    })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .groupBy(leads.variationId);

  const paidRows = await db
    .select({
      variationId: leads.variationId,
      paid: count(orders.id),
      revenue: sql<number>`coalesce(sum(${orders.amountKopecks}), 0)`.mapWith(Number),
    })
    .from(orders)
    .innerJoin(leads, eq(leads.id, orders.leadId))
    .where(eq(orders.status, "paid"))
    .groupBy(leads.variationId);

  const chats = new Map(chatRows.map((r) => [r.variationId, r]));
  const paid = new Map(paidRows.map((r) => [r.variationId, r]));
  return base.map((v) => ({
    variationId: v.id,
    title: v.title,
    active: v.active,
    leads: v.leads,
    chats: chats.get(v.id)?.chats ?? 0,
    replied: chats.get(v.id)?.replied ?? 0,
    paid: paid.get(v.id)?.paid ?? 0,
    revenueKopecks: paid.get(v.id)?.revenue ?? 0,
  }));
}
