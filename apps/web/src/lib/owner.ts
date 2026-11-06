/**
 * Владелец сайта — вход в админку из Telegram. ID владельцев — OWNER_TELEGRAM_IDS в .env сервера (через запятую).
 * Владелец пишет боту /admin — бот присылает ссылку входа: подписанный ключом бота код на ADMIN_CODE_MS.
 * Ссылка открывает /admin/telegram — там ставится обычная cookie админки (как после входа по паролю).
 * Пароль админки продолжает работать; остальным пользователям бота /admin ничего не даёт.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_CODE_MS = 10 * 60_000;

export function ownerTelegramIds(env: Record<string, string | undefined> = process.env): Set<number> {
  return new Set(
    (env.OWNER_TELEGRAM_IDS ?? "")
      .split(/[,\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
}

export const isOwner = (telegramUserId: number, env?: Record<string, string | undefined>) => ownerTelegramIds(env).has(telegramUserId);

const sign = (token: string, value: string) => createHmac("sha256", token).update(`owner-admin:${value}`).digest("hex").slice(0, 32);

/** Код входа в админку для владельца: «<tg>.<срок>.<подпись>». */
export function adminLoginCode(token: string, telegramUserId: number, now: Date): string {
  const exp = Math.floor((now.getTime() + ADMIN_CODE_MS) / 1000);
  return `${telegramUserId}.${exp}.${sign(token, `${telegramUserId}.${exp}`)}`;
}

/** Код подошёл, не истёк и выдан владельцу — его Telegram ID; иначе null. */
export function ownerFromAdminCode(token: string, code: string, now: Date, env?: Record<string, string | undefined>): number | null {
  const m = /^(\d{1,15})\.(\d{1,12})\.([0-9a-f]{32})$/.exec(code);
  if (!m) return null;
  const [, tg, exp, sig] = m as unknown as [string, string, string, string];
  if (Number(exp) * 1000 < now.getTime()) return null;
  const expected = Buffer.from(sign(token, `${tg}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return isOwner(Number(tg), env) ? Number(tg) : null;
}
