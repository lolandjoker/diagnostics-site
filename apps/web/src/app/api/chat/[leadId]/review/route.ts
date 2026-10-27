/** Отзыв клиента об эксперте чата. Доступ — как к чату: по id заявки в адресе. */
import { getDb } from "@/db";
import { leadConversation } from "@/lib/chat";
import { jsonBody, jsonError, noStore, sameOrigin } from "@/lib/http";
import { getLead } from "@/lib/leads";
import { reviewForConversation, saveReview } from "@/lib/reviews";

export const dynamic = "force-dynamic";

/** ?c=<id чата> — какой из чатов заявки; без него — текущий. */
async function load(req: Request, leadId: string) {
  const db = await getDb();
  const lead = await getLead(db, leadId);
  return { db, conversation: lead ? await leadConversation(db, lead.id, new URL(req.url).searchParams.get("c")) : null };
}

export async function GET(req: Request, ctx: RouteContext<"/api/chat/[leadId]/review">) {
  const { db, conversation } = await load(req, (await ctx.params).leadId);
  if (!conversation) return jsonError("Чат не найден", 404);
  const review = await reviewForConversation(db, conversation.id);
  return Response.json({ review: review && { stars: review.stars, body: review.body } }, { headers: noStore });
}

export async function POST(req: Request, ctx: RouteContext<"/api/chat/[leadId]/review">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  const { db, conversation } = await load(req, (await ctx.params).leadId);
  if (!conversation) return jsonError("Чат не найден", 404);
  const data = await jsonBody(req);
  const res = await saveReview(
    db,
    conversation,
    { stars: typeof data?.stars === "number" ? data.stars : 0, body: typeof data?.body === "string" ? data.body : "" },
    new Date(),
  );
  return res.ok ? Response.json(res, { headers: noStore }) : jsonError(res.error, 400);
}
