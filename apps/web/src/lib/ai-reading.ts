/**
 * Расшифровки «Клуба Таромбы» пишет Claude Opus 5.5 — по имени, дате рождения, личному дню и карте.
 * Ответ — строго по схеме (structured outputs): блоки «Главное сегодня», «В любви», «В делах и деньгах»,
 * «Совет дня» и «Что карта скрывает» — открытый вопрос, который интересно разобрать с экспертом.
 * Ключ — ANTHROPIC_API_KEY в .env сервера. Нет ключа, отказ модели или ошибка — null: вызывающий берёт
 * запасные тексты карты (lib/arcana.ts), чтобы человек всё равно получил расшифровку.
 * Отказ классификатора (stop_reason "refusal") Anthropic сам повторяет на запасной модели (fallbacks: "default").
 * В запрос уходят только имя и дата рождения из заявки — ни телефона, ни переписки.
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

const SYSTEM = `Ты пишешь расшифровку «карты дня» для сервиса Таромба (таро, астрология, нумерология).
Человек сам вытянул одну карту из старших арканов; ты объясняешь, что она значит для его сегодняшнего дня.

Поля ответа:
- main — «Главное сегодня»: 2–3 предложения о смысле карты для человека сегодня, один раз обратись по имени.
- love — «В любви»: 1–2 предложения об отношениях и чувствах.
- work — «В делах и деньгах»: 1–2 предложения о работе, делах и деньгах.
- tip — «Совет дня»: одно короткое конкретное действие на сегодня.
- teaser — «Что карта скрывает»: одно-два предложения, которые открывают интересный вопрос — что эта карта в сочетании с личным днём может значить лично для человека в ближайшее время. Вопрос должен вызывать желание разобрать его подробно с экспертом по дате рождения. Не утверждай, что эксперт уже что-то знает или видит, и не обещай конкретных событий.

Как писать:
- На «вы», тепло, спокойно и поддерживающе, живым языком, без пафоса и мистического тумана.
- Опирайся на смысл карты и на личный день по нумерологии; пиши конкретно, а не общими словами.
- Говори о склонностях и возможностях дня, а не о гарантированных событиях.
- Не предсказывай болезни, смерть, беременность, несчастья и измены; не давай медицинских, юридических и финансовых указаний; не пугай.
- Без эмодзи и разметки.`;

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

/** Есть ли ключ — расшифровки пишет ИИ. */
export function readingsByAi(): boolean {
  return anthropic() !== null;
}

export interface ReadingInput {
  name: string;
  birthDate: string;
  personalDay: number;
  card: Arcana;
}

const clip = (s: unknown) => {
  const t = typeof s === "string" ? s.trim() : "";
  return t.length > MAX_FIELD ? `${t.slice(0, MAX_FIELD).trimEnd()}…` : t;
};

/** Расшифровка карты дня по блокам от ИИ; null — без ИИ (берите запасные тексты). */
export async function writeReading(input: ReadingInput): Promise<{ sections: CardSections; model: string } | null> {
  const c = anthropic();
  if (!c) return null;
  const [y, m, d] = input.birthDate.split("-");
  try {
    const res = await c.beta.messages.create({
      model: READING_MODEL,
      max_tokens: 6000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content:
            `Имя: ${input.name}\nДата рождения: ${d}.${m}.${y}\nЛичный день по нумерологии: ${input.personalDay}\n` +
            `Карта дня: ${input.card.n} «${input.card.name}» (смыслы: ${input.card.keywords}).\n\nНапиши расшифровку карты дня.`,
        },
      ],
    });
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
    const raw = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const sections: CardSections = {
      main: clip(parsed.main),
      love: clip(parsed.love),
      work: clip(parsed.work),
      tip: clip(parsed.tip),
      teaser: clip(parsed.teaser),
    };
    if (!sections.main) return null;
    return { sections, model: res.model };
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.warn(`Расшифровка ИИ: ${err.status ?? ""} ${err.message}`);
    else console.warn(`Расшифровка ИИ: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
