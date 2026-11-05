/**
 * «Да или нет»: человек пишет вопрос и тянет одну карту. У каждой карты свой ответ: «Да», «Нет» или
 * «Пока не ясно»; ИИ объясняет ответ применительно к вопросу. Вопросы о здоровье, беременности, смерти и
 * опасности для жизни картами не решаем: такой вопрос (по словам или по оценке ИИ) получает мягкий ответ
 * без «да» и «нет» и совет обратиться к специалисту.
 */
import { randomInt } from "node:crypto";
import type { Db } from "@/db";
import type { Lead } from "./leads";
import { ARCANA } from "./arcana";
import { SAFETY, aiJson, clip } from "./ai-reading";
import { ANSWER_LABEL, QUESTION_MAX, QUESTION_MIN, type YesNo } from "./quiz-yesno-data";
import { type QuizRow, attemptsLeft, parseJson, saveQuiz } from "./quizzes";

export { ANSWER_LABEL, QUESTION_MAX, QUESTION_MIN };
export type { YesNo };


/** Ответ каждой карты (по номеру аркана). */
export const CARD_ANSWER: YesNo[] = [
  "yes", // Шут
  "yes", // Маг
  "maybe", // Жрица
  "yes", // Императрица
  "yes", // Император
  "yes", // Иерофант
  "yes", // Влюблённые
  "yes", // Колесница
  "yes", // Сила
  "no", // Отшельник
  "yes", // Колесо Фортуны
  "maybe", // Справедливость
  "no", // Повешенный
  "no", // Перемены
  "maybe", // Умеренность
  "no", // Искушение
  "no", // Башня
  "yes", // Звезда
  "maybe", // Луна
  "yes", // Солнце
  "yes", // Суд
  "yes", // Мир
];


const SENSITIVE =
  /болезн|болеет|болен|больна|диагноз|онколог|опухол|операци|лечени|выздоров|беремен|забеременею|выкидыш|умр[уеё]|умирает|смерт|погибн|суицид|самоуб|покончить с собой|наркот|сколько (мне )?(осталось )?жить/i;

/** Вопрос о здоровье, жизни, беременности — картами не отвечаем. */
export function isSensitiveQuestion(q: string): boolean {
  return SENSITIVE.test(q);
}

export interface YesNoResult {
  card: number;
  /** null — деликатный вопрос: «да» и «нет» не показываем. */
  answer: YesNo | null;
  text: string;
  advice: string;
  teaser: string;
}

const SENSITIVE_TEXT =
  "На вопросы о здоровье, жизни и беременности карты не отвечают «да» или «нет» — здесь важнее мнение врача или специалиста, к которому вы доверяете. Карта может подсказать другое: как поддержать себя и где искать опору сейчас.";

export function yesNoFallback(card: number, answer: YesNo | null): Omit<YesNoResult, "card" | "answer"> {
  const c = ARCANA[card] ?? ARCANA[0]!;
  if (answer === null) {
    return {
      text: SENSITIVE_TEXT,
      advice: c.tip,
      teaser: "Если вопрос не отпускает, его можно спокойно обсудить с экспертом — без прогнозов, с поддержкой.",
    };
  }
  const head =
    answer === "yes"
      ? `«${c.name}» отвечает «да»: обстоятельства на вашей стороне, если вы сами сделаете шаг навстречу.`
      : answer === "no"
        ? `«${c.name}» отвечает «нет» — по крайней мере, не сейчас и не в таком виде. Это повод присмотреться, а не опустить руки.`
        : `«${c.name}» не даёт однозначного ответа: многое ещё не решено и зависит от того, что вы узнаете в ближайшее время.`;
  return {
    text: `${head} ${c.advice}`,
    advice: c.tip,
    teaser: `Карта отвечает на сам вопрос, но не на то, что за ним стоит. Почему выпала именно «${c.name}» и что изменит ответ — можно разобрать по вашей дате рождения.`,
  };
}

const SYSTEM = `Ты отвечаешь на вопрос человека картой таро в формате «Да или нет» для сервиса Таромба.
Человек задал вопрос и вытянул одну карту из старших арканов. Ответ карты уже определён — объясни его, не меняя.

Поля ответа:
- sensitive — true, если вопрос о здоровье, болезни, беременности, смерти, самоповреждении или опасности для жизни, иначе false.
- text — 2–3 предложения: как карта отвечает на этот вопрос и почему. Если sensitive — не отвечай «да» или «нет», мягко скажи, что на такие вопросы лучше спросить врача или специалиста, и дай поддержку.
- advice — одно короткое конкретное действие, которое поможет в этой ситуации.
- teaser — одно предложение: интересный вопрос, что стоит за ответом карты, который хочется разобрать с экспертом по дате рождения. Не утверждай, что эксперт уже что-то знает, и не обещай событий.

Как писать:
- Ответ «нет» — не приговор: скажи, что можно сделать или чего подождать.
- Если в вопросе есть другой человек, не приписывай ему мыслей и чувств как факт.
${SAFETY}`;

const SCHEMA = {
  type: "object",
  properties: {
    sensitive: { type: "boolean" },
    text: { type: "string" },
    advice: { type: "string" },
    teaser: { type: "string" },
  },
  required: ["sensitive", "text", "advice", "teaser"],
  additionalProperties: false,
} as const;

export function cleanQuestion(raw: string): string | { error: string } {
  const q = raw.trim().replace(/\s+/g, " ");
  if (q.length < QUESTION_MIN) return { error: "Напишите вопрос — хотя бы несколько слов" };
  if (q.length > QUESTION_MAX) return { error: `Вопрос слишком длинный — до ${QUESTION_MAX} символов` };
  return q;
}

/** Задать вопрос и вытянуть карту. */
export async function runYesNo(db: Db, lead: Lead, question: string, now: Date): Promise<QuizRow | { error: string }> {
  if ((await attemptsLeft(db, lead.id, "yesno", now)) <= 0) return { error: "На сегодня вопросы закончились — карты лучше не переспрашивать. Приходите завтра" };
  const card = randomInt(0, ARCANA.length);
  const c = ARCANA[card]!;
  const own = CARD_ANSWER[card]!;
  const ai = await aiJson({
    system: SYSTEM,
    schema: SCHEMA,
    label: "Да или нет",
    prompt: `Имя: ${lead.name}\nВопрос: «${question}»\nКарта: ${c.n} «${c.name}» (смыслы: ${c.keywords}).\nОтвет карты: ${ANSWER_LABEL[own]}.\n\nОбъясни ответ.`,
  });
  const sensitive = isSensitiveQuestion(question) || ai?.data.sensitive === true;
  const answer = sensitive ? null : own;
  const fallback = yesNoFallback(card, answer);
  // Деликатный вопрос, а ИИ его таким не посчитал (сработали слова) — его текст мог ответить «да»/«нет»: берём свой
  const useAi = ai && !(sensitive && ai.data.sensitive !== true);
  const result: YesNoResult = {
    card,
    answer,
    text: (useAi && clip(ai.data.text)) || fallback.text,
    advice: (useAi && clip(ai.data.advice, 200)) || fallback.advice,
    teaser: (useAi && clip(ai.data.teaser, 300)) || fallback.teaser,
  };
  return saveQuiz(db, { leadId: lead.id, kind: "yesno", now, input: { question }, result, model: useAi ? ai.model : null });
}

/** Что показать: вопрос и карта видны всегда, ответ и текст — только с подключённым Telegram. */
export interface YesNoView {
  id: number;
  question: string;
  card: number;
  result: YesNoResult | null;
}

export function yesNoView(row: QuizRow, unlocked: boolean): YesNoView | null {
  const input = parseJson<{ question: string }>(row.input);
  const result = parseJson<YesNoResult>(row.result);
  if (!input || !result) return null;
  return { id: row.id, question: input.question, card: result.card, result: unlocked ? result : null };
}
