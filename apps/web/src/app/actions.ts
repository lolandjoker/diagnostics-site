"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { birthDateToIso, createLead, rememberLead, validateLead } from "@/lib/leads";
import { pickVariation } from "@/lib/variations";

export interface FormState {
  error: string | null;
}

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

/** Форма на главной: имя и дата рождения → страница разбора. */
export async function submitLead(_prev: FormState, form: FormData): Promise<FormState> {
  const input = {
    name: str(form.get("name")),
    // В форме — ДД.ММ.ГГГГ, в базе — ГГГГ-ММ-ДД; неразборчивое отклонит validateLead
    birthDate: birthDateToIso(str(form.get("birthDate"))) ?? str(form.get("birthDate")),
  };
  const now = new Date();
  const error = validateLead(input, now);
  if (error) return { error };
  const db = await getDb();
  const lead = await createLead(db, input, now, await pickVariation(db));
  await rememberLead(lead.id);
  redirect(`/razbor/${lead.id}`);
}
