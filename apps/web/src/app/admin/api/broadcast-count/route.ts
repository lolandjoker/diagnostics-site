/**
 * Сколько человек получат рассылку при выбранных «Кому» и условиях — для формы рассылки (только админ):
 * ?audience=<AUDIENCES>&registered=<часы>&silent=<часы>. Пустое или 0 — без условия.
 */
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { MAX_FILTER_HOURS, broadcastRecipients, isAudience } from "@/lib/broadcasts";
import { jsonError, noStore } from "@/lib/http";

export const dynamic = "force-dynamic";

const hours = (v: string | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MAX_FILTER_HOURS ? n : undefined;
};

export async function GET(req: Request) {
  if (!(await isAdmin())) return jsonError("Нужно войти", 401);
  const q = new URL(req.url).searchParams;
  const audience = q.get("audience");
  const list = await broadcastRecipients(await getDb(), isAudience(audience) ? audience : "all", {
    registeredHours: hours(q.get("registered")),
    silentHours: hours(q.get("silent")),
  });
  return Response.json({ count: list.length }, { headers: noStore });
}
