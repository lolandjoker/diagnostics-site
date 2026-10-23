/**
 * Чат для человека. Доступ — по id заявки в адресе (случайный, его знает только сам человек).
 * GET ?after=<id> — новые сообщения; POST {body} — отправить сообщение.
 */
import { getDb } from "@/db";
import { conversationForLead, deliverDueFullTexts, messageViews, postMessage } from "@/lib/chat";
import { getExpert, isOnline } from "@/lib/experts";
import { afterParam, jsonBody, jsonError, noStore, sameOrigin } from "@/lib/http";
import { getLead } from "@/lib/leads";

export const dynamic = "force-dynamic";

async function load(leadId: string) {
  const db = await getDb();
  const lead = await getLead(db, leadId);
  const conversation = lead ? await conversationForLead(db, lead.id) : null;
  return { db, conversation };
}

export async function GET(req: Request, ctx: RouteContext<"/api/chat/[leadId]">) {
  const { leadId } = await ctx.params;
  const { db, conversation } = await load(leadId);
  if (!conversation) return jsonError("Чат не найден", 404);
  await deliverDueFullTexts(db, new Date(), conversation.id);
  const expert = await getExpert(db, conversation.expertId);
  return Response.json(
    {
      messages: await messageViews(db, conversation, afterParam(req), "client"),
      expertOnline: expert ? isOnline(expert, new Date()) : false,
    },
    { headers: noStore },
  );
}

export async function POST(req: Request, ctx: RouteContext<"/api/chat/[leadId]">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  const { leadId } = await ctx.params;
  const { db, conversation } = await load(leadId);
  if (!conversation) return jsonError("Чат не найден", 404);
  const data = await jsonBody(req);
  const body = typeof data?.body === "string" ? data.body : "";
  const res = await postMessage(db, conversation.id, { author: "client", body });
  if (!res.ok) return jsonError(res.error, 400);
  return Response.json({ id: res.id }, { headers: noStore });
}
