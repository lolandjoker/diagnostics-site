/** Звонок для админа. Клиент слышит админа как эксперта чата и видит его имя и фото. */
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { callGet, callPost } from "@/lib/call-http";
import { getConversation } from "@/lib/chat";
import { jsonError, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/admin/api/chat/[id]/call">) {
  if (!(await isAdmin())) return jsonError("Нужно войти", 401);
  const db = await getDb();
  const conversation = await getConversation(db, (await ctx.params).id);
  if (!conversation) return jsonError("Чат не найден", 404);
  return callGet(req, db, conversation, "staff");
}

export async function POST(req: Request, ctx: RouteContext<"/admin/api/chat/[id]/call">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  if (!(await isAdmin())) return jsonError("Нужно войти", 401);
  const db = await getDb();
  const conversation = await getConversation(db, (await ctx.params).id);
  if (!conversation) return jsonError("Чат не найден", 404);
  return callPost(req, db, conversation, { side: "staff", caller: "admin" });
}
