/**
 * Правка (PATCH { body }) и удаление (DELETE) сообщения чата — админ и операторы чатов (lib/chat-edit.ts).
 * Изменения у собеседника появляются при следующем опросе чата, без перезагрузки.
 */
import { getDb } from "@/db";
import { getConversation } from "@/lib/chat";
import { deleteMessage, editMessage } from "@/lib/chat-edit";
import { jsonError, noStore, sameOrigin } from "@/lib/http";
import { chatWorker } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

async function load(req: Request, ctx: RouteContext<"/admin/api/chat/[id]/messages/[messageId]">) {
  if (!sameOrigin(req)) return { error: jsonError("Запрос не с сайта", 403) };
  if (!(await chatWorker())) return { error: jsonError("Нужно войти", 401) };
  const { id, messageId } = await ctx.params;
  const db = await getDb();
  const conversation = await getConversation(db, id);
  if (!conversation) return { error: jsonError("Чат не найден", 404) };
  return { db, conversation, messageId: Number(messageId) };
}

export async function PATCH(req: Request, ctx: RouteContext<"/admin/api/chat/[id]/messages/[messageId]">) {
  const l = await load(req, ctx);
  if ("error" in l) return l.error;
  const data = (await req.json().catch(() => null)) as { body?: unknown } | null;
  if (typeof data?.body !== "string") return jsonError("Нет текста", 400);
  const res = await editMessage(l.db, l.conversation.id, l.messageId, data.body);
  return res.ok ? Response.json({ ok: true }, { headers: noStore }) : jsonError(res.error, res.status);
}

export async function DELETE(req: Request, ctx: RouteContext<"/admin/api/chat/[id]/messages/[messageId]">) {
  const l = await load(req, ctx);
  if ("error" in l) return l.error;
  const res = await deleteMessage(l.db, l.conversation.id, l.messageId);
  return res.ok ? Response.json({ ok: true }, { headers: noStore }) : jsonError(res.error, res.status);
}
