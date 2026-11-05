/**
 * Ответы клиента из Telegram-бота — в чат на сайте. Ответил на сообщение эксперта (свайп «Ответить») —
 * в чат этого сообщения; просто написал — в чат, из которого бот писал последним, а если бот ещё не писал —
 * в текущий чат заявки. Принимаем текст и фото; эксперт видит сообщение как обычное (с пометкой «из Telegram»).
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, experts, leads, messages, telegramMessages } from "@/db/schema";
import { em } from "./bot-emoji";
import { MAX_CHAT_PHOTO_BYTES, postMessage } from "./chat";
import { type TelegramConfig, botCall, esc } from "./telegram";
import { clearTyping } from "./typing";

/** Сообщение из обновления Telegram — только то, что нам нужно. */
export interface IncomingMessage {
  message_id?: unknown;
  chat?: { id?: unknown; type?: unknown };
  from?: { id?: unknown };
  text?: unknown;
  caption?: unknown;
  photo?: unknown;
  reply_to_message?: { message_id?: unknown };
}

export type InboxResult = { handled: false } | { handled: true; reply?: string };

/** Чат на сайте, если он этого пользователя Telegram и эксперт не в архиве. */
async function ownConversation(db: Db, conversationId: string, telegramUserId: number) {
  const [row] = await db
    .select({ id: conversations.id, expertName: experts.name })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .where(and(eq(conversations.id, conversationId), eq(leads.telegramUserId, telegramUserId), isNull(experts.archivedAt)));
  return row ?? null;
}

async function targetConversation(db: Db, chatId: number, telegramUserId: number, replyTo: number | null) {
  if (replyTo !== null) {
    const [row] = await db
      .select({ conversationId: telegramMessages.conversationId })
      .from(telegramMessages)
      .where(and(eq(telegramMessages.chatId, chatId), eq(telegramMessages.messageId, replyTo)));
    const own = row && (await ownConversation(db, row.conversationId, telegramUserId));
    if (own) return own;
  }
  const [last] = await db
    .select({ conversationId: telegramMessages.conversationId })
    .from(telegramMessages)
    .where(eq(telegramMessages.chatId, chatId))
    .orderBy(desc(telegramMessages.createdAt), desc(telegramMessages.messageId))
    .limit(1);
  const own = last && (await ownConversation(db, last.conversationId, telegramUserId));
  if (own) return own;
  // Бот ещё не писал: текущий чат последней заявки этого человека
  const [current] = await db
    .select({ id: conversations.id, expertName: experts.name })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .where(and(eq(leads.telegramUserId, telegramUserId), isNull(experts.archivedAt)))
    .orderBy(desc(leads.createdAt), desc(conversations.lastMessageAt))
    .limit(1);
  return current ?? null;
}

/** Самое большое фото не больше MAX_CHAT_PHOTO_BYTES — скачать у Telegram. */
async function downloadPhoto(cfg: TelegramConfig, sizes: unknown): Promise<Buffer | null> {
  if (!Array.isArray(sizes)) return null;
  const fit = (sizes as { file_id?: unknown; file_size?: unknown }[])
    .filter((p) => typeof p.file_id === "string" && (typeof p.file_size !== "number" || p.file_size <= MAX_CHAT_PHOTO_BYTES))
    .at(-1);
  if (!fit) return null;
  const file = (await botCall(cfg.token, "getFile", { file_id: fit.file_id })) as { file_path?: unknown } | null;
  if (typeof file?.file_path !== "string") return null;
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${cfg.token}/${file.file_path}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    return data.length <= MAX_CHAT_PHOTO_BYTES ? data : null;
  } catch {
    return null;
  }
}

/**
 * Сообщение клиента боту → в чат с экспертом. handled: false — это не ответ эксперту (команда, заявка
 * не привязана или чата ещё нет): что ответить, решает botReply. reply — что написать человеку в ответ.
 */
export async function handleClientMessage(db: Db, cfg: TelegramConfig, msg: IncomingMessage): Promise<InboxResult> {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  if (typeof chatId !== "number" || typeof userId !== "number") return { handled: false };
  const text = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : "";
  if (text.trim().startsWith("/")) return { handled: false };

  const replyTo = typeof msg.reply_to_message?.message_id === "number" ? msg.reply_to_message.message_id : null;
  const conversation = await targetConversation(db, chatId, userId, replyTo);
  if (!conversation) return { handled: false };

  const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
  if (!hasPhoto && text.trim() === "") {
    return { handled: true, reply: "Эксперту можно отправить текст или фото." };
  }
  const photo = hasPhoto ? await downloadPhoto(cfg, msg.photo) : null;
  if (hasPhoto && !photo) return { handled: true, reply: "Не получилось передать фото — попробуйте ещё раз или отправьте его на сайте." };

  // Первое сообщение из бота в этот чат — подтверждаем, что дошло; дальше не мешаем
  const [before] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversation.id), eq(messages.author, "client"), eq(messages.viaTelegram, true)))
    .limit(1);
  const res = await postMessage(db, conversation.id, {
    author: "client",
    body: text,
    viaTelegram: true,
    ...(photo && { photo }),
  });
  if (!res.ok) return { handled: true, reply: esc(res.error) };
  clearTyping(conversation.id, "client");
  return before
    ? { handled: true }
    : { handled: true, reply: `${em("check")}Отправлено эксперту <b>${esc(conversation.expertName)}</b>. Ответ придёт сюда.` };
}
