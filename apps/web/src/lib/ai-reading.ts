/**
 * Тексты «Клуба Таромбы» пишет Claude Opus 5.5: карта дня, совместимость, архетип, «Да или нет».
 * Ответ — строго по схеме (structured outputs). Ключ — ANTHROPIC_API_KEY в .env сервера. Нет ключа, отказ
 * модели или ошибка — null: вызывающий берёт запасные тексты, чтобы человек всё равно получил результат.
 * Отказ классификатора (stop_reason "refusal") Anthropic сам повторяет на запасной модели (fallbacks: "default").
 * В запрос уходят только имена, даты рождения и то, что человек сам написал в квизе, — ни телефона, ни переписки.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Arcana } from "./arcana";

export const READING_MODEL = "claude-opus-5-5";
const MAX_FIELD = 500;

/** Блоки расшифровки карты дня. */
export interface CardSections {
  main: string;
  love: string;
  work: string;
  tip: string;
  teaser: string;
}

/** Общие правила для всех текстов клуба. */
export const SAFETY = `- На «вы», тепло, спокойно и поддерживающе, живым языком, без пафоса и мистического тумана.
- Говори о склонностях и возможностях, а не о гарантированных событиях.
- Не предсказывай болезни, смерть, беременность, несчастья и измены; не давай медицинских, юридических и финансовых указаний; не пугай.
- Если пол человека не ясен из имени, строй фразы так, чтобы они подходили всем.
- Без эмодзи и разметки.`;

const SYSTEM = `Ты пишешь расшифровку «карты дня» для сервиса Таромба (таро, астрология, нумерология).
Человек сам вытянул одну карту из старших арканов; ты объясняешь, что она значит для его сегодняшнего дня.

Поля ответа:
- main — «Главное сегодня»: 2–3 предложения о смысле карты для человека сегодня, один раз обратись по имени.
- love — «В любви»: 1–2 предложения об отношениях и чувствах.
- work — «В делах и деньгах»: 1–2 предложения о работе, делах и деньгах.
- tip — «Совет дня»: одно короткое конкретное действие на сегодня.
- teaser — «Что карта скрывает»: одно-два предложения, которые открывают интересный вопрос — что эта карта в сочетании с личным днём может значить лично для человека в ближайшее время. Вопрос должен вызывать желание разобрать его подробно с экспертом по дате рождения. Не утверждай, что эксперт уже что-то знает или видит, и не обещай конкретных событий.

Как писать:
- Опирайся на смысл карты и на личный день по нумерологии; пиши конкретно, а не общими словами.
${SAFETY}`;

const SCHEMA = {
  type: "object",
  properties: {
    main: { type: "string" },
    love: { type: "string" },
    work: { type: "string" },
    tip: { type: "string" },
    teaser: { type: "string" },
  },
  required: ["main", "love", "work", "tip", "teaser"],
  additionalProperties: false,
} as const;

let client: Anthropic | null | undefined;

function anthropic(): Anthropic | null {
  if (client === undefined) {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    client = key ? new Anthropic({ apiKey: key, timeout: 40_000, maxRetries: 1 }) : null;
  }
  return client;
}

/** Есть ли ключ — тексты пишет ИИ. */
export function readingsByAi(): boolean {
  return anthropic() !== null;
}

/** Строка из ответа ИИ: без пробелов по краям и не длиннее max. */
export const clip = (s: unknown, max = MAX_FIELD) => {
  const t = typeof s === "string" ? s.trim() : "";
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
};

/** ГГГГ-ММ-ДД → ДД.ММ.ГГГГ (для запроса к ИИ). */
export const ruDate = (iso: string) => iso.split("-").reverse().join(".");

/** Запрос к ИИ с ответом строго по JSON-схеме. null — без ключа, отказ, обрыв или ошибка. */
export async function aiJson(opts: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  label: string;
}): Promise<{ data: Record<string, unknown>; model: string } | null> {
  const c = anthropic();
  if (!c) return null;
  try {
    const res = await c.beta.messages.create({
      model: READING_MODEL,
      max_tokens: 6000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: opts.schema } },
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
    const raw = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return { data: data as Record<string, unknown>, model: res.model };
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.warn(`${opts.label} (ИИ): ${err.status ?? ""} ${err.message}`);
    else console.warn(`${opts.label} (ИИ): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface ReadingInput {
  name: string;
  birthDate: string;
  personalDay: number;
  card: Arcana;
}

/** Расшифровка карты дня по блокам от ИИ; null — без ИИ (берите запасные тексты). */
export async function writeReading(input: ReadingInput): Promise<{ sections: CardSections; model: string } | null> {
  const ai = await aiJson({
    system: SYSTEM,
    schema: SCHEMA,
    label: "Карта дня",
    prompt:
      `Имя: ${input.name}\nДата рождения: ${ruDate(input.birthDate)}\nЛичный день по нумерологии: ${input.personalDay}\n` +
      `Карта дня: ${input.card.n} «${input.card.name}» (смыслы: ${input.card.keywords}).\n\nНапиши расшифровку карты дня.`,
  });
  if (!ai) return null;
  const sections: CardSections = {
    main: clip(ai.data.main),
    love: clip(ai.data.love),
    work: clip(ai.data.work),
    tip: clip(ai.data.tip),
    teaser: clip(ai.data.teaser),
  };
  if (!sections.main) return null;
  return { sections, model: ai.model };
}
