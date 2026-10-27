/**
 * Чат для человека. Доступ — по id заявки в адресе (случайный, его знает только сам человек).
 * ?c=<id чата> — какой из чатов заявки (без него — текущий).
 * GET ?after=<id> — новые сообщения, статус эксперта, «печатает…»; POST {body} или form-data (body, photo) — отправить.
 */
import { getDb } from "@/db";
import {
  MAX_CHAT_PHOTO_BYTES,
  deliverDueFullTexts,
  fullTextTyping,
  leadConversation,
  markClientRead,
  messageViews,
  postMessage,
} from "@/lib/chat";
import { expertStatus, getExpert } from "@/lib/experts";
import { afterParam, jsonError, messagePayload, noStore, sameOrigin } from "@/lib/http";
import { getLead } from "@/lib/leads";
import { clearTyping, isTyping } from "@/lib/typing";
import { variationFor } from "@/lib/variations";

export const dynamic = "force-dynamic";

async function load(req: Request, leadId: string) {
  const db = await getDb();
  const lead = await getLead(db, leadId);
  const conversation = lead ? await leadConversation(db, lead.id, new URL(req.url).searchParams.get("c")) : null;
  return { db, lead, conversation };
}

export async function GET(req: Request, ctx: RouteContext<"/api/chat/[leadId]">) {
  const { db, lead, conversation } = await load(req, (await ctx.params).leadId);
  if (!lead || !conversation) return jsonError("Чат не найден", 404);
  const now = new Date();
  await deliverDueFullTexts(db, now, conversation.id);
  await markClientRead(db, conversation.id, now);
  const expert = await getExpert(db, conversation.expertId);
  // «Печатает…»: эксперт (или админ) набирает текст — или вот-вот придёт подробный разбор
  const typing =
    isTyping(conversation.id, "staff", now) ||
    (fullTextTyping(conversation, now) && !!(await variationFor(db, lead.variationId))?.fullText);
  return Response.json(
    {
      messages: await messageViews(db, conversation, afterParam(req), "client"),
      expertStatus: expert ? expertStatus(expert, now) : "offline",
      typing,
    },
    { headers: noStore },
  );
}

export async function POST(req: Request, ctx: RouteContext<"/api/chat/[leadId]">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  const { db, conversation } = await load(req, (await ctx.params).leadId);
  if (!conversation) return jsonError("Чат не найден", 404);
  const data = await messagePayload(req, MAX_CHAT_PHOTO_BYTES);
  if (typeof data === "string") return jsonError(data, 400);
  const res = await postMessage(db, conversation.id, {
    author: "client",
    body: data.body,
    ...(data.photo && { photo: data.photo }),
  });
  if (!res.ok) return jsonError(res.error, 400);
  clearTyping(conversation.id, "client");
  return Response.json({ id: res.id }, { headers: noStore });
}
