"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { startConversation } from "@/lib/chat";
import { connectEmail } from "@/lib/lead-email";
import { getLead, rememberLead } from "@/lib/leads";

/**
 * Человек выбрал эксперта → чат с ним (уже был — тот же). Первый чат — с подробным разбором,
 * следующие — просто переписка с другим экспертом. return — куда вернуть при ошибке (профиль эксперта).
 * Почта обязательна: в заявке её нет — берём из формы (окно «Куда прислать разбор?», ExpertChooseForm).
 */
export async function chooseExpert(form: FormData): Promise<void> {
  const leadId = String(form.get("leadId") ?? "");
  const expertId = Number(form.get("expertId"));
  const db = await getDb();
  const lead = await getLead(db, leadId);
  if (!lead || !Number.isInteger(expertId)) redirect("/");
  const back = String(form.get("return") ?? "");
  // Только свои страницы — не открытый редирект
  const base = /^\/ekspert\/\d+\?lead=[0-9a-f-]{36}(&c=[0-9a-f-]{36})?$/i.test(back) ? back : `/razbor/${lead.id}/eksperty`;
  function fail(error: string): never {
    redirect(`${base}${base.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`);
  }
  if (!lead.email) {
    const email = await connectEmail(db, lead.id, String(form.get("email") ?? ""), new Date());
    if (!email.ok) fail(email.status === 400 ? "Укажите почту — на неё придёт ваш разбор" : email.error);
  }
  const res = await startConversation(db, lead, expertId, new Date());
  if (!res.ok) fail(res.error);
  // Пришёл по ссылке с другого устройства — запомним заявку и здесь
  await rememberLead(lead.id);
  redirect(`/razbor/${lead.id}/chat?c=${res.conversation.id}`);
}
