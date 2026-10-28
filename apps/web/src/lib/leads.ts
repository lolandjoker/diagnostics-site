/** Заявки: человек ввёл имя и дату рождения. */
import { and, eq, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { assertValidBirthDate } from "@diag/engine";
import type { BirthDate } from "@diag/engine";
import type { Db } from "@/db";
import { leads } from "@/db/schema";

export type Lead = typeof leads.$inferSelect;

/** Дата из базы ('1990-03-15') в BirthDate. */
export function parseIsoDate(iso: string): BirthDate {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year ?? NaN, month: month ?? NaN, day: day ?? NaN };
}

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

export type LeadInput = { name: string; birthDate: string };

/**
 * Дата из формы «ДД.ММ.ГГГГ» (разделитель — точка, косая черта, дефис или пробел; день и месяц можно
 * одной цифрой) → «ГГГГ-ММ-ДД», как в базе. Уже ГГГГ-ММ-ДД — как есть. Не разобрать — null.
 * Существует ли такая дата, проверяет validateLead.
 */
export function birthDateToIso(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[./ -](\d{1,2})[./ -](\d{4})$/.exec(s);
  if (!m) return null;
  const [, d, mo, y] = m as unknown as [string, string, string, string];
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** Проверка формы. Возвращает текст ошибки для человека или null. */
export function validateLead(input: LeadInput, today: Date): string | null {
  const name = input.name.trim();
  if (name === "") return "Укажите имя";
  if (name.length > MAX_NAME_LENGTH) return "Имя слишком длинное";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate)) return "Укажите дату рождения в формате ДД.ММ.ГГГГ";
  try {
    assertValidBirthDate(parseIsoDate(input.birthDate));
  } catch (err) {
    return err instanceof Error ? err.message : "Неверная дата рождения";
  }
  if (ageOn(input.birthDate, today) < MIN_AGE) return `Сервис доступен с ${MIN_AGE} лет`;
  return null;
}

export async function createLead(
  db: Db,
  input: LeadInput,
  now: Date,
  variationId: number | null = null,
  telegramUserId: number | null = null,
): Promise<Lead> {
  const [lead] = await db
    .insert(leads)
    // consent_at — столбец обязательный и не удаляется (правило схемы); галочки согласия больше нет,
    // пишем время заявки
    .values({ name: input.name.trim(), birthDate: input.birthDate, consentAt: now, variationId, telegramUserId })
    .returning();
  return lead as Lead;
}

/** Столько после заявки краткий разбор «считается»: страница разбора показывает анимацию. */
export const RESULT_LOADING_MS = 30_000;

/** Имя и дату рождения на странице разбора можно поменять не больше стольких раз. */
export const MAX_LEAD_EDITS = 3;

/**
 * Человек поправил имя или дату рождения. Разбор остаётся тем же (вариант не меняется),
 * подробный разбор, если уже пришёл в чат, повторно не приходит. Попытки кончились — null.
 */
export async function editLead(db: Db, id: string, input: LeadInput): Promise<Lead | null> {
  if (!isUuid(id)) return null;
  const [lead] = await db
    .update(leads)
    .set({ name: input.name.trim(), birthDate: input.birthDate, edits: sql`${leads.edits} + 1` })
    .where(and(eq(leads.id, id), lt(leads.edits, MAX_LEAD_EDITS)))
    .returning();
  return lead ?? null;
}

/** Дата из базы для поля формы: «1990-03-15» → «15.03.1990». */
export function isoToBirthDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

const UUID =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID.test(s);
}

/**
 * Браузер запоминает заявку на год: человек зашёл на сайт снова — попадает в свой чат или разбор,
 * а не на пустую форму. В cookie — тот же id, что и в адресе разбора; JavaScript страницы его не видит.
 */
export const LEAD_COOKIE = "lead";
const LEAD_COOKIE_DAYS = 365;

/** Только в серверном действии или обработчике маршрута — там Next разрешает ставить cookie. */
export async function rememberLead(id: string): Promise<void> {
  (await cookies()).set(LEAD_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LEAD_COOKIE_DAYS * 86_400,
  });
}

export async function rememberedLeadId(): Promise<string | null> {
  const id = (await cookies()).get(LEAD_COOKIE)?.value;
  return id && isUuid(id) ? id : null;
}

export async function getLead(db: Db, id: string): Promise<Lead | null> {
  if (!isUuid(id)) return null;
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  return lead ?? null;
}
