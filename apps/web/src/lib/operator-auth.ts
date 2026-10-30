/**
 * Вход оператора чатов и доступ к чатам. Чаты (API /admin/api/chat/*, /admin/api/inbox) открыты админу
 * и операторам; всё остальное в админке — по-прежнему только админу и экспертам (staff-auth).
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { isAdmin } from "./admin-auth";
import { sessionSecret } from "./expert-auth";
import { getOperatorWithSecret, tokenOperatorId, verifyOperatorToken } from "./operators";
import type { PublicOperator } from "./operators";

export const OPERATOR_COOKIE = "diag_operator_session";

export async function currentOperator(): Promise<PublicOperator | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const token = (await cookies()).get(OPERATOR_COOKIE)?.value;
  const id = tokenOperatorId(token);
  if (!token || id === null) return null;
  const o = await getOperatorWithSecret(await getDb(), { id });
  if (!o || !o.active || !verifyOperatorToken(token, o, Date.now(), secret)) return null;
  const { passwordHash: _omit, ...rest } = o;
  return rest;
}

export async function requireOperator(): Promise<PublicOperator> {
  const o = await currentOperator();
  if (!o) redirect("/operator/login");
  return o;
}

/** Кто работает с чатами: админ или оператор (чьё имя ставить под сообщением). null — нет доступа. */
export type ChatWorker = { kind: "admin" } | { kind: "operator"; operator: PublicOperator };

export async function chatWorker(): Promise<ChatWorker | null> {
  if (await isAdmin()) return { kind: "admin" };
  const operator = await currentOperator();
  return operator ? { kind: "operator", operator } : null;
}
