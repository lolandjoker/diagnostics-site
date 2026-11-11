/** Telegram-бот в «Сводке»: сколько подключили, отвечают ли из бота, что бот отправил сам (за период). */
import { and, count, countDistinct, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { clubQuizzes, conversations, leads, messages, telegramMessages } from "@/db/schema";
import { within } from "./period";

export interface BotStats {
  /** Сейчас подключены (могут получать сообщения и рассылки) — за всё время. */
  subscribers: number;
  /** Заявки за период, привязанные к Telegram (из приложения бота или подключили с сайта). */
  linkedLeads: number;
  /** Сколько человек писали эксперту из бота и сколько сообщений. */
  repliedLeads: number;
  repliedMessages: number;
  /** Что бот отправил сам: напоминания и просьбы оценить эксперта. */
  reminders: number;
  reviewAsks: number;
  /** Квизы клуба за период: сколько раз прошли и сколько человек. */
  quizzes: number;
  quizPeople: number;
  /** Результаты, которые ждут подключения Telegram (за период). */
  quizzesWaiting: number;
}

export async function botStats(db: Db, since: Date | null, until: Date | null = null): Promise<BotStats> {
  const [subscribers, linked, replied, reminders, asks, quizzes, waiting] = await Promise.all([
    db.select({ n: countDistinct(leads.telegramUserId) }).from(leads).where(isNotNull(leads.telegramUserId)),
    db
      .select({ n: count() })
      .from(leads)
      .where(and(isNotNull(leads.telegramUserId), within(leads.createdAt, since, until))),
    db
      .select({ leadsN: countDistinct(conversations.leadId), messagesN: count() })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(messages.viaTelegram, true), within(messages.createdAt, since, until))),
    db
      .select({ n: count() })
      .from(telegramMessages)
      .where(and(eq(telegramMessages.purpose, "reminder"), within(telegramMessages.createdAt, since, until))),
    db
      .select({ n: count() })
      .from(telegramMessages)
      .where(and(eq(telegramMessages.purpose, "review"), within(telegramMessages.createdAt, since, until))),
    db
      .select({ n: count(), people: countDistinct(clubQuizzes.leadId) })
      .from(clubQuizzes)
      .where(within(clubQuizzes.createdAt, since, until)),
    db
      .select({ n: countDistinct(clubQuizzes.leadId) })
      .from(clubQuizzes)
      .where(and(isNull(clubQuizzes.sentAt), within(clubQuizzes.createdAt, since, until))),
  ]);
  return {
    subscribers: Number(subscribers[0]?.n ?? 0),
    linkedLeads: Number(linked[0]?.n ?? 0),
    repliedLeads: Number(replied[0]?.leadsN ?? 0),
    repliedMessages: Number(replied[0]?.messagesN ?? 0),
    reminders: Number(reminders[0]?.n ?? 0),
    reviewAsks: Number(asks[0]?.n ?? 0),
    quizzes: Number(quizzes[0]?.n ?? 0),
    quizPeople: Number(quizzes[0]?.people ?? 0),
    quizzesWaiting: Number(waiting[0]?.n ?? 0),
  };
}
