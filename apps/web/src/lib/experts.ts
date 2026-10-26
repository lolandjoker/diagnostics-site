/**
 * Эксперты: профили, пароли, вход в панель, статус, фото.
 * Статус: «в сети» — эксперт (или админ «навсегда») включил и он держится, пока не выключат,
 * либо админ включил на срок (onlineUntil); «занят» — в сети, писать можно, ответит позже;
 * «не в сети» — выбрать эксперта нельзя.
 */
import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { expertPhotos, experts } from "@/db/schema";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export type Expert = typeof experts.$inferSelect;
/** Эксперт без хеша пароля — то, что можно отдавать в страницы. */
export type PublicExpert = Omit<Expert, "passwordHash">;

export const MIN_EXPERT_PASSWORD = 10;
export const EXPERT_SESSION_DAYS = 14;

/** На сколько админ может включить «в сети»: единицы срока и пределы. «Навсегда» — ADMIN_ONLINE_FOREVER. */
export const ADMIN_ONLINE_UNITS = {
  minutes: { label: "минут", ms: 60_000 },
  hours: { label: "часов", ms: 60 * 60_000 },
  days: { label: "дней", ms: 24 * 60 * 60_000 },
} as const;
export type AdminOnlineUnit = keyof typeof ADMIN_ONLINE_UNITS;
export const ADMIN_ONLINE_MIN_MS = 60_000;
export const ADMIN_ONLINE_MAX_MS = 365 * 24 * 60 * 60_000;
/** Значение единицы срока в форме админа: «в сети», пока не выключат. */
export const ADMIN_ONLINE_FOREVER = "forever";

/** Срок из формы админа («3» + «hours») в мс или null, если срок вне пределов. */
export function adminOnlineMs(amount: string, unit: string): number | null {
  if (!/^\d{1,6}$/.test(amount.trim()) || !(unit in ADMIN_ONLINE_UNITS)) return null;
  const ms = Number(amount) * ADMIN_ONLINE_UNITS[unit as AdminOnlineUnit].ms;
  return ms >= ADMIN_ONLINE_MIN_MS && ms <= ADMIN_ONLINE_MAX_MS ? ms : null;
}

/** В сети (в том числе «занят») — клиент может выбрать эксперта и написать ему. */
export function isOnline(e: Pick<Expert, "online" | "onlineUntil">, now: Date): boolean {
  return e.online || (e.onlineUntil !== null && e.onlineUntil.getTime() > now.getTime());
}

export const EXPERT_STATUSES = ["online", "busy", "offline"] as const;
export type ExpertStatus = (typeof EXPERT_STATUSES)[number];

export function expertStatus(e: Pick<Expert, "online" | "onlineUntil" | "busy">, now: Date): ExpertStatus {
  if (!isOnline(e, now)) return "offline";
  return e.busy ? "busy" : "online";
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
  busy: experts.busy,
  active: experts.active,
  sort: experts.sort,
  createdAt: experts.createdAt,
  deletedAt: experts.deletedAt,
  rating: experts.rating,
};

/** Эксперты без удалённых. */
export function listExperts(db: Db): Promise<PublicExpert[]> {
  return db
    .select(publicColumns)
    .from(experts)
    .where(isNull(experts.deletedAt))
    .orderBy(asc(experts.sort), asc(experts.id));
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
    .values({ name, login, passwordHash: await hashPassword(input.password), rating: newExpertRating() })
    .returning({ id: experts.id });
  return { ok: true, id: (e as { id: number }).id };
}

// --- Рейтинг: в десятых (48 = 4,8), задаётся в админке ---

export const MIN_RATING = 10;
export const MAX_RATING = 50;

/** Рейтинг нового эксперта — случайный от 4,6 до 4,9; потом его можно поменять в админке. */
export function newExpertRating(): number {
  return randomInt(46, 50);
}

/** «4,8» из 48. */
export function formatRating(tenths: number): string {
  return (tenths / 10).toFixed(1).replace(".", ",");
}

/** Рейтинг из формы («4,8» или «4.8») в десятых; вне 1,0–5,0 или не число — null. */
export function parseRating(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!/^\d(\.\d)?$/.test(s)) return null;
  const tenths = Math.round(Number(s) * 10);
  return tenths >= MIN_RATING && tenths <= MAX_RATING ? tenths : null;
}

export async function setExpertPassword(db: Db, id: number, password: string): Promise<string | null> {
  if (password.length < MIN_EXPERT_PASSWORD) return `Пароль — не короче ${MIN_EXPERT_PASSWORD} символов`;
  await db.update(experts).set({ passwordHash: await hashPassword(password) }).where(eq(experts.id, id));
  return null;
}

/**
 * Удаление эксперта: выключен навсегда (не входит, не виден клиентам и в списках), логин освобождается
 * для нового эксперта. Строка в базе остаётся — на неё ссылаются его чаты и сообщения.
 */
export async function deleteExpert(db: Db, id: number, now: Date): Promise<boolean> {
  const [e] = await db
    .select({ login: experts.login })
    .from(experts)
    .where(and(eq(experts.id, id), isNull(experts.deletedAt)));
  if (!e) return false;
  await db
    .update(experts)
    .set({
      deletedAt: now,
      active: false,
      online: false,
      busy: false,
      onlineUntil: null,
      login: `deleted-${id}-${e.login}`,
    })
    .where(eq(experts.id, id));
  return true;
}

/** Отметка «эксперт на месте» — при каждом обращении к панели. */
export async function touchExpert(db: Db, id: number, now: Date): Promise<void> {
  await db.update(experts).set({ lastSeenAt: now }).where(eq(experts.id, id));
}

/**
 * Статус, который выбрал эксперт в панели (или админ — «навсегда» и «выключить»).
 * «В сети» и «занят» держатся, пока их не сменят; «не в сети» снимает и включение админом на срок.
 */
export async function setExpertStatus(db: Db, id: number, status: ExpertStatus, now: Date): Promise<void> {
  await db
    .update(experts)
    .set(
      status === "offline"
        ? { online: false, busy: false, onlineUntil: null, lastSeenAt: now }
        : { online: true, busy: status === "busy", lastSeenAt: now },
    )
    .where(eq(experts.id, id));
}

/** Включить или выключить «в сети» (вход и выход из панели, тесты). */
export function setExpertOnline(db: Db, id: number, online: boolean, now: Date): Promise<void> {
  return setExpertStatus(db, id, online ? "online" : "offline", now);
}

/** Админ: «в сети» на forMs или выключить совсем (forMs = null). */
export async function setOnlineByAdmin(db: Db, id: number, forMs: number | null, now: Date): Promise<void> {
  if (forMs === null) return setExpertStatus(db, id, "offline", now);
  await db
    .update(experts)
    .set({ onlineUntil: new Date(now.getTime() + forMs) })
    .where(eq(experts.id, id));
}

/** Админ отмечает «занят» / «свободен», не меняя, как и на сколько эксперт в сети. */
export async function setExpertBusy(db: Db, id: number, busy: boolean): Promise<void> {
  await db.update(experts).set({ busy }).where(eq(experts.id, id));
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
