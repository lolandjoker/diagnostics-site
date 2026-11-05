/**
 * Квизы «Клуба Таромбы»: совместимость пары, тест «Ваш архетип», «Да или нет». Пройти может каждый,
 * а результат человек видит, только когда заявка привязана к Telegram (как расшифровку карты дня).
 * Результат сохраняется сразу; Telegram подключён — уходит и в бот, нет — уйдёт, когда человек подключит.
 * Лимит попыток в день (по Москве) — чтобы не тратить ИИ впустую.
 */
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { clubQuizzes } from "@/db/schema";
import { clubDay } from "./club";

export type QuizKind = "compat" | "archetype" | "yesno";
export type QuizRow = typeof clubQuizzes.$inferSelect;

export const DAILY_LIMIT: Record<QuizKind, number> = { compat: 5, archetype: 3, yesno: 3 };

export const QUIZ_TITLES: Record<QuizKind, string> = {
  compat: "Совместимость пары",
  archetype: "Тест «Ваш архетип»",
  yesno: "Да или нет",
};

export async function attemptsToday(db: Db, leadId: string, kind: QuizKind, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(clubQuizzes)
    .where(and(eq(clubQuizzes.leadId, leadId), eq(clubQuizzes.kind, kind), eq(clubQuizzes.day, clubDay(now))));
  return row?.n ?? 0;
}

export async function attemptsLeft(db: Db, leadId: string, kind: QuizKind, now: Date): Promise<number> {
  return Math.max(0, DAILY_LIMIT[kind] - (await attemptsToday(db, leadId, kind, now)));
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
