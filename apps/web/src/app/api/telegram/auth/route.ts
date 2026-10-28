/**
 * Вход из приложения в Telegram-боте. POST {initData} — подписанные Telegram данные пользователя.
 * Есть заявка этого пользователя — запоминаем её в cookie и отвечаем, куда перейти (чат или разбор);
 * нет — redirect: null, страница показывает форму.
 */
import { getDb } from "@/db";
import { conversationForLead } from "@/lib/chat";
import { jsonBody, jsonError, noStore, sameOrigin } from "@/lib/http";
import { rememberLead } from "@/lib/leads";
import { leadForTelegramUser, telegramConfig, verifyInitData } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("Запрос не с сайта", 403);
  const cfg = telegramConfig();
  if (!cfg) return jsonError("Telegram не подключён", 404);
  const initData = (await jsonBody(req))?.initData;
  const user = typeof initData === "string" ? verifyInitData(initData, cfg.token, new Date()) : null;
  if (!user) return jsonError("Данные Telegram не прошли проверку", 401);

  const db = await getDb();
  const leadId = await leadForTelegramUser(db, user.id);
  if (!leadId) return Response.json({ redirect: null }, { headers: noStore });
  await rememberLead(leadId);
  const chat = await conversationForLead(db, leadId);
  return Response.json({ redirect: chat ? `/razbor/${leadId}/chat` : `/razbor/${leadId}` }, { headers: noStore });
}
