/**
 * «Клуб Таромбы» — бесплатные плюшки за подключённый Telegram. Сейчас: карта дня (одна на заявку в день
 * по Москве) и серия дней подряд. Вытянуть карту можно и без Telegram, но расшифровку человек видит,
 * только когда заявка привязана к Telegram (там же она приходит и каждое утро — новая карта).
 */
import { randomInt } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { dailyCards, leads } from "@/db/schema";
import { ARCANA } from "./arcana";
import { writeReading } from "./ai-reading";
import { moscowNow, personalDay } from "./numerology";

export type DailyCard = typeof dailyCards.$inferSelect;

export const CARD_CHOICES = 5;

export function clubDay(now: Date): string {
  return moscowNow(now).date;
}

export async function todayCard(db: Db, leadId: string, now: Date): Promise<DailyCard | null> {
  const [row] = await db
    .select()
    .from(dailyCards)
    .where(and(eq(dailyCards.leadId, leadId), eq(dailyCards.day, clubDay(now))));
  return row ?? null;
}

/**
 * Вытянуть карту дня: position — какая из пяти рубашек (1–5). Уже тянул сегодня — та же карта (не перетянуть).
 * Расшифровку пишет ИИ; не вышло — запасной текст карты. Две вкладки разом не создадут две карты.
 */
export async function drawDailyCard(db: Db, leadId: string, position: number, now: Date): Promise<DailyCard | null> {
  if (!Number.isInteger(position) || position < 1 || position > CARD_CHOICES) return null;
  const existing = await todayCard(db, leadId, now);
  if (existing) return existing;
  const [lead] = await db.select({ name: leads.name, birthDate: leads.birthDate }).from(leads).where(eq(leads.id, leadId));
  if (!lead) return null;
  const day = clubDay(now);
  const card = randomInt(0, ARCANA.length);
  const arcana = ARCANA[card]!;
  const ai = await writeReading({ name: lead.name, birthDate: lead.birthDate, personalDay: personalDay(lead.birthDate, day), card: arcana });
  await db
    .insert(dailyCards)
    .values({ leadId, day, position, card, text: ai?.text ?? arcana.advice, model: ai?.model ?? null })
    .onConflictDoNothing();
  return todayCard(db, leadId, now);
}

const dayNumber = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000);

/** Серия: сколько дней подряд тянули карту — по сегодня (или по вчера, если сегодня ещё не тянули). */
export async function cardStreak(db: Db, leadId: string, now: Date): Promise<number> {
  const rows = await db.select({ day: dailyCards.day }).from(dailyCards).where(eq(dailyCards.leadId, leadId)).orderBy(desc(dailyCards.day)).limit(400);
  const today = dayNumber(clubDay(now));
  const days = new Set(rows.map((r) => dayNumber(r.day)));
  let start = days.has(today) ? today : today - 1;
  let n = 0;
  while (days.has(start)) {
    n++;
    start--;
  }
  return n;
}

/** Последние n дней по сегодня: тянули ли карту (для кружков серии). */
export async function recentDays(db: Db, leadId: string, now: Date, n = 7): Promise<boolean[]> {
  const rows = await db.select({ day: dailyCards.day }).from(dailyCards).where(eq(dailyCards.leadId, leadId)).orderBy(desc(dailyCards.day)).limit(n);
  const days = new Set(rows.map((r) => dayNumber(r.day)));
  const today = dayNumber(clubDay(now));
  return Array.from({ length: n }, (_, i) => days.has(today - (n - 1 - i)));
}

/** «4 дня», «1 день», «5 дней». */
export function daysLabel(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} день`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

/** Что показать человеку: без Telegram текст закрыт — его не отдаём даже в разметку страницы. */
export interface DailyCardView {
  card: number;
  position: number;
  text: string | null;
}

export function cardView(row: DailyCard, unlocked: boolean): DailyCardView {
  return { card: row.card, position: row.position, text: unlocked ? row.text : null };
}
