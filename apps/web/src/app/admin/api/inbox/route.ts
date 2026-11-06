/** Список чатов для админа и операторов: ?expert=<id> — чаты одного эксперта; experts — для переключателя. */
import { getDb } from "@/db";
import { jsonError, noStore } from "@/lib/http";
import { chatWorker } from "@/lib/operator-auth";
import { expertParam, inboxExperts, staffInbox } from "@/lib/staff-inbox";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await chatWorker())) return jsonError("Нужно войти", 401);
  const db = await getDb();
  const [items, experts] = await Promise.all([staffInbox(db, expertParam(req)), inboxExperts(db)]);
  return Response.json({ items, experts }, { headers: noStore });
}
