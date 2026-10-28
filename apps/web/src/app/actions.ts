"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { MAX_LEAD_EDITS, birthDateToIso, createLead, editLead, rememberLead, validateLead } from "@/lib/leads";
import { telegramConfig, verifyInitData } from "@/lib/telegram";
import { pickVariation } from "@/lib/variations";

export interface FormState {
  error: string | null;
}

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

// В форме — ДД.ММ.ГГГГ, в базе — ГГГГ-ММ-ДД; неразборчивое отклонит validateLead
const leadInput = (form: FormData) => ({
  name: str(form.get("name")),
  birthDate: birthDateToIso(str(form.get("birthDate"))) ?? str(form.get("birthDate")),
});

/** Форма на главной: имя и дата рождения → страница разбора. */
export async function submitLead(_prev: FormState, form: FormData): Promise<FormState> {
  const input = leadInput(form);
  const now = new Date();
  const error = validateLead(input, now);
  if (error) return { error };
  // Из приложения в Telegram-боте — запоминаем пользователя Telegram: по нему он вернётся в свой чат
  // и получит уведомления об ответах эксперта
  const tg = telegramConfig();
  const tgInitData = str(form.get("tg"));
  const telegramUser = tg && tgInitData ? verifyInitData(tgInitData, tg.token, now) : null;
  const db = await getDb();
  const lead = await createLead(db, input, now, await pickVariation(db), telegramUser?.id ?? null);
  await rememberLead(lead.id);
  redirect(`/razbor/${lead.id}`);
}

/** Страница «Изменить данные»: новые имя и дата рождения → обратно к разбору. */
export async function updateLead(_prev: FormState, form: FormData): Promise<FormState> {
  const input = leadInput(form);
  const error = validateLead(input, new Date());
  if (error) return { error };
  const db = await getDb();
  const lead = await editLead(db, str(form.get("leadId")), input);
  if (!lead) return { error: `Имя и дату рождения можно изменить только ${MAX_LEAD_EDITS} раза` };
  redirect(`/razbor/${lead.id}`);
}
