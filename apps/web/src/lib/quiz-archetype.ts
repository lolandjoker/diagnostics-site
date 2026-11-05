/**
 * Тест «Ваш архетип»: пять вопросов, у каждого ответа — свой архетип; побеждает самый частый (ничья —
 * по числу судьбы). Архетипы — карты колоды Таромбы, названия подходят и женщинам, и мужчинам.
 * Описание архетипа написано заранее; «Лично для вас» и вопрос для эксперта пишет ИИ по ответам и дате рождения.
 * Результат — ещё и картинка 9:16 для сторис с адресом taromba.com/arhetip (lib/quiz-images.tsx).
 */
import type { Db } from "@/db";
import type { Lead } from "./leads";
import { SAFETY, aiJson, clip, ruDate } from "./ai-reading";
import { ARCHETYPES, type Archetype, type ArchetypeKey, ORDER, QUESTIONS, type QuizQuestion } from "./quiz-archetype-data";
import { type QuizRow, nextAttemptAt, lifePath, parseJson, saveQuiz } from "./quizzes";

export { ARCHETYPES, QUESTIONS };
export type { Archetype, ArchetypeKey, QuizQuestion };

/** Ответы — номера вариантов (0–3) на каждый вопрос; null — ответы не подходят. */
export function archetypeFor(answers: number[], birthDate: string): ArchetypeKey | null {
  if (answers.length !== QUESTIONS.length) return null;
  const score = new Map<ArchetypeKey, number>();
  for (const [i, a] of answers.entries()) {
    const opt = QUESTIONS[i]!.options[a];
    if (!Number.isInteger(a) || !opt) return null;
    score.set(opt.key, (score.get(opt.key) ?? 0) + 1);
  }
  const best = Math.max(...score.values());
  const tied = ORDER.filter((k) => score.get(k) === best);
  return tied[lifePath(birthDate) % tied.length]!;
}

export interface ArchetypeResult {
  key: ArchetypeKey;
  /** «Лично для вас» */
  personal: string;
  /** Вопрос, который интересно разобрать с экспертом. */
  teaser: string;
}

export function archetypeFallback(key: ArchetypeKey): Omit<ArchetypeResult, "key"> {
  const a = ARCHETYPES[key];
  return {
    personal: a.about,
    teaser: `Архетип ${a.name} проявляется у каждого по-своему. Как он связан с вашей датой рождения и куда ведёт вас в этом году — интересно разобрать подробно.`,
  };
}

const SYSTEM = `Ты пишешь результат теста «Ваш архетип» для сервиса Таромба (таро, астрология, нумерология).
Человек ответил на пять вопросов о себе; архетип уже определён. Опиши его лично для этого человека.

Поля ответа:
- personal — «Лично для вас»: 3–4 предложения, как архетип проявляется именно у этого человека, опираясь на его ответы и число судьбы. Один раз обратись по имени.
- teaser — 1–2 предложения: интересный открытый вопрос о том, как этот архетип связан с датой рождения человека и его ближайшим будущим. Вопрос должен вызывать желание разобрать его с экспертом. Не утверждай, что эксперт уже что-то знает, и не обещай событий.

Как писать:
${SAFETY}`;

const SCHEMA = {
  type: "object",
  properties: { personal: { type: "string" }, teaser: { type: "string" } },
  required: ["personal", "teaser"],
  additionalProperties: false,
} as const;

/** Пройти тест: ответы → архетип, текст, сохранение. */
export async function runArchetype(db: Db, lead: Lead, answers: number[], now: Date): Promise<QuizRow | { error: string }> {
  const key = archetypeFor(answers, lead.birthDate);
  if (!key) return { error: "Ответьте на все вопросы" };
  if (await nextAttemptAt(db, lead.id, "archetype", now)) return { error: "Тест можно проходить раз в 30 дней — а подробно разобрать архетип можно с экспертом" };
  const a = ARCHETYPES[key];
  const fallback = archetypeFallback(key);
  const picked = answers.map((x, i) => `${QUESTIONS[i]!.q} — ${QUESTIONS[i]!.options[x]!.text}`).join("\n");
  const ai = await aiJson({
    system: SYSTEM,
    schema: SCHEMA,
    label: "Архетип",
    prompt:
      `Имя: ${lead.name}\nДата рождения: ${ruDate(lead.birthDate)}, число судьбы ${lifePath(lead.birthDate)}\n` +
      `Архетип: ${a.name} — ${a.tagline} (${a.keywords.join(", ")}). ${a.about}\n\nОтветы:\n${picked}\n\nНапиши результат теста.`,
  });
  const result: ArchetypeResult = {
    key,
    personal: clip(ai?.data.personal) || fallback.personal,
    teaser: clip(ai?.data.teaser) || fallback.teaser,
  };
  return saveQuiz(db, { leadId: lead.id, kind: "archetype", now, input: { answers }, result, model: ai?.model ?? null });
}

/** Что показать: без Telegram — только «архетип готов», без названия. */
export interface ArchetypeView {
  id: number;
  result: (ArchetypeResult & { archetype: Archetype }) | null;
}

export function archetypeView(row: QuizRow, unlocked: boolean): ArchetypeView | null {
  const result = parseJson<ArchetypeResult>(row.result);
  if (!result || !ARCHETYPES[result.key]) return null;
  return { id: row.id, result: unlocked ? { ...result, archetype: ARCHETYPES[result.key] } : null };
}
