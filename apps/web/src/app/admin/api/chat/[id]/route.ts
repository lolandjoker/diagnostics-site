/** Чат для админа: читать и отвечать в любом чате. Сообщения подписаны «Администратор». */
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { getConversation, messageViews, postMessage } from "@/lib/chat";
import { afterParam, jsonBody, jsonError, noStore, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/admin/api/chat/[id]">) {
  if (!(await isAdmin())) return jsonError("Нужно войти", 401);
  const db = await getDb();
  const conversation = await getConversation(db, (await ctx.params).id);
  if (!conversation) return jsonError("Чат не найден", 404);
  return Response.json({ messages: await messageViews(db, conversation, afterParam(req), "staff") }, { headers: noStore });
}

export async function POST(req: Request, ctx: RouteContext<"/admin/api/chat/[id]">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  if (!(await isAdmin())) return jsonError("Нужно войти", 401);
  const db = await getDb();
  const conversation = await getConversation(db, (await ctx.params).id);
  if (!conversation) return jsonError("Чат не найден", 404);
  const data = await jsonBody(req);
  const productId = typeof data?.productId === "number" && Number.isInteger(data.productId) ? data.productId : undefined;
  const res = await postMessage(db, conversation.id, {
    author: "admin",
    body: typeof data?.body === "string" ? data.body : "",
    ...(productId !== undefined && { productId }),
  });
  if (!res.ok) return jsonError(res.error, 400);
  return Response.json({ id: res.id }, { headers: noStore });
}
