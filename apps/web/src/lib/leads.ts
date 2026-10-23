/** Заявки: человек ввёл имя и дату рождения и дал согласие на обработку данных. */
import { eq } from "drizzle-orm";
import { assertValidBirthDate } from "@diag/engine";
import type { Db } from "@/db";
import { leads } from "@/db/schema";
import { parseIsoDate } from "./diagnostic";

export type Lead = typeof leads.$inferSelect;

export const MIN_AGE = 18;
export const MAX_NAME_LENGTH = 60;

/** Полных лет на дату today. */
export function ageOn(birthIso: string, today: Date): number {
  const b = parseIsoDate(birthIso);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const d = today.getUTCDate();
  return y - b.year - (m < b.month || (m === b.month && d < b.day) ? 1 : 0);
}

export type LeadInput = { name: string; birthDate: string; consent: boolean };

/** Проверка формы. Возвращает текст ошибки для человека или null. */
export function validateLead(input: LeadInput, today: Date): string | null {
  const name = input.name.trim();
  if (name === "") return "Укажите имя";
  if (name.length > MAX_NAME_LENGTH) return "Имя слишком длинное";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate)) return "Укажите дату рождения";
  try {
    assertValidBirthDate(parseIsoDate(input.birthDate));
  } catch (err) {
    return err instanceof Error ? err.message : "Неверная дата рождения";
  }
  if (ageOn(input.birthDate, today) < MIN_AGE) return `Сервис доступен с ${MIN_AGE} лет`;
  if (!input.consent) return "Нужно согласие на обработку персональных данных";
  return null;
}

export async function createLead(db: Db, input: LeadInput, now: Date, variationId: number | null = null): Promise<Lead> {
  const [lead] = await db
    .insert(leads)
    .values({ name: input.name.trim(), birthDate: input.birthDate, consentAt: now, variationId })
    .returning();
  return lead as Lead;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID.test(s);
}

export async function getLead(db: Db, id: string): Promise<Lead | null> {
  if (!isUuid(id)) return null;
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  return lead ?? null;
}
