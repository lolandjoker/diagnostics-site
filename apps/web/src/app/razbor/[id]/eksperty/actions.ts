"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { conversationForLead, startConversation } from "@/lib/chat";
import { requestExpertChange } from "@/lib/expert-change";
import { getLead, rememberLead } from "@/lib/leads";

/** Человек выбрал эксперта → чат (в него сразу приходит подробный разбор). */
export async function chooseExpert(form: FormData): Promise<void> {
  const leadId = String(form.get("leadId") ?? "");
  const expertId = Number(form.get("expertId"));
  const db = await getDb();
  const lead = await getLead(db, leadId);
  if (!lead || !Number.isInteger(expertId)) redirect("/");
  const res = await startConversation(db, lead, expertId, new Date());
  if (!res.ok) redirect(`/razbor/${lead.id}/eksperty?error=${encodeURIComponent(res.error)}`);
  // Пришёл по ссылке с другого устройства — запомним заявку и здесь
  await rememberLead(lead.id);
  redirect(`/razbor/${lead.id}/chat`);
}

/** Чат уже есть — человек не начинает новый, а оставляет заявку перейти к другому эксперту. */
export async function requestExpertChangeAction(form: FormData): Promise<void> {
  const leadId = String(form.get("leadId") ?? "");
  const expertId = Number(form.get("expertId"));
  const db = await getDb();
  const lead = await getLead(db, leadId);
  if (!lead || !Number.isInteger(expertId)) redirect("/");
  const conversation = await conversationForLead(db, lead.id);
  if (!conversation) redirect(`/razbor/${lead.id}/eksperty`);
  const res = await requestExpertChange(db, conversation, expertId, new Date());
  redirect(`/razbor/${lead.id}/eksperty${res.ok ? "?sent=1" : `?error=${encodeURIComponent(res.error)}`}`);
}
