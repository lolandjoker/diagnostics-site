/**
 * Квизы «Клуба Таромбы»: совместимость пары, тест «Ваш архетип», «Да или нет». Пройти может каждый,
 * а результат человек видит, только когда заявка привязана к Telegram (как расшифровку карты дня).
 * Результат сохраняется сразу; Telegram подключён — уходит и в бот, нет — уйдёт, когда человек подключит.
 * Одна попытка раз в N дней (по Москве): совместимость — раз в 5 дней, архетип — раз в 30, «Да или нет» — раз в день.
 * Каждый день — только карта дня; хочется узнать больше раньше — к эксперту.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { clubQuizzes } from "@/db/schema";
import { clubDay } from "./club";

export type QuizKind = "compat" | "archetype" | "yesno";
export type QuizRow = typeof clubQuizzes.$inferSelect;

/** Через сколько дней (по Москве) можно пройти снова. */
export const COOLDOWN_DAYS: Record<QuizKind, number> = { compat: 5, archetype: 30, yesno: 1 };

export const QUIZ_TITLES: Record<QuizKind, string> = {
  compat: "Совместимость пары",
  archetype: "Тест «Ваш архетип»",
  yesno: "Да или нет",
};

const addDays = (day: string, n: number) =>
  new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + n)).toISOString().slice(0, 10);

/** Полночь дня ГГГГ-ММ-ДД по Москве (UTC+3). */
const moscowMidnight = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 3 * 3600_000);

/** Когда можно пройти снова (ISO, полночь по Москве); null — можно сейчас. */
export function nextAttemptFrom(row: { day: string } | null, kind: QuizKind, now: Date): string | null {
  if (!row) return null;
  const day = addDays(row.day, COOLDOWN_DAYS[kind]);
  return clubDay(now) >= day ? null : moscowMidnight(day).toISOString();
}

export async function nextAttemptAt(db: Db, leadId: string, kind: QuizKind, now: Date): Promise<string | null> {
  return nextAttemptFrom(await latestQuiz(db, leadId, kind), kind, now);
}

export async function latestQuiz(db: Db, leadId: string, kind: QuizKind): Promise<QuizRow | null> {
  const [row] = await db
    .select()
    .from(clubQuizzes)
    .where(and(eq(clubQuizzes.leadId, leadId), eq(clubQuizzes.kind, kind)))
    .orderBy(desc(clubQuizzes.createdAt), desc(clubQuizzes.id))
    .limit(1);
  return row ?? null;
}

export async function saveQuiz(
  db: Db,
  v: { leadId: string; kind: QuizKind; now: Date; input: unknown; result: unknown; model: string | null },
): Promise<QuizRow> {
  const [row] = await db
    .insert(clubQuizzes)
    .values({
      leadId: v.leadId,
      kind: v.kind,
      day: clubDay(v.now),
      input: JSON.stringify(v.input),
      result: JSON.stringify(v.result),
      model: v.model,
      createdAt: v.now,
    })
    .returning();
  return row!;
}

/** Последний результат каждого квиза, который ещё не ушёл в бот (старые неотправленные — не шлём, только отмечаем). */
export async function unsentQuizzes(db: Db, leadId: string, now: Date): Promise<QuizRow[]> {
  const rows = await db
    .select()
    .from(clubQuizzes)
    .where(and(eq(clubQuizzes.leadId, leadId), isNull(clubQuizzes.sentAt)))
    .orderBy(desc(clubQuizzes.createdAt), desc(clubQuizzes.id));
  const latest = new Map<string, QuizRow>();
  for (const r of rows) if (!latest.has(r.kind)) latest.set(r.kind, r);
  const keep = new Set([...latest.values()].map((r) => r.id));
  for (const r of rows) if (!keep.has(r.id)) await markQuizSent(db, r.id, now);
  return [...latest.values()];
}

/** Отметить отправку; false — уже отмечено (второй процесс не отправит дважды). */
export async function markQuizSent(db: Db, id: number, now: Date): Promise<boolean> {
  const won = await db
    .update(clubQuizzes)
    .set({ sentAt: now })
    .where(and(eq(clubQuizzes.id, id), isNull(clubQuizzes.sentAt)))
    .returning({ id: clubQuizzes.id });
  return won.length > 0;
}

export function parseJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

const digits = (s: string) => s.replace(/\D/g, "").split("").reduce((a, d) => a + Number(d), 0);

/** Число судьбы (жизненного пути): сумма цифр даты рождения до одной цифры. */
export function lifePath(birthDate: string): number {
  let n = digits(birthDate);
  while (n > 9) n = digits(String(n));
  return n || 9;
}
