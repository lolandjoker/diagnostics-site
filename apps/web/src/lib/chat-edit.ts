/**
 * Правка и удаление сообщений чата — для админа и операторов чатов.
 * - Удалить можно любое сообщение (спам клиента, лишнее автоматическое); оно пропадает у всех, вместе с фото,
 *   и из Telegram клиента, если ушло туда.
 * - Исправить можно наши сообщения: эксперта (в том числе автоприветствие) и админа/оператора. Клиент видит
 *   новый текст с пометкой «изменено»; в Telegram старое сообщение заменяется исправленным.
 * Сообщения клиента и подробный разбор не правим — только удаляем.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { messagePhotos, messages } from "@/db/schema";
import { deleteFromTelegram, resendEditedToTelegram } from "./bot-delivery";
import { MAX_MESSAGE_LENGTH } from "./chat";

export type EditResult = { ok: true } | { ok: false; error: string; status: number };

async function find(db: Db, conversationId: string, messageId: number) {
  if (!Number.isInteger(messageId) || messageId <= 0) return null;
  const [m] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)));
  return m ?? null;
}

export const canEdit = (author: string) => author === "expert" || author === "admin";

export async function editMessage(db: Db, conversationId: string, messageId: number, raw: string, now = new Date()): Promise<EditResult> {
  const m = await find(db, conversationId, messageId);
  if (!m) return { ok: false, error: "Сообщение не найдено", status: 404 };
  if (!canEdit(m.author)) return { ok: false, error: "Это сообщение можно только удалить", status: 400 };
  const body = raw.trim();
  if (body.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `Сообщение длиннее ${MAX_MESSAGE_LENGTH} символов`, status: 400 };
  if (body === "" && !m.mediaId) {
    const [photo] = await db.select({ id: messagePhotos.messageId }).from(messagePhotos).where(eq(messagePhotos.messageId, m.id));
    if (!photo) return { ok: false, error: "Пустое сообщение — лучше удалите его", status: 400 };
  }
  if (body === m.body.trim()) return { ok: true };
  await db.update(messages).set({ body, editedAt: now }).where(eq(messages.id, m.id));
  void resendEditedToTelegram(db, conversationId, m.id, now).catch((err: unknown) =>
    console.warn(`Правка в Telegram: ${err instanceof Error ? err.message : String(err)}`),
  );
  return { ok: true };
}

export async function deleteMessage(db: Db, conversationId: string, messageId: number): Promise<EditResult> {
  const m = await find(db, conversationId, messageId);
  if (!m) return { ok: false, error: "Сообщение не найдено", status: 404 };
  // Сначала Telegram — пока помним, какие сообщения бота относятся к этому
  await deleteFromTelegram(db, m.id).catch((err: unknown) => console.warn(`Удаление в Telegram: ${err instanceof Error ? err.message : String(err)}`));
  await db.delete(messages).where(eq(messages.id, m.id));
  return { ok: true };
}
