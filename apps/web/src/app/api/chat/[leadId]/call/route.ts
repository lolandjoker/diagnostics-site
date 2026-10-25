/** Звонок для клиента. Доступ — как к чату: по id заявки в адресе. Действия — в lib/call-http.ts. */
import { getDb } from "@/db";
import { callGet, callPost } from "@/lib/call-http";
import { conversationForLead } from "@/lib/chat";
import { jsonError, sameOrigin } from "@/lib/http";
import { getLead } from "@/lib/leads";

export const dynamic = "force-dynamic";

async function load(leadId: string) {
  const db = await getDb();
  const lead = await getLead(db, leadId);
  return { db, conversation: lead ? await conversationForLead(db, lead.id) : null };
}

export async function GET(req: Request, ctx: RouteContext<"/api/chat/[leadId]/call">) {
  const { db, conversation } = await load((await ctx.params).leadId);
  if (!conversation) return jsonError("Чат не найден", 404);
  return callGet(req, db, conversation, "client");
}

export async function POST(req: Request, ctx: RouteContext<"/api/chat/[leadId]/call">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  const { db, conversation } = await load((await ctx.params).leadId);
  if (!conversation) return jsonError("Чат не найден", 404);
  return callPost(req, db, conversation, { side: "client" });
}
