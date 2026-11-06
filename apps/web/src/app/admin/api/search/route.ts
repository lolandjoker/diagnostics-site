/** Поиск по тексту сообщений — админ и операторы: ?q=<текст>&expert=<id>. */
import { getDb } from "@/db";
import { jsonError, noStore } from "@/lib/http";
import { chatWorker } from "@/lib/operator-auth";
import { expertParam, searchMessages } from "@/lib/staff-inbox";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await chatWorker())) return jsonError("Нужно войти", 401);
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ hits: await searchMessages(await getDb(), q, expertParam(req)) }, { headers: noStore });
}
