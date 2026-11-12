/**
 * Сколько получат рассылку при выбранных «Кому» и условиях — для формы рассылки (только админ):
 * ?audience=<AUDIENCES>&registered=<часы>&silent=<часы>. Пустое или 0 — без условия.
 * kind=chat — рассылка от экспертов: считаем тех, у кого есть подходящий чат (&expert=<id> — с этим экспертом).
 * Системная: count — в Telegram, email — адресов почты (&skip_tg=1 — только тех, кто не подключал Telegram).
 */
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { MAX_FILTER_HOURS, broadcastRecipients, emailRecipients, isAudience } from "@/lib/broadcasts";
import { expertBroadcastTargets } from "@/lib/expert-broadcasts";
import { jsonError, noStore } from "@/lib/http";

export const dynamic = "force-dynamic";

const hours = (v: string | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MAX_FILTER_HOURS ? n : undefined;
};

export async function GET(req: Request) {
  if (!(await isAdmin())) return jsonError("Нужно войти", 401);
  const q = new URL(req.url).searchParams;
  const a = q.get("audience");
  const audience = isAudience(a) ? a : "all";
  const filters = { registeredHours: hours(q.get("registered")), silentHours: hours(q.get("silent")) };
  const db = await getDb();
  if (q.get("kind") === "chat") {
    const expert = Number(q.get("expert"));
    const targets = await expertBroadcastTargets(db, {
      audience,
      filters,
      expertId: Number.isInteger(expert) && expert > 0 ? expert : undefined,
    });
    return Response.json({ count: targets.length }, { headers: noStore });
  }
  const [tg, mail] = await Promise.all([
    broadcastRecipients(db, audience, filters),
    emailRecipients(db, audience, { filters, skipTelegram: q.get("skip_tg") === "1" }),
  ]);
  return Response.json({ count: tg.length, email: mail.length }, { headers: noStore });
}
