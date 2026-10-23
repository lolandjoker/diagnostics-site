"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { startConversation } from "@/lib/chat";
import { getLead } from "@/lib/leads";

/** Человек выбрал эксперта → чат (в него сразу приходит подробный разбор). */
export async function chooseExpert(form: FormData): Promise<void> {
  const leadId = String(form.get("leadId") ?? "");
  const expertId = Number(form.get("expertId"));
  const db = await getDb();
  const lead = await getLead(db, leadId);
  if (!lead || !Number.isInteger(expertId)) redirect("/");
  const res = await startConversation(db, lead, expertId, new Date());
  if (!res.ok) redirect(`/razbor/${lead.id}/eksperty?error=${encodeURIComponent(res.error)}`);
  redirect(`/razbor/${lead.id}/chat`);
}
