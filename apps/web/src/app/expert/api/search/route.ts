/** Поиск по тексту сообщений — эксперт: ?q=<текст>&expert=<id>. */
import { getDb } from "@/db";
import { currentExpert } from "@/lib/expert-auth";
import { jsonError, noStore } from "@/lib/http";
import { expertParam, searchMessages } from "@/lib/staff-inbox";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await currentExpert())) return jsonError("Нужно войти", 401);
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ hits: await searchMessages(await getDb(), q, expertParam(req)) }, { headers: noStore });
}
