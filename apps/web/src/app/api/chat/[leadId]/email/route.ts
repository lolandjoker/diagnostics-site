/** Клиент указал почту для уведомлений (окно «Подключите Telegram» в чате): { email }. Доступ — как к чату, по id заявки. */
import { getDb } from "@/db";
import { connectEmail } from "@/lib/lead-email";
import { jsonError, noStore, sameOrigin } from "@/lib/http";
import { getLead } from "@/lib/leads";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/api/chat/[leadId]/email">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  const db = await getDb();
  const lead = await getLead(db, (await ctx.params).leadId);
  if (!lead) return jsonError("Заявка не найдена", 404);
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  if (typeof body?.email !== "string") return jsonError("Укажите почту", 400);
  const res = await connectEmail(db, lead.id, body.email, new Date());
  if (!res.ok) return jsonError(res.error, res.status);
  return Response.json({ ok: true, sentNow: res.sentNow }, { headers: noStore });
}
