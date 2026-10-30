/** Админ или оператор набирает сообщение — клиент видит «печатает…» (от эксперта чата). */
import { getDb } from "@/db";
import { chatWorker } from "@/lib/operator-auth";
import { getConversation } from "@/lib/chat";
import { jsonError, noStore, sameOrigin } from "@/lib/http";
import { setTyping } from "@/lib/typing";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/admin/api/chat/[id]/typing">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  if (!(await chatWorker())) return jsonError("Нужно войти", 401);
  const conversation = await getConversation(await getDb(), (await ctx.params).id);
  if (!conversation) return jsonError("Чат не найден", 404);
  setTyping(conversation.id, "staff", new Date());
  return new Response(null, { status: 204, headers: noStore });
}
