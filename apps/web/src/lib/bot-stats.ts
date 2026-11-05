/** Telegram-бот в «Сводке»: сколько подключили, отвечают ли из бота, что бот отправил сам (за период). */
import { and, count, countDistinct, eq, gte, isNotNull } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, leads, messages, telegramMessages } from "@/db/schema";

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
}

export async function botStats(db: Db, since: Date | null): Promise<BotStats> {
  const [subscribers, linked, replied, reminders, asks] = await Promise.all([
    db.select({ n: countDistinct(leads.telegramUserId) }).from(leads).where(isNotNull(leads.telegramUserId)),
    db
      .select({ n: count() })
      .from(leads)
      .where(and(isNotNull(leads.telegramUserId), since ? gte(leads.createdAt, since) : undefined)),
    db
      .select({ leadsN: countDistinct(conversations.leadId), messagesN: count() })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(messages.viaTelegram, true), since ? gte(messages.createdAt, since) : undefined)),
    db
      .select({ n: count() })
      .from(telegramMessages)
      .where(and(eq(telegramMessages.purpose, "reminder"), since ? gte(telegramMessages.createdAt, since) : undefined)),
    db
      .select({ n: count() })
      .from(telegramMessages)
      .where(and(eq(telegramMessages.purpose, "review"), since ? gte(telegramMessages.createdAt, since) : undefined)),
  ]);
  return {
    subscribers: Number(subscribers[0]?.n ?? 0),
    linkedLeads: Number(linked[0]?.n ?? 0),
    repliedLeads: Number(replied[0]?.leadsN ?? 0),
    repliedMessages: Number(replied[0]?.messagesN ?? 0),
    reminders: Number(reminders[0]?.n ?? 0),
    reviewAsks: Number(asks[0]?.n ?? 0),
  };
}
