/**
 * «Обычно отвечает за …» — сколько эксперт на самом деле отвечает, по его чатам за последние REPLY_WINDOW_DAYS:
 * ожидание — от первого неотвеченного сообщения клиента до ответа эксперта или админа в этом чате
 * (подробный разбор — автоматический, не считается). Медиана — один долгий ответ картину не портит.
 * Ответов меньше MIN_REPLIES — ничего не показываем: судить рано.
 */
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, messages } from "@/db/schema";

export const REPLY_WINDOW_DAYS = 30;
export const MIN_REPLIES = 3;

/** Эксперт → медиана ожидания ответа, секунды (только у тех, у кого ответов хватает). */
export async function replyTimes(db: Db, expertIds: number[], now: Date): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (expertIds.length === 0) return out;
  const rows = await db
    .select({
      expertId: conversations.expertId,
      conversationId: messages.conversationId,
      author: messages.author,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        inArray(conversations.expertId, expertIds),
        inArray(messages.author, ["client", "expert", "admin"]),
        gte(messages.createdAt, new Date(now.getTime() - REPLY_WINDOW_DAYS * 86_400_000)),
      ),
    )
    .orderBy(asc(messages.conversationId), asc(messages.createdAt));

  const waits = new Map<number, number[]>();
  let chat = "";
  let waitingSince: Date | null = null;
  for (const r of rows) {
    if (r.conversationId !== chat) {
      chat = r.conversationId;
      waitingSince = null;
    }
    if (r.author === "client") {
      waitingSince ??= r.createdAt;
    } else if (waitingSince) {
      const list = waits.get(r.expertId) ?? [];
      list.push((r.createdAt.getTime() - waitingSince.getTime()) / 1000);
      waits.set(r.expertId, list);
      waitingSince = null;
    }
  }
  for (const [expertId, list] of waits) {
    if (list.length < MIN_REPLIES) continue;
    const sorted = [...list].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    out.set(expertId, sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return out;
}

/** «обычно отвечает за 5 минут», «… меньше чем за минуту», «… в течение 2 часов». */
export function replyTimeLabel(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 1) return "обычно отвечает меньше чем за минуту";
  if (min < 60) return `обычно отвечает за ${min} ${plural(min, "минуту", "минуты", "минут")}`;
  const h = Math.round(min / 60);
  if (h < 24) return `обычно отвечает в течение ${h} ${plural(h, "часа", "часов", "часов")}`;
  return "обычно отвечает в течение суток";
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
