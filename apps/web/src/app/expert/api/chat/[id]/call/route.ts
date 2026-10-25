/** Звонок для эксперта: позвонить клиенту может любой эксперт, клиент увидит его имя. */
import { getDb } from "@/db";
import { callGet, callPost } from "@/lib/call-http";
import { getConversation } from "@/lib/chat";
import { currentExpert } from "@/lib/expert-auth";
import { jsonError, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/expert/api/chat/[id]/call">) {
  if (!(await currentExpert())) return jsonError("Нужно войти", 401);
  const db = await getDb();
  const conversation = await getConversation(db, (await ctx.params).id);
  if (!conversation) return jsonError("Чат не найден", 404);
  return callGet(req, db, conversation, "staff");
}

export async function POST(req: Request, ctx: RouteContext<"/expert/api/chat/[id]/call">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  const expert = await currentExpert();
  if (!expert) return jsonError("Нужно войти", 401);
  const db = await getDb();
  const conversation = await getConversation(db, (await ctx.params).id);
  if (!conversation) return jsonError("Чат не найден", 404);
  return callPost(req, db, conversation, { side: "staff", caller: "expert", expertId: expert.id });
}
