/**
 * Плановые сообщения бота (раз в минуту, из instrumentation.ts) — только клиентам, подключившим Telegram:
 * - напоминание: эксперт ответил (или пришёл подробный разбор), а клиент сутки не открывал чат и не ответил —
 *   одно мягкое напоминание на каждое такое сообщение, не позже чем через двое суток;
 * - просьба оценить эксперта: через полчаса после подробного разбора, один раз на чат и только если отзыва
 *   ещё нет. Оценка — кнопками 1–5, слова — ответом на сообщение (lib/bot-reviews.ts).
 */
import { and, eq, exists, gt, inArray, isNotNull, isNull, lt, lte, ne, notExists, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, experts, leads, messages, reviews } from "@/db/schema";
import { em } from "./bot-emoji";
import { chatContext, enqueue, remember, sendText } from "./bot-delivery";
import { type BotButton, esc, telegramConfig } from "./telegram";

export const REMIND_AFTER_MS = 24 * 60 * 60 * 1000;
/** Совсем старое не вспоминаем — человек, видимо, уже не вернётся, а напоминание пришло бы невпопад. */
export const REMIND_UNTIL_MS = 48 * 60 * 60 * 1000;
export const REVIEW_ASK_AFTER_MS = 30 * 60 * 1000;
export const REVIEW_ASK_UNTIL_MS = 3 * 24 * 60 * 60 * 1000;
const BATCH = 50;

/** Напомнить о непрочитанном ответе эксперта. Возвращает, скольким напомнили. */
export async function remindUnread(db: Db, now: Date): Promise<number> {
  const cfg = telegramConfig();
  if (!cfg) return 0;
  const lastId = sql<number>`(select max(m.id) from ${messages} m where m.conversation_id = ${conversations.id})`;
  const due = await db
    .select({ id: conversations.id, messageId: messages.id, author: messages.author, expertName: experts.name, clientName: leads.name })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .innerJoin(messages, eq(messages.id, lastId))
    .where(
      and(
        isNotNull(leads.telegramUserId),
        isNull(experts.archivedAt),
        inArray(messages.author, ["expert", "admin", "system"]),
        lte(messages.createdAt, new Date(now.getTime() - REMIND_AFTER_MS)),
        gt(messages.createdAt, new Date(now.getTime() - REMIND_UNTIL_MS)),
        or(isNull(conversations.clientReadAt), lt(conversations.clientReadAt, messages.createdAt)),
        or(isNull(conversations.reminderForMessageId), ne(conversations.reminderForMessageId, messages.id)),
      ),
    )
    .limit(BATCH);

  let n = 0;
  for (const d of due) {
    // Отмечаем одним UPDATE — два процесса не напомнят дважды
    const [won] = await db
      .update(conversations)
      .set({ reminderForMessageId: d.messageId })
      .where(
        and(
          eq(conversations.id, d.id),
          or(isNull(conversations.reminderForMessageId), ne(conversations.reminderForMessageId, d.messageId)),
        ),
      )
      .returning({ id: conversations.id });
    if (!won) continue;
    await enqueue(d.id, async () => {
      const ctx = await chatContext(db, cfg, d.id, now, false);
      if (!ctx) return;
      const text =
        d.author === "system"
          ? `${em("bell")}${esc(d.clientName)}, ваш подробный разбор ждёт вас. Если остались вопросы, эксперт <b>${esc(d.expertName)}</b> ответит — напишите прямо сюда.`
          : `${em("bell")}У вас непрочитанный ответ от эксперта <b>${esc(d.expertName)}</b>. Напишите прямо сюда или откройте чат.`;
      const id = await sendText(cfg, ctx.chatId, text, [{ text: "Открыть чат", webApp: ctx.chatUrl, icon: "chat" }]);
      await remember(db, cfg, ctx, id, { expertId: ctx.expertId, withButtons: true, purpose: "reminder" });
      if (id !== null) n++;
    });
  }
  return n;
}

/** Попросить оценить эксперта после подробного разбора. Возвращает, скольких попросили. */
export async function askReviews(db: Db, now: Date): Promise<number> {
  const cfg = telegramConfig();
  if (!cfg) return 0;
  const due = await db
    .select({ id: conversations.id, expertName: experts.name })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .where(
      and(
        isNotNull(leads.telegramUserId),
        isNull(experts.archivedAt),
        isNull(conversations.reviewAskedAt),
        lte(conversations.fullTextSentAt, new Date(now.getTime() - REVIEW_ASK_AFTER_MS)),
        gt(conversations.fullTextSentAt, new Date(now.getTime() - REVIEW_ASK_UNTIL_MS)),
        // Разбор в этот чат действительно пришёл (одна диагностика на человека) и отзыва ещё нет
        exists(
          db
            .select({ id: messages.id })
            .from(messages)
            .where(and(eq(messages.conversationId, conversations.id), eq(messages.author, "system"))),
        ),
        notExists(db.select({ id: reviews.id }).from(reviews).where(eq(reviews.conversationId, conversations.id))),
      ),
    )
    .limit(BATCH);

  let n = 0;
  for (const d of due) {
    const ctx = await chatContext(db, cfg, d.id, now, false);
    // Клиент сейчас на сайте — спросим в следующий раз
    if (!ctx) continue;
    const [won] = await db
      .update(conversations)
      .set({ reviewAskedAt: now })
      .where(and(eq(conversations.id, d.id), isNull(conversations.reviewAskedAt)))
      .returning({ id: conversations.id });
    if (!won) continue;
    await enqueue(d.id, async () => {
      const stars: BotButton[] = [1, 2, 3, 4, 5].map((s) => ({ text: String(s), callback: `rv:${d.id}:${s}`, icon: "star" }));
      const id = await sendText(
        cfg,
        ctx.chatId,
        `${em("star")}Как вам разбор эксперта <b>${esc(d.expertName)}</b>? Поставьте оценку — это поможет другим выбрать эксперта.`,
        [stars],
      );
      await remember(db, cfg, ctx, id, { expertId: ctx.expertId, withButtons: false, purpose: "review" });
      if (id !== null) n++;
    });
  }
  return n;
}

/** Всё плановое разом; ошибки — в лог, следующая попытка через минуту. */
export async function runBotChores(db: Db, now = new Date()): Promise<void> {
  for (const job of [remindUnread, askReviews]) {
    try {
      await job(db, now);
    } catch (err) {
      console.warn(`Бот, плановое: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
