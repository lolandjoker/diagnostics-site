/**
 * Совместимость пары по двум датам рождения. Своя дата — из заявки, вводится только дата партнёра (и имя,
 * по желанию). Знаки зодиака, стихии и числа судьбы считаем сами; из них — общий процент и три шкалы:
 * «Чувства» (стихии), «Быт» (числа судьбы), «Страсть» (расстояние между знаками). Цифры одни и те же для одной пары
 * (в каком порядке ни вводи даты); текст пишет ИИ, без него — заготовки по шкалам.
 */
import { assertValidBirthDate } from "@diag/engine";
import type { Db } from "@/db";
import type { Lead } from "./leads";
import { MIN_AGE, ageOn, birthDateToIso, parseIsoDate } from "./leads";
import { SAFETY, aiJson, clip, ruDate } from "./ai-reading";
import { type QuizRow, nextAttemptAt, lifePath, parseJson, saveQuiz } from "./quizzes";

export const SIGNS = ["Овен", "Телец", "Близнецы", "Рак", "Лев", "Дева", "Весы", "Скорпион", "Стрелец", "Козерог", "Водолей", "Рыбы"];
const ELEMENTS = ["огонь", "земля", "воздух", "вода"] as const;
type Element = (typeof ELEMENTS)[number];

/** Начала знаков (ММДД) по порядку года; раньше 20 января — Козерог. */
const STARTS: [number, number][] = [
  [120, 10],
  [219, 11],
  [321, 0],
  [420, 1],
  [521, 2],
  [621, 3],
  [723, 4],
  [823, 5],
  [923, 6],
  [1023, 7],
  [1122, 8],
  [1222, 9],
];

export function zodiac(birthDate: string): { index: number; name: string; element: Element } {
  const md = Number(birthDate.slice(5, 7)) * 100 + Number(birthDate.slice(8, 10));
  let index = 9;
  for (const [start, i] of STARTS) if (md >= start) index = i;
  return { index, name: SIGNS[index]!, element: ELEMENTS[index % 4]! };
}

export interface CompatScores {
  total: number;
  feelings: number;
  life: number;
  passion: number;
}

const pairKey = (a: Element, b: Element) => [a, b].sort().join("+");
const ELEMENT_SCORE: Record<string, number> = {
  [pairKey("огонь", "огонь")]: 90,
  [pairKey("земля", "земля")]: 88,
  [pairKey("воздух", "воздух")]: 87,
  [pairKey("вода", "вода")]: 91,
  [pairKey("огонь", "воздух")]: 86,
  [pairKey("земля", "вода")]: 89,
  [pairKey("огонь", "земля")]: 68,
  [pairKey("воздух", "вода")]: 70,
  [pairKey("огонь", "вода")]: 63,
  [pairKey("земля", "воздух")]: 64,
};

/** Расстояние между знаками → притяжение: напряжённые аспекты дают больше искры. */
const ASPECT_SCORE = [80, 65, 77, 88, 84, 67, 92];

const GROUPS = [
  [1, 5, 7],
  [2, 4, 8],
  [3, 6, 9],
];
function lifeScore(a: number, b: number): number {
  if (a === b) return 82;
  const ga = GROUPS.findIndex((g) => g.includes(a));
  return ga === GROUPS.findIndex((g) => g.includes(b)) ? 90 : 70;
}

/** Небольшой сдвиг −3…+3 от пары дат, одинаковый при любом порядке ввода — чтобы пары одного знака не совпадали. */
function jitter(a: string, b: string, salt: string): number {
  let h = 7;
  for (const ch of [a, b].sort().join("|") + salt) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return (h % 7) - 3;
}

const clamp = (n: number) => Math.max(52, Math.min(98, Math.round(n)));

export function compatScores(a: string, b: string): CompatScores {
  const za = zodiac(a);
  const zb = zodiac(b);
  const d = Math.abs(za.index - zb.index);
  const feelings = clamp(ELEMENT_SCORE[pairKey(za.element, zb.element)]! + jitter(a, b, "f"));
  const life = clamp(lifeScore(lifePath(a), lifePath(b)) + jitter(a, b, "l"));
  const passion = clamp(ASPECT_SCORE[Math.min(d, 12 - d)]! + jitter(a, b, "p"));
  return { feelings, life, passion, total: clamp(feelings * 0.4 + life * 0.3 + passion * 0.3) };
}

export interface CompatText {
  summary: string;
  feelings: string;
  life: string;
  passion: string;
  teaser: string;
}

export interface CompatResult {
  scores: CompatScores;
  text: CompatText;
}

export interface CompatInput {
  partnerName: string;
  partnerBirth: string;
}

const band = (n: number) => (n >= 85 ? 2 : n >= 72 ? 1 : 0);

const FALLBACK = {
  feelings: [
    "Эмоционально вы устроены по-разному: то, что одному кажется теплом, другой может не заметить. Это решается вниманием и словами.",
    "Чувства есть, но язык заботы у вас разный — говорите вслух, что для каждого значит любовь.",
    "Вы хорошо чувствуете друг друга: многое понятно без слов.",
  ],
  life: [
    "Быт — зона роста: заранее делите обязанности и обсуждайте деньги, чтобы мелочи не копились.",
    "В повседневности придётся договариваться: темп и привычки разные, но это делает пару гибче.",
    "В быту и планах вы легко договариваетесь — общий ритм складывается сам.",
  ],
  passion: [
    "Искра здесь тише, зато больше спокойной нежности; новые впечатления вдвоём её разожгут.",
    "Страсть разгорается постепенно — ей нужны время и общие приключения.",
    "Притяжение сильное: между вами много искры.",
  ],
};

const ELEMENT_LINE: Record<string, string> = {
  [pairKey("огонь", "огонь")]: "два огня — яркая, горячая пара",
  [pairKey("земля", "земля")]: "две земли — надёжная пара, которая строит вдолгую",
  [pairKey("воздух", "воздух")]: "два воздуха — лёгкость, разговоры и общие идеи",
  [pairKey("вода", "вода")]: "две воды — глубокая чувствительная связь",
  [pairKey("огонь", "воздух")]: "огонь и воздух раздувают друг друга — много энергии и вдохновения",
  [pairKey("земля", "вода")]: "земля и вода — забота и опора друг для друга",
  [pairKey("огонь", "земля")]: "огонь и земля — порыв и опора, которым важно найти общий темп",
  [pairKey("воздух", "вода")]: "воздух и вода — ум и чувства, которые учатся понимать друг друга",
  [pairKey("огонь", "вода")]: "огонь и вода — сильное притяжение противоположностей",
  [pairKey("земля", "воздух")]: "земля и воздух — практичность и свобода, которые дополняют друг друга",
};

export function compatFallback(a: string, b: string, scores: CompatScores): CompatText {
  const za = zodiac(a);
  const zb = zodiac(b);
  return {
    summary: `${za.name} и ${zb.name}: ${ELEMENT_LINE[pairKey(za.element, zb.element)]}. Совместимость ${scores.total}% — ${
      scores.total >= 85 ? "очень гармоничная пара" : scores.total >= 72 ? "хорошая пара, где многое зависит от вас двоих" : "пара, в которой есть над чем работать вместе"
    }.`,
    feelings: FALLBACK.feelings[band(scores.feelings)]!,
    life: FALLBACK.life[band(scores.life)]!,
    passion: FALLBACK.passion[band(scores.passion)]!,
    teaser: `Проценты показывают общую картину. Что именно сближает вашу пару, где могут быть трудности и как их пройти — это видно только по двум полным датам рождения.`,
  };
}

const SYSTEM = `Ты пишешь разбор совместимости пары для сервиса Таромба (астрология, нумерология, таро).
Тебе дают имена, даты рождения, знаки зодиака, стихии, числа судьбы и уже посчитанные проценты. Проценты не меняй и не пересчитывай.

Поля ответа:
- summary — 2–3 предложения: общая картина пары, опираясь на знаки, стихии и числа. Обращайся к человеку на «вы», партнёра называй по имени, если оно есть.
- feelings — «Чувства»: 1–2 предложения.
- life — «Быт»: 1–2 предложения о повседневности, планах, деньгах.
- passion — «Страсть»: 1–2 предложения о притяжении, деликатно.
- teaser — 1–2 предложения: интересный открытый вопрос об этой паре, который хочется подробно разобрать с экспертом по двум датам рождения. Не утверждай, что эксперт что-то уже знает, и не обещай событий.

Как писать:
- Не предсказывай расставаний, измен и «несовместимости»: даже низкий процент — это зона роста, а не приговор.
- Не давай советов расставаться или оставаться.
${SAFETY}`;

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    feelings: { type: "string" },
    life: { type: "string" },
    passion: { type: "string" },
    teaser: { type: "string" },
  },
  required: ["summary", "feelings", "life", "passion", "teaser"],
  additionalProperties: false,
} as const;

async function compatText(lead: Lead, input: CompatInput, scores: CompatScores): Promise<{ text: CompatText; model: string | null }> {
  const fallback = compatFallback(lead.birthDate, input.partnerBirth, scores);
  const za = zodiac(lead.birthDate);
  const zb = zodiac(input.partnerBirth);
  const ai = await aiJson({
    system: SYSTEM,
    schema: SCHEMA,
    label: "Совместимость",
    prompt:
      `Человек: ${lead.name}, ${ruDate(lead.birthDate)}, ${za.name} (${za.element}), число судьбы ${lifePath(lead.birthDate)}.\n` +
      `Партнёр: ${input.partnerName || "имя не указано"}, ${ruDate(input.partnerBirth)}, ${zb.name} (${zb.element}), число судьбы ${lifePath(input.partnerBirth)}.\n` +
      `Совместимость: общая ${scores.total}%, чувства ${scores.feelings}%, быт ${scores.life}%, страсть ${scores.passion}%.\n\nНапиши разбор совместимости.`,
  });
  if (!ai) return { text: fallback, model: null };
  const text: CompatText = {
    summary: clip(ai.data.summary) || fallback.summary,
    feelings: clip(ai.data.feelings) || fallback.feelings,
    life: clip(ai.data.life) || fallback.life,
    passion: clip(ai.data.passion) || fallback.passion,
    teaser: clip(ai.data.teaser) || fallback.teaser,
  };
  return { text, model: ai.model };
}

export const PARTNER_NAME_MAX = 40;

/** Проверка ввода: дата партнёра (ДД.ММ.ГГГГ), имя по желанию. Ошибка — текст для человека. */
export function parseCompatInput(nameRaw: string, birthRaw: string, now: Date): CompatInput | { error: string } {
  const partnerName = nameRaw.trim().replace(/\s+/g, " ").slice(0, PARTNER_NAME_MAX);
  const iso = birthDateToIso(birthRaw);
  if (!iso) return { error: "Укажите дату рождения партнёра в формате ДД.ММ.ГГГГ" };
  try {
    assertValidBirthDate(parseIsoDate(iso));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Неверная дата рождения" };
  }
  if (ageOn(iso, now) < MIN_AGE) return { error: `Совместимость считаем для партнёров старше ${MIN_AGE} лет` };
  return { partnerName, partnerBirth: iso };
}

/** Посчитать и сохранить совместимость. */
export async function runCompat(db: Db, lead: Lead, input: CompatInput, now: Date): Promise<QuizRow | { error: string }> {
  if (await nextAttemptAt(db, lead.id, "compat", now)) return { error: "Новую совместимость можно посчитать раз в 5 дней — а подробно разобрать пару можно с экспертом" };
  const scores = compatScores(lead.birthDate, input.partnerBirth);
  const { text, model } = await compatText(lead, input, scores);
  const result: CompatResult = { scores, text };
  return saveQuiz(db, { leadId: lead.id, kind: "compat", now, input, result, model });
}

/** Что показать: знаки и числа видны всегда; проценты и текст — только с подключённым Telegram. */
export interface CompatView {
  id: number;
  partnerName: string;
  partnerBirth: string;
  self: { sign: string; num: number };
  partner: { sign: string; num: number };
  result: CompatResult | null;
}

export function compatView(row: QuizRow, birthDate: string, unlocked: boolean): CompatView | null {
  const input = parseJson<CompatInput>(row.input);
  const result = parseJson<CompatResult>(row.result);
  if (!input || !result) return null;
  return {
    id: row.id,
    partnerName: input.partnerName,
    partnerBirth: input.partnerBirth,
    self: { sign: zodiac(birthDate).name, num: lifePath(birthDate) },
    partner: { sign: zodiac(input.partnerBirth).name, num: lifePath(input.partnerBirth) },
    result: unlocked ? result : null,
  };
}
