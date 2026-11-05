"use server";

/**
 * Подключение Telegram сотрудника (уведомления о сообщениях клиентов). Действие проверяет, что вошедший
 * действительно тот, за кого подключает: админ, эксперт или оператор (kind — из какой панели нажали).
 */
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { currentExpert } from "@/lib/expert-auth";
import { currentOperator } from "@/lib/operator-auth";
import { type StaffKind, type StaffRef, STAFF_START_PREFIX, createStaffLinkToken, unlinkStaff } from "@/lib/staff-telegram";
import { botUsername, telegramConfig } from "@/lib/telegram";

async function me(kind: StaffKind): Promise<StaffRef | null> {
  if (kind === "admin") return (await isAdmin()) ? { kind, staffId: 0 } : null;
  if (kind === "expert") {
    const e = await currentExpert();
    return e ? { kind, staffId: e.id } : null;
  }
  const o = await currentOperator();
  return o ? { kind, staffId: o.id } : null;
}

const isKind = (k: unknown): k is StaffKind => k === "admin" || k === "expert" || k === "operator";

/** Одноразовая ссылка на бота (15 минут). */
export async function connectStaffTelegramAction(kind: StaffKind): Promise<{ href: string } | { error: string }> {
  if (!isKind(kind)) return { error: "Нужно войти" };
  const ref = await me(kind);
  if (!ref) return { error: "Нужно войти" };
  const cfg = telegramConfig();
  const bot = cfg ? await botUsername(cfg) : null;
  if (!bot) return { error: "Telegram-бот не подключён" };
  const token = await createStaffLinkToken(await getDb(), ref, new Date());
  return { href: `https://t.me/${bot}?start=${STAFF_START_PREFIX}${token}` };
}

export async function disconnectStaffTelegramAction(kind: StaffKind): Promise<void> {
  if (!isKind(kind)) return;
  const ref = await me(kind);
  if (!ref) return;
  await unlinkStaff(await getDb(), ref);
  revalidatePath("/", "layout");
}
