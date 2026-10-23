/**
 * Чат для эксперта. Читать и писать может любой эксперт; сообщение подписано его именем.
 * Прочитанными сообщения отмечаются, только когда чат открывает эксперт этого чата.
 */
import { getDb } from "@/db";
import { deliverDueFullTexts, getConversation, markExpertRead, messageViews, postMessage } from "@/lib/chat";
import { currentExpert } from "@/lib/expert-auth";
import { afterParam, jsonBody, jsonError, noStore, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/expert/api/chat/[id]">) {
  const expert = await currentExpert();
  if (!expert) return jsonError("Нужно войти", 401);
  const db = await getDb();
  const conversation = await getConversation(db, (await ctx.params).id);
  if (!conversation) return jsonError("Чат не найден", 404);
  await deliverDueFullTexts(db, new Date(), conversation.id);
  if (conversation.expertId === expert.id) await markExpertRead(db, conversation.id, new Date());
  return Response.json({ messages: await messageViews(db, conversation, afterParam(req), "staff") }, { headers: noStore });
}

export async function POST(req: Request, ctx: RouteContext<"/expert/api/chat/[id]">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  const expert = await currentExpert();
  if (!expert) return jsonError("Нужно войти", 401);
  const db = await getDb();
  const conversation = await getConversation(db, (await ctx.params).id);
  if (!conversation) return jsonError("Чат не найден", 404);

  const data = await jsonBody(req);
  const productId = typeof data?.productId === "number" && Number.isInteger(data.productId) ? data.productId : undefined;
  const res = await postMessage(db, conversation.id, {
    author: "expert",
    expertId: expert.id,
    body: typeof data?.body === "string" ? data.body : "",
    ...(productId !== undefined && { productId }),
  });
  if (!res.ok) return jsonError(res.error, 400);
  return Response.json({ id: res.id }, { headers: noStore });
}
