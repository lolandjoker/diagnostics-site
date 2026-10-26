/**
 * Кто работает в админке: админ (пароль из .env) или эксперт — с теми же правами,
 * кроме «Текстов сайта» (их правит только админ, см. requireAdmin).
 */
import { redirect } from "next/navigation";
import { isAdmin } from "./admin-auth";
import { currentExpert } from "./expert-auth";
import type { PublicExpert } from "./experts";

export type Staff = { kind: "admin" } | { kind: "expert"; expert: PublicExpert };

export async function currentStaff(): Promise<Staff | null> {
  if (await isAdmin()) return { kind: "admin" };
  const expert = await currentExpert();
  return expert ? { kind: "expert", expert } : null;
}

/** В начале страниц и действий админки, открытых и экспертам. Не вошёл — на вход в админку. */
export async function requireStaff(): Promise<Staff> {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");
  return staff;
}
