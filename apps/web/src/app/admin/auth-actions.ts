"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  authConfig,
  checkPassword,
  createSessionToken,
  loginBlocked,
  recordLoginFail,
  resetLoginFails,
} from "@/lib/admin-auth";
import type { ActionResult } from "./ActionForm";

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function login(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const cfg = authConfig();
  if (typeof cfg === "string") return { ok: false, message: `Вход выключен: ${cfg}` };
  const ip = await clientIp();
  const now = Date.now();
  if (loginBlocked(ip, now)) return { ok: false, message: "Слишком много попыток. Попробуйте через 15 минут" };

  const password = form.get("password");
  if (typeof password !== "string" || !checkPassword(password, cfg)) {
    recordLoginFail(ip, now);
    return { ok: false, message: "Неверный пароль" };
  }
  resetLoginFails(ip);
  (await cookies()).set(SESSION_COOKIE, createSessionToken(now, cfg), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: SESSION_DAYS * 86_400,
  });
  redirect("/admin");
}

export async function logout(): Promise<void> {
  (await cookies()).delete({ name: SESSION_COOKIE, path: "/admin" });
  redirect("/admin/login");
}
