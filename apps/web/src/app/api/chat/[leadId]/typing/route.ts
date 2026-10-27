/** Клиент набирает сообщение — эксперт и админ видят «печатает…». ?c=<id чата>, без него — текущий. */
import { getDb } from "@/db";
import { leadConversation } from "@/lib/chat";
import { jsonError, noStore, sameOrigin } from "@/lib/http";
import { getLead } from "@/lib/leads";
import { setTyping } from "@/lib/typing";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/api/chat/[leadId]/typing">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  const db = await getDb();
  const lead = await getLead(db, (await ctx.params).leadId);
  const conversation = lead ? await leadConversation(db, lead.id, new URL(req.url).searchParams.get("c")) : null;
  if (!conversation) return jsonError("Чат не найден", 404);
  setTyping(conversation.id, "client", new Date());
  return new Response(null, { status: 204, headers: noStore });
}
