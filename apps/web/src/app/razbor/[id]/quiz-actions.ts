"use server";

/**
 * Квизы «Клуба Таромбы» со страниц разбора. Доступ — по id заявки (как ко всей странице разбора).
 * Результат сохраняется всегда; на страницу он попадает только с подключённым Telegram, туда же и уходит.
 */
import { after } from "next/server";
import { getDb } from "@/db";
import { deliverQuiz } from "@/lib/bot-quizzes";
import { getLead } from "@/lib/leads";
import { type ArchetypeView, archetypeView, runArchetype } from "@/lib/quiz-archetype";
import { type CompatView, compatView, parseCompatInput, runCompat } from "@/lib/quiz-compat";
import { type YesNoView, cleanQuestion, runYesNo, yesNoView } from "@/lib/quiz-yesno";
import { type QuizRow, nextAttemptAt } from "@/lib/quizzes";
import { telegramLink } from "@/lib/telegram";

type Fail = { error: string };

async function start(leadId: string) {
  const db = await getDb();
  const lead = await getLead(db, String(leadId));
  if (!lead) return null;
  const telegram = await telegramLink(lead);
  return { db, lead, unlocked: !telegram || telegram.connected };
}

function finish(db: Awaited<ReturnType<typeof getDb>>, row: QuizRow) {
  after(() => deliverQuiz(db, row).catch((err: unknown) => console.warn(`Квиз в бот: ${err instanceof Error ? err.message : String(err)}`)));
}

const gone = { error: "Разбор не найден — откройте его заново" };
const failed = { error: "Не получилось — попробуйте ещё раз" };

export async function compatAction(leadId: string, partnerName: string, partnerBirth: string): Promise<{ view: CompatView; next: string | null } | Fail> {
  const s = await start(leadId);
  if (!s) return gone;
  const now = new Date();
  const input = parseCompatInput(String(partnerName ?? ""), String(partnerBirth ?? ""), now);
  if ("error" in input) return input;
  const row = await runCompat(s.db, s.lead, input, now);
  if ("error" in row) return row;
  finish(s.db, row);
  const view = compatView(row, s.lead.birthDate, s.unlocked);
  return view ? { view, next: await nextAttemptAt(s.db, s.lead.id, "compat", now) } : failed;
}

export async function archetypeAction(leadId: string, answers: number[]): Promise<{ view: ArchetypeView; next: string | null } | Fail> {
  const s = await start(leadId);
  if (!s) return gone;
  if (!Array.isArray(answers)) return { error: "Ответьте на все вопросы" };
  const now = new Date();
  const row = await runArchetype(s.db, s.lead, answers.map(Number), now);
  if ("error" in row) return row;
  finish(s.db, row);
  const view = archetypeView(row, s.unlocked);
  return view ? { view, next: await nextAttemptAt(s.db, s.lead.id, "archetype", now) } : failed;
}

export async function yesNoAction(leadId: string, question: string): Promise<{ view: YesNoView; next: string | null } | Fail> {
  const s = await start(leadId);
  if (!s) return gone;
  const q = cleanQuestion(String(question ?? ""));
  if (typeof q !== "string") return q;
  const now = new Date();
  const row = await runYesNo(s.db, s.lead, q, now);
  if ("error" in row) return row;
  finish(s.db, row);
  const view = yesNoView(row, s.unlocked);
  return view ? { view, next: await nextAttemptAt(s.db, s.lead.id, "yesno", now) } : failed;
}

