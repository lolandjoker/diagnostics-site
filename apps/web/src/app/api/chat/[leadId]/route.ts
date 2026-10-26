/**
 * Чат для человека. Доступ — по id заявки в адресе (случайный, его знает только сам человек).
 * GET ?after=<id> — новые сообщения; POST {body} или form-data (body, photo) — отправить сообщение.
 */
import { getDb } from "@/db";
import { MAX_CHAT_PHOTO_BYTES, conversationForLead, deliverDueFullTexts, messageViews, postMessage } from "@/lib/chat";
import { expertStatus, getExpert, isOnline } from "@/lib/experts";
import { afterParam, jsonError, messagePayload, noStore, sameOrigin } from "@/lib/http";
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
      expertStatus: expert ? expertStatus(expert, new Date()) : "offline",
    },
    { headers: noStore },
  );
}

export async function POST(req: Request, ctx: RouteContext<"/api/chat/[leadId]">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  const { leadId } = await ctx.params;
  const { db, conversation } = await load(leadId);
  if (!conversation) return jsonError("Чат не найден", 404);
  const data = await messagePayload(req, MAX_CHAT_PHOTO_BYTES);
  if (typeof data === "string") return jsonError(data, 400);
  // Предлагать продукты клиент не может — productId от него не берём
  const res = await postMessage(db, conversation.id, {
    author: "client",
    body: data.body,
    ...(data.photo && { photo: data.photo }),
  });
  if (!res.ok) return jsonError(res.error, 400);
  return Response.json({ id: res.id }, { headers: noStore });
}
