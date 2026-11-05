/**
 * Отзыв об эксперте прямо в боте. Бот просит оценить (lib/bot-chores.ts) — человек жмёт 1–5: оценка сразу
 * сохраняется отзывом к этому чату, как отзыв из чата на сайте (saveReview: один на чат, можно поправить).
 * Слова — ответом на то же сообщение. Отзыв ставит только сам человек: кнопка проверяет, что чат его.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, experts, leads } from "@/db/schema";
import { em } from "./bot-emoji";
import { MAX_REVIEW_LENGTH, reviewForConversation, saveReview } from "./reviews";
import { type TelegramConfig, botApi, esc } from "./telegram";

/** Нажатие кнопки под сообщением бота (callback_query) — только то, что нам нужно. */
export interface IncomingCallback {
  id?: unknown;
  from?: { id?: unknown };
  data?: unknown;
  message?: { message_id?: unknown; chat?: { id?: unknown } };
}

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

/** Чат, если он этого пользователя Telegram. */
async function ownConversation(db: Db, conversationId: string, telegramUserId: number) {
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return null;
  const [row] = await db
    .select({ c: conversations, expertName: experts.name })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .where(and(eq(conversations.id, conversationId), eq(leads.telegramUserId, telegramUserId)));
  return row ?? null;
}

/** Нажали кнопку под сообщением бота. Сейчас кнопки такие одни: оценка эксперта «rv:<чат>:<1–5>». */
export async function handleCallback(db: Db, cfg: TelegramConfig, q: IncomingCallback, now = new Date()): Promise<void> {
  if (typeof q.id !== "string") return;
  const answer = (text: string) => botApi(cfg.token, "answerCallbackQuery", { callback_query_id: q.id, text });
  const m = typeof q.data === "string" ? /^rv:([0-9a-f-]{36}):([1-5])$/.exec(q.data) : null;
  const userId = q.from?.id;
  if (!m || typeof userId !== "number") {
    await answer("Эта кнопка больше не работает");
    return;
  }
  const own = await ownConversation(db, m[1]!, userId);
  if (!own) {
    await answer("Этот чат не найден");
    return;
  }
  const n = Number(m[2]);
  const before = await reviewForConversation(db, own.c.id);
  const saved = await saveReview(db, own.c, { stars: n, body: before?.body ?? "" }, now);
  if (!saved.ok) {
    await answer(saved.error);
    return;
  }
  await answer("Спасибо за оценку!");
  const chatId = q.message?.chat?.id;
  const messageId = q.message?.message_id;
  if (typeof chatId === "number" && typeof messageId === "number") {
    // Без reply_markup кнопки под сообщением пропадают
    await botApi(cfg.token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      text:
        `${em("check")}Спасибо! Ваша оценка эксперту <b>${esc(own.expertName)}</b>: ${stars(n)}\n\n` +
        "Если хотите, напишите пару слов об эксперте — ответом на это сообщение.",
    });
  }
}

/** Ответ на просьбу оценить — текст отзыва. Возвращает, что написать человеку. */
export async function saveReviewText(db: Db, conversationId: string, telegramUserId: number, text: string, now = new Date()): Promise<string> {
  const own = await ownConversation(db, conversationId, telegramUserId);
  if (!own) return "Этот чат не найден.";
  const before = await reviewForConversation(db, own.c.id);
  if (!before) return "Сначала поставьте оценку — кнопками в сообщении выше.";
  const body = text.trim().slice(0, MAX_REVIEW_LENGTH);
  const saved = await saveReview(db, own.c, { stars: before.stars, body }, now);
  return saved.ok ? `${em("check")}Спасибо! Отзыв об эксперте <b>${esc(own.expertName)}</b> сохранён.` : esc(saved.error);
}
