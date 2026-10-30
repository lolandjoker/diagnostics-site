"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { loginBlocked, recordLoginFail, resetLoginFails } from "@/lib/admin-auth";
import { EXPERT_COOKIE, EXPERT_COOKIE_PATH, requireExpert, sessionSecret } from "@/lib/expert-auth";
import {
  EXPERT_SESSION_DAYS,
  EXPERT_STATUSES,
  createExpertToken,
  getExpertWithSecret,
  setExpertOnline,
  setExpertStatus,
  verifyPassword,
} from "@/lib/experts";
import type { ExpertStatus } from "@/lib/experts";
import type { ActionResult } from "../admin/ActionForm";

export async function expertLogin(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const secret = sessionSecret();
  if (!secret) return { ok: false, message: "Вход выключен: на сервере не задан SESSION_SECRET" };
  const ip = `expert:${(await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"}`;
  const now = Date.now();
  if (loginBlocked(ip, now)) return { ok: false, message: "Слишком много попыток. Попробуйте через 15 минут" };

  const login = String(form.get("login") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const db = await getDb();
  const expert = login ? await getExpertWithSecret(db, { login }) : null;
  if (!expert || !expert.active || expert.archivedAt || !(await verifyPassword(password, expert.passwordHash))) {
    recordLoginFail(ip, now);
    return { ok: false, message: "Неверный логин или пароль" };
  }
  resetLoginFails(ip);
  (await cookies()).set(EXPERT_COOKIE, createExpertToken(expert, now, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: EXPERT_COOKIE_PATH,
    maxAge: EXPERT_SESSION_DAYS * 86_400,
  });
  redirect("/expert");
}

export async function expertLogout(): Promise<void> {
  const expert = await requireExpert();
  // Ушёл — сразу не в сети, чтобы к нему не попадали новые клиенты
  await setExpertOnline(await getDb(), expert.id, false, new Date());
  (await cookies()).delete({ name: EXPERT_COOKIE, path: EXPERT_COOKIE_PATH });
  redirect("/expert/login");
}

/** Эксперт сам выбирает статус: в сети, занят, не в сети. Держится, пока не сменит. */
export async function setMyStatus(form: FormData): Promise<void> {
  const expert = await requireExpert();
  const status = String(form.get("status") ?? "");
  if ((EXPERT_STATUSES as readonly string[]).includes(status)) {
    await setExpertStatus(await getDb(), expert.id, status as ExpertStatus, new Date());
  }
  revalidatePath("/expert", "layout");
}
