/**
 * Эксперты: профили, пароли, вход в панель, статус «онлайн», фото.
 * Онлайн = эксперт включил статус И открывал панель за последние ONLINE_TIMEOUT_MS:
 * забытый включённым статус гаснет сам.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { expertPhotos, experts } from "@/db/schema";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export type Expert = typeof experts.$inferSelect;
/** Эксперт без хеша пароля — то, что можно отдавать в страницы. */
export type PublicExpert = Omit<Expert, "passwordHash">;

export const ONLINE_TIMEOUT_MS = 5 * 60_000;
export const MIN_EXPERT_PASSWORD = 10;
export const EXPERT_SESSION_DAYS = 14;

/** Сколько держится «в сети», включённое админом. */
export const ADMIN_ONLINE_MS = 60 * 60_000;

export function isOnline(e: Pick<Expert, "online" | "lastSeenAt" | "onlineUntil">, now: Date): boolean {
  if (e.onlineUntil !== null && e.onlineUntil.getTime() > now.getTime()) return true;
  return e.online && e.lastSeenAt !== null && now.getTime() - e.lastSeenAt.getTime() < ONLINE_TIMEOUT_MS;
}

// --- Пароли: scrypt со случайной солью ---

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, saltB64, hashB64] = stored.split("$");
  if (kind !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

// --- Сессия эксперта: «id.срок.подпись»; в ключе подписи — хеш пароля, смена пароля завершает сессии ---

function sign(payload: string, passwordHash: string, secret: string): string {
  return createHmac("sha256", `${secret}\n${passwordHash}`).update(payload).digest("base64url");
}

export function createExpertToken(expert: Pick<Expert, "id" | "passwordHash">, nowMs: number, secret: string): string {
  const payload = `${expert.id}.${nowMs + EXPERT_SESSION_DAYS * 86_400_000}`;
  return `${payload}.${sign(payload, expert.passwordHash, secret)}`;
}

/** id эксперта из токена (без проверки подписи) — чтобы найти его в базе. */
export function tokenExpertId(token: string | undefined): number | null {
  const id = token?.split(".")[0];
  return id && /^\d{1,9}$/.test(id) ? Number(id) : null;
}

export function verifyExpertToken(token: string, expert: Pick<Expert, "id" | "passwordHash">, nowMs: number, secret: string): boolean {
  const [id, expires, mac] = token.split(".");
  if (!id || !expires || !mac || Number(id) !== expert.id || !/^\d+$/.test(expires) || Number(expires) < nowMs) {
    return false;
  }
  const expected = Buffer.from(sign(`${id}.${expires}`, expert.passwordHash, secret));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// --- Данные ---

const publicColumns = {
  id: experts.id,
  name: experts.name,
  description: experts.description,
  login: experts.login,
  online: experts.online,
  lastSeenAt: experts.lastSeenAt,
  onlineUntil: experts.onlineUntil,
  active: experts.active,
  sort: experts.sort,
  createdAt: experts.createdAt,
};

export function listExperts(db: Db): Promise<PublicExpert[]> {
  return db.select(publicColumns).from(experts).orderBy(asc(experts.sort), asc(experts.id));
}

export async function getExpert(db: Db, id: number): Promise<PublicExpert | null> {
  const [e] = await db.select(publicColumns).from(experts).where(eq(experts.id, id));
  return e ?? null;
}

/** Эксперт с хешем пароля — только для входа и проверки сессии. */
export async function getExpertWithSecret(db: Db, by: { id: number } | { login: string }): Promise<Expert | null> {
  const where = "id" in by ? eq(experts.id, by.id) : eq(experts.login, by.login);
  const [e] = await db.select().from(experts).where(where);
  return e ?? null;
}

export const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;

export type CreateExpertResult = { ok: true; id: number } | { ok: false; error: string };

export async function createExpert(db: Db, input: { name: string; login: string; password: string }): Promise<CreateExpertResult> {
  const name = input.name.trim();
  const login = input.login.trim().toLowerCase();
  if (!name) return { ok: false, error: "Укажите имя эксперта" };
  if (!LOGIN_RE.test(login)) return { ok: false, error: "Логин: 3–32 символа, латиница, цифры, точка, дефис" };
  if (input.password.length < MIN_EXPERT_PASSWORD) {
    return { ok: false, error: `Пароль — не короче ${MIN_EXPERT_PASSWORD} символов` };
  }
  if (await getExpertWithSecret(db, { login })) return { ok: false, error: "Такой логин уже есть" };
  const [e] = await db
    .insert(experts)
    .values({ name, login, passwordHash: await hashPassword(input.password) })
    .returning({ id: experts.id });
  return { ok: true, id: (e as { id: number }).id };
}

export async function setExpertPassword(db: Db, id: number, password: string): Promise<string | null> {
  if (password.length < MIN_EXPERT_PASSWORD) return `Пароль — не короче ${MIN_EXPERT_PASSWORD} символов`;
  await db.update(experts).set({ passwordHash: await hashPassword(password) }).where(eq(experts.id, id));
  return null;
}

/** Отметка «эксперт на месте» — при каждом обращении к панели. */
export async function touchExpert(db: Db, id: number, now: Date): Promise<void> {
  await db.update(experts).set({ lastSeenAt: now }).where(eq(experts.id, id));
}

/** Эксперт сам включает или выключает «в сети». Выключение снимает и включение админом. */
export async function setExpertOnline(db: Db, id: number, online: boolean, now: Date): Promise<void> {
  await db
    .update(experts)
    .set({ online, lastSeenAt: now, ...(!online && { onlineUntil: null }) })
    .where(eq(experts.id, id));
}

/** Админ: «в сети» на ADMIN_ONLINE_MS или выключить совсем. */
export async function setOnlineByAdmin(db: Db, id: number, on: boolean, now: Date): Promise<void> {
  await db
    .update(experts)
    .set(on ? { onlineUntil: new Date(now.getTime() + ADMIN_ONLINE_MS) } : { online: false, onlineUntil: null })
    .where(eq(experts.id, id));
}

// --- Фото: JPEG, PNG или WebP до 2 МБ; тип определяется по содержимому, а не по имени файла ---

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export function detectImageMime(data: Buffer): string | null {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (data.length > 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

export async function saveExpertPhoto(db: Db, expertId: number, data: Buffer): Promise<string | null> {
  if (data.length > MAX_PHOTO_BYTES) return "Фото больше 2 МБ";
  const mime = detectImageMime(data);
  if (!mime) return "Фото должно быть в формате JPEG, PNG или WebP";
  await db
    .insert(expertPhotos)
    .values({ expertId, mime, data })
    .onConflictDoUpdate({ target: expertPhotos.expertId, set: { mime, data, updatedAt: new Date() } });
  return null;
}

export async function getExpertPhoto(db: Db, expertId: number) {
  const [p] = await db.select().from(expertPhotos).where(eq(expertPhotos.expertId, expertId));
  return p ?? null;
}

/** Адреса фото: эксперт → «/experts/1/photo?v=…». v меняется при замене фото — браузер не покажет старое. */
export async function expertPhotoUrls(db: Db): Promise<Map<number, string>> {
  const rows = await db.select({ id: expertPhotos.expertId, updatedAt: expertPhotos.updatedAt }).from(expertPhotos);
  return new Map(rows.map((r) => [r.id, `/experts/${r.id}/photo?v=${r.updatedAt.getTime()}`]));
}
