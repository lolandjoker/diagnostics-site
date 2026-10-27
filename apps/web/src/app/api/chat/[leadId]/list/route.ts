/** Чаты клиента для списка слева: с кем переписывался, последнее сообщение, непрочитанные. */
import { getDb } from "@/db";
import { clientChats } from "@/lib/chat";
import { jsonError, noStore } from "@/lib/http";
import { getLead } from "@/lib/leads";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/chat/[leadId]/list">) {
  const db = await getDb();
  const lead = await getLead(db, (await ctx.params).leadId);
  if (!lead) return jsonError("Заявка не найдена", 404);
  return Response.json({ items: await clientChats(db, lead.id) }, { headers: noStore });
}
