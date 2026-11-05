/** Эксперт набирает сообщение — клиент видит «печатает…». */
import { getDb } from "@/db";
import { getConversation } from "@/lib/chat";
import { currentExpert } from "@/lib/expert-auth";
import { jsonError, noStore, sameOrigin } from "@/lib/http";
import { botTyping } from "@/lib/bot-delivery";
import { setTyping } from "@/lib/typing";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/expert/api/chat/[id]/typing">) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  if (!(await currentExpert())) return jsonError("Нужно войти", 401);
  const db = await getDb();
  const conversation = await getConversation(db, (await ctx.params).id);
  if (!conversation) return jsonError("Чат не найден", 404);
  setTyping(conversation.id, "staff", new Date());
  // Клиент в Telegram — «печатает…» и в боте
  void botTyping(db, conversation.id);
  return new Response(null, { status: 204, headers: noStore });
}
