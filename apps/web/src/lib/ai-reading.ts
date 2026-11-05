/**
 * Расшифровки «Клуба Таромбы» пишет Claude Opus 5.5 — коротко, тепло, по имени, дате рождения и карте.
 * Ключ — ANTHROPIC_API_KEY в .env сервера. Нет ключа, отказ модели или ошибка — null: вызывающий берёт
 * запасной текст карты (lib/arcana.ts), чтобы человек всё равно получил расшифровку.
 * Отказ классификатора (stop_reason "refusal") Anthropic сам повторяет на запасной модели (fallbacks: "default").
 * В запрос уходят только имя и дата рождения из заявки — ни телефона, ни переписки.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Arcana } from "./arcana";

export const READING_MODEL = "claude-opus-5-5";
const MAX_TEXT = 900;

const SYSTEM = `Ты пишешь короткую расшифровку «карты дня» для сервиса Таромба (таро, астрология, нумерология).
Человек сам вытянул одну карту из старших арканов; ты объясняешь, что она значит для его сегодняшнего дня.

Как писать:
- 3–4 предложения, примерно 300–450 знаков. Обращайся на «вы» и один раз по имени.
- Тон тёплый, спокойный и поддерживающий, без пафоса и мистического тумана.
- Опирайся на смысл карты и на личный день по нумерологии; дай один конкретный и выполнимый совет на сегодня.
- Говори о склонностях и возможностях дня, а не о гарантированных событиях.
- Не предсказывай болезни, смерть, беременность, несчастья и измены; не давай медицинских, юридических и финансовых указаний; не пугай.
- Без эмодзи, без разметки, без заголовков и списков. Ответ — только текст расшифровки.`;

let client: Anthropic | null | undefined;

function anthropic(): Anthropic | null {
  if (client === undefined) {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    client = key ? new Anthropic({ apiKey: key, timeout: 30_000, maxRetries: 1 }) : null;
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

/** Расшифровка карты дня от ИИ; null — без ИИ (берите запасной текст). */
export async function writeReading(input: ReadingInput): Promise<{ text: string; model: string } | null> {
  const c = anthropic();
  if (!c) return null;
  const [y, m, d] = input.birthDate.split("-");
  try {
    const res = await c.beta.messages.create({
      model: READING_MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
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
    if (res.stop_reason === "refusal") return null;
    const text = res.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    if (!text) return null;
    return { text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT).trimEnd()}…` : text, model: res.model };
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.warn(`Расшифровка ИИ: ${err.status ?? ""} ${err.message}`);
    else console.warn(`Расшифровка ИИ: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
