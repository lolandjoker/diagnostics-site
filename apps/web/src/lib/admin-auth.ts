/**
 * Вход в админку: один пароль из .env (ADMIN_PASSWORD).
 * После входа ставится cookie «срок.подпись»; подпись — HMAC-SHA256 с SESSION_SECRET.
 * Смена ADMIN_PASSWORD или SESSION_SECRET завершает все сессии.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "diag_admin";
export const SESSION_DAYS = 7;

const MIN_SECRET_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 12;

interface AuthConfig {
  password: string;
  secret: string;
}

/** Настройки входа или текст ошибки, если они не заданы или слишком слабые. */
export function authConfig(env: Record<string, string | undefined> = process.env): AuthConfig | string {
  const password = env.ADMIN_PASSWORD ?? "";
  const secret = env.SESSION_SECRET ?? "";
  if (password.length < MIN_PASSWORD_LENGTH) return `ADMIN_PASSWORD не задан или короче ${MIN_PASSWORD_LENGTH} символов`;
  if (secret.length < MIN_SECRET_LENGTH) return `SESSION_SECRET не задан или короче ${MIN_SECRET_LENGTH} символов`;
  return { password, secret };
}

function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

function sign(payload: string, cfg: AuthConfig): string {
  // В ключ входит и пароль: смена пароля делает старые cookie недействительными
  return createHmac("sha256", `${cfg.secret}\n${cfg.password}`).update(payload).digest("base64url");
}

export function checkPassword(input: string, cfg: AuthConfig): boolean {
  return timingSafeEqual(sha256(input), sha256(cfg.password));
}

export function createSessionToken(nowMs: number, cfg: AuthConfig): string {
  const expires = String(nowMs + SESSION_DAYS * 86_400_000);
  return `${expires}.${sign(expires, cfg)}`;
}

export function verifySessionToken(token: string | undefined, nowMs: number, cfg: AuthConfig): boolean {
  if (!token) return false;
  const [expires, mac] = token.split(".");
  if (!expires || !mac || !/^\d+$/.test(expires) || Number(expires) < nowMs) return false;
  const expected = Buffer.from(sign(expires, cfg));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function isAdmin(): Promise<boolean> {
  const cfg = authConfig();
  if (typeof cfg === "string") return false;
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value, Date.now(), cfg);
}

/** В начале каждой страницы и каждого действия админки: не вошёл — на страницу входа. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

// --- Ограничение попыток входа: не больше 5 неудачных за 15 минут с одного адреса ---

const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;
const fails = new Map<string, number[]>();

export function loginBlocked(ip: string, nowMs: number): boolean {
  const recent = (fails.get(ip) ?? []).filter((t) => nowMs - t < WINDOW_MS);
  if (recent.length > 0) fails.set(ip, recent);
  else fails.delete(ip);
  return recent.length >= MAX_FAILS;
}

export function recordLoginFail(ip: string, nowMs: number): void {
  // Не даём таблице расти бесконечно при переборе с разных адресов
  if (fails.size > 10_000) fails.clear();
  fails.set(ip, [...(fails.get(ip) ?? []), nowMs]);
}

export function resetLoginFails(ip: string): void {
  fails.delete(ip);
}
