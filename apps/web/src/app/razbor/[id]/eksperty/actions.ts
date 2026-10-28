"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { startConversation } from "@/lib/chat";
import { getLead, rememberLead } from "@/lib/leads";

/**
 * Человек выбрал эксперта → чат с ним (уже был — тот же). Первый чат — с подробным разбором,
 * следующие — просто переписка с другим экспертом. return — куда вернуть при ошибке (профиль эксперта).
 */
export async function chooseExpert(form: FormData): Promise<void> {
  const leadId = String(form.get("leadId") ?? "");
  const expertId = Number(form.get("expertId"));
  const db = await getDb();
  const lead = await getLead(db, leadId);
  if (!lead || !Number.isInteger(expertId)) redirect("/");
  const res = await startConversation(db, lead, expertId, new Date());
  if (!res.ok) {
    const back = String(form.get("return") ?? "");
    // Только свои страницы — не открытый редирект
    const base = /^\/ekspert\/\d+\?lead=[0-9a-f-]{36}(&c=[0-9a-f-]{36})?$/i.test(back) ? back : `/razbor/${lead.id}/eksperty`;
    redirect(`${base}${base.includes("?") ? "&" : "?"}error=${encodeURIComponent(res.error)}`);
  }
  // Пришёл по ссылке с другого устройства — запомним заявку и здесь
  await rememberLead(lead.id);
  redirect(`/razbor/${lead.id}/chat?c=${res.conversation.id}`);
}
