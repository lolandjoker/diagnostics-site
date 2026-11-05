/** Общее для страниц квизов: заявка, Telegram (открыт ли результат), путь к эксперту, меню. */
import { redirect } from "next/navigation";
import { type Db, getDb } from "@/db";
import { clientChats, conversationForLead } from "@/lib/chat";
import { splitExpertName } from "@/lib/expert-name";
import { getExpert } from "@/lib/experts";
import { type Lead, getLead } from "@/lib/leads";
import { telegramLink } from "@/lib/telegram";

export interface QuizContext {
  db: Db;
  lead: Lead;
  /** Результат открыт: Telegram подключён (или бот выключен). */
  unlocked: boolean;
  /** Ссылка на бота, пока Telegram не подключён. */
  telegramHref: string | null;
  /** Чат с экспертом или выбор эксперта. */
  askHref: string;
  expertName: string | null;
  hasChats: boolean;
  unread: number;
}

export async function quizContext(id: string): Promise<QuizContext> {
  const db = await getDb();
  const lead = await getLead(db, id);
  if (!lead) redirect("/");
  const [telegram, chats, chat] = await Promise.all([telegramLink(lead), clientChats(db, lead.id), conversationForLead(db, lead.id)]);
  const expert = chat ? await getExpert(db, chat.expertId) : null;
  const unlocked = !telegram || telegram.connected;
  return {
    db,
    lead,
    unlocked,
    telegramHref: unlocked ? null : (telegram?.href ?? null),
    askHref: chat ? `/razbor/${lead.id}/chat?c=${chat.id}` : `/razbor/${lead.id}/eksperty`,
    expertName: expert ? splitExpertName(expert.name).name : null,
    hasChats: chats.length > 0,
    unread: chats.reduce((s, c) => s + c.unread, 0),
  };
}
