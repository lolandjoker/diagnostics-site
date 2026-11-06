/** Заблокировать (POST) или разблокировать (DELETE) клиента этого чата — админ и операторы (lib/blocks.ts). */
import { getDb } from "@/db";
import { blockClient, unblockClient } from "@/lib/blocks";
import { getConversation } from "@/lib/chat";
import { jsonError, noStore, sameOrigin } from "@/lib/http";
import { chatWorker } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

async function handle(req: Request, ctx: RouteContext<"/admin/api/chat/[id]/block">, block: boolean): Promise<Response> {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  if (!(await chatWorker())) return jsonError("Нужно войти", 401);
  const db = await getDb();
  const conversation = await getConversation(db, (await ctx.params).id);
  if (!conversation) return jsonError("Чат не найден", 404);
  const ok = block ? await blockClient(db, conversation.leadId) : await unblockClient(db, conversation.leadId);
  return ok ? Response.json({ blocked: block }, { headers: noStore }) : jsonError("Клиент не найден", 404);
}

export const POST = (req: Request, ctx: RouteContext<"/admin/api/chat/[id]/block">) => handle(req, ctx, true);
export const DELETE = (req: Request, ctx: RouteContext<"/admin/api/chat/[id]/block">) => handle(req, ctx, false);
