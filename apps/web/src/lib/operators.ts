/**
 * Операторы чатов: заводит админ (раздел «Операторы»), входят по логину и паролю в панель /operator,
 * где есть только чаты. Пароль — scrypt, как у экспертов; сессия — «id.срок.подпись», в ключе подписи
 * хеш пароля: смена пароля или выключение завершает сессии.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { operators } from "@/db/schema";
import { LOGIN_RE, MIN_EXPERT_PASSWORD, hashPassword } from "./experts";

export type Operator = typeof operators.$inferSelect;
export type PublicOperator = Omit<Operator, "passwordHash">;

export const OPERATOR_SESSION_DAYS = 14;
export const MIN_OPERATOR_PASSWORD = MIN_EXPERT_PASSWORD;

const publicColumns = {
  id: operators.id,
  name: operators.name,
  login: operators.login,
  active: operators.active,
  createdAt: operators.createdAt,
  deletedAt: operators.deletedAt,
};

/** Неудалённые операторы, по порядку заведения. */
export function listOperators(db: Db): Promise<PublicOperator[]> {
  return db.select(publicColumns).from(operators).where(isNull(operators.deletedAt)).orderBy(asc(operators.id));
}

export async function getOperatorWithSecret(db: Db, by: { id: number } | { login: string }): Promise<Operator | null> {
  const where = "id" in by ? eq(operators.id, by.id) : eq(operators.login, by.login);
  const [o] = await db.select().from(operators).where(and(where, isNull(operators.deletedAt)));
  return o ?? null;
}

export type CreateOperatorResult = { ok: true; id: number } | { ok: false; error: string };

export async function createOperator(db: Db, input: { name: string; login: string; password: string }): Promise<CreateOperatorResult> {
  const name = input.name.trim();
  const login = input.login.trim().toLowerCase();
  if (name === "" || name.length > 60) return { ok: false, error: "Укажите имя (до 60 символов)" };
  if (!LOGIN_RE.test(login)) return { ok: false, error: "Логин — от 3 до 32 латинских букв, цифр, точек, дефисов" };
  if (input.password.length < MIN_OPERATOR_PASSWORD) return { ok: false, error: `Пароль — не короче ${MIN_OPERATOR_PASSWORD} символов` };
  // Логин занят и удалённым оператором: строка остаётся ради подписей его сообщений
  const [taken] = await db.select({ id: operators.id }).from(operators).where(eq(operators.login, login));
  if (taken) return { ok: false, error: "Такой логин уже есть" };
  const [o] = await db
    .insert(operators)
    .values({ name, login, passwordHash: await hashPassword(input.password) })
    .returning({ id: operators.id });
  return { ok: true, id: (o as { id: number }).id };
}

export async function setOperatorPassword(db: Db, id: number, password: string): Promise<string | null> {
  if (password.length < MIN_OPERATOR_PASSWORD) return `Пароль — не короче ${MIN_OPERATOR_PASSWORD} символов`;
  await db.update(operators).set({ passwordHash: await hashPassword(password) }).where(eq(operators.id, id));
  return null;
}

export async function setOperatorActive(db: Db, id: number, active: boolean): Promise<void> {
  await db.update(operators).set({ active }).where(eq(operators.id, id));
}

/** Убрать из списка и закрыть вход; его сообщения остаются подписанными. */
export async function deleteOperator(db: Db, id: number, now: Date): Promise<void> {
  await db.update(operators).set({ deletedAt: now, active: false }).where(eq(operators.id, id));
}

// --- Сессия ---

function sign(payload: string, passwordHash: string, secret: string): string {
  // «operator» в ключе: подпись оператора не подойдёт к сессии эксперта и наоборот
  return createHmac("sha256", `${secret}\noperator\n${passwordHash}`).update(payload).digest("base64url");
}

export function createOperatorToken(o: Pick<Operator, "id" | "passwordHash">, nowMs: number, secret: string): string {
  const payload = `${o.id}.${nowMs + OPERATOR_SESSION_DAYS * 86_400_000}`;
  return `${payload}.${sign(payload, o.passwordHash, secret)}`;
}

/** id оператора из токена (без проверки подписи) — чтобы найти его в базе. */
export function tokenOperatorId(token: string | undefined): number | null {
  const id = token?.split(".")[0];
  return id && /^\d{1,9}$/.test(id) ? Number(id) : null;
}

export function verifyOperatorToken(token: string, o: Pick<Operator, "id" | "passwordHash">, nowMs: number, secret: string): boolean {
  const [id, expires, mac] = token.split(".");
  if (!id || !expires || !mac || Number(id) !== o.id || !/^\d+$/.test(expires) || Number(expires) < nowMs) return false;
  const expected = Buffer.from(sign(`${id}.${expires}`, o.passwordHash, secret));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
