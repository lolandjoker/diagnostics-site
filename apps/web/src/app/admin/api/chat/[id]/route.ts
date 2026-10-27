/** Чат для админа: читать и отвечать в любом чате. Сообщения подписаны «Администратор». */
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { MAX_CHAT_PHOTO_BYTES, deliverDueFullTexts, getConversation, messageViews, postMessage } from "@/lib/chat";
import { afterParam, jsonError, messagePayload, noStore, sameOrigin } from "@/lib/http";
import { clearTyping, isTyping } from "@/lib/typing";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/admin/api/chat/[id]">) {
  if (!(await isAdmin())) return jsonError("Нужно войти", 401);
  const db = await getDb();
  const conversation = await getConversation(db, (await ctx.params).id);
  if (!conversation) return jsonError("Чат не найден", 404);
  await deliverDueFullTexts(db, new Date(), conversation.id);
  return Response.json(
    {
      messages: await messageViews(db, conversation, afterParam(req), "staff"),
      typing: isTyping(conversation.id, "client", new Date()),
    },
    { headers: noStore },
  );
}

export async function POST(req: Request, ctx: RouteContext<"/admin/api/chat/[id]">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  if (!(await isAdmin())) return jsonError("Нужно войти", 401);
  const db = await getDb();
  const conversation = await getConversation(db, (await ctx.params).id);
  if (!conversation) return jsonError("Чат не найден", 404);
  const data = await messagePayload(req, MAX_CHAT_PHOTO_BYTES);
  if (typeof data === "string") return jsonError(data, 400);
  const res = await postMessage(db, conversation.id, { author: "admin", ...data });
  if (!res.ok) return jsonError(res.error, 400);
  clearTyping(conversation.id, "staff");
  return Response.json({ id: res.id }, { headers: noStore });
}
