"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { loginBlocked, recordLoginFail, resetLoginFails } from "@/lib/admin-auth";
import { sessionSecret } from "@/lib/expert-auth";
import { verifyPassword } from "@/lib/experts";
import { OPERATOR_COOKIE } from "@/lib/operator-auth";
import { OPERATOR_SESSION_DAYS, createOperatorToken, getOperatorWithSecret } from "@/lib/operators";
import type { ActionResult } from "../admin/ActionForm";

export async function operatorLogin(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const secret = sessionSecret();
  if (!secret) return { ok: false, message: "Вход выключен: на сервере не задан SESSION_SECRET" };
  const ip = `operator:${(await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"}`;
  const now = Date.now();
  if (loginBlocked(ip, now)) return { ok: false, message: "Слишком много попыток. Попробуйте через 15 минут" };

  const login = String(form.get("login") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const operator = login ? await getOperatorWithSecret(await getDb(), { login }) : null;
  if (!operator || !operator.active || !(await verifyPassword(password, operator.passwordHash))) {
    recordLoginFail(ip, now);
    return { ok: false, message: "Неверный логин или пароль" };
  }
  resetLoginFails(ip);
  (await cookies()).set(OPERATOR_COOKIE, createOperatorToken(operator, now, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: OPERATOR_SESSION_DAYS * 86_400,
  });
  redirect("/operator");
}

export async function operatorLogout(): Promise<void> {
  (await cookies()).delete({ name: OPERATOR_COOKIE, path: "/" });
  redirect("/operator/login");
}
