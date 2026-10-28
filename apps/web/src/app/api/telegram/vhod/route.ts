/**
 * Вход на сайт из бота: кнопка «Открыть на сайте» ведёт сюда с подписанным кодом (loginCode).
 * Код подошёл — запоминаем заявку в cookie и отправляем в чат (или к разбору); нет — на главную.
 */
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { conversationForLead } from "@/lib/chat";
import { getLead, rememberLead } from "@/lib/leads";
import { leadFromLoginCode, telegramConfig } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cfg = telegramConfig();
  const code = new URL(req.url).searchParams.get("t") ?? "";
  const leadId = cfg ? leadFromLoginCode(cfg.token, code, new Date()) : null;
  const db = await getDb();
  const lead = leadId ? await getLead(db, leadId) : null;
  if (!lead) redirect("/");
  await rememberLead(lead.id);
  redirect((await conversationForLead(db, lead.id)) ? `/razbor/${lead.id}/chat` : `/razbor/${lead.id}`);
}
