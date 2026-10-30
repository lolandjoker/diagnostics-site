/**
 * Вход эксперта: cookie с подписью, проверка по базе на каждом запросе.
 * Эксперт работает в панели /expert и в админке /admin — с правами админа, кроме «Текстов сайта».
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getExpertWithSecret, touchExpert, tokenExpertId, verifyExpertToken } from "./experts";
import type { PublicExpert } from "./experts";

/**
 * Cookie на весь сайт: нужна и в /expert, и в /admin. Имя новое: прежняя cookie «diag_expert» была
 * только для /expert — её больше не читаем (после обновления эксперт входит один раз заново).
 */
export const EXPERT_COOKIE = "diag_expert_session";
export const EXPERT_COOKIE_PATH = "/";

/** Секрет подписи сессий (тот же, что у админки) или null, если он не задан. */
export function sessionSecret(): string | null {
  const s = process.env.SESSION_SECRET ?? "";
  return s.length >= 32 ? s : null;
}

/** Текущий эксперт или null. Заодно отмечает, что он на месте (для статуса «онлайн»). */
export async function currentExpert(): Promise<PublicExpert | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const token = (await cookies()).get(EXPERT_COOKIE)?.value;
  const id = tokenExpertId(token);
  if (!token || id === null) return null;

  const db = await getDb();
  const expert = await getExpertWithSecret(db, { id });
  const now = new Date();
  if (!expert || !expert.active || expert.archivedAt || !verifyExpertToken(token, expert, now.getTime(), secret)) return null;

  // Не пишем в базу на каждый опрос чата: отметки раз в 30 секунд достаточно
  if (!expert.lastSeenAt || now.getTime() - expert.lastSeenAt.getTime() > 30_000) {
    await touchExpert(db, expert.id, now);
  }
  const { passwordHash: _omit, ...rest } = expert;
  return rest;
}

export async function requireExpert(): Promise<PublicExpert> {
  const expert = await currentExpert();
  if (!expert) redirect("/expert/login");
  return expert;
}
