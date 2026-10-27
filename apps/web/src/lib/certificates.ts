/**
 * Сертификаты эксперта: картинки (JPEG, PNG, WebP до MAX_CERTIFICATE_BYTES) с подписью.
 * Видны в профиле эксперта; загружает и удаляет админ (и эксперты — у них права админа).
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { expertCertificates } from "@/db/schema";
import { detectImageMime } from "./experts";

export const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024;
export const MAX_CERTIFICATE_TITLE = 120;

export interface CertificateView {
  id: number;
  title: string;
  url: string;
}

/** Сертификаты эксперта без самих картинок — адреса для <img>. */
export async function listCertificates(db: Db, expertId: number): Promise<CertificateView[]> {
  const rows = await db
    .select({ id: expertCertificates.id, title: expertCertificates.title })
    .from(expertCertificates)
    .where(eq(expertCertificates.expertId, expertId))
    .orderBy(asc(expertCertificates.sort), asc(expertCertificates.id));
  return rows.map((r) => ({ ...r, url: `/experts/${expertId}/certificates/${r.id}` }));
}

export async function getCertificate(db: Db, expertId: number, id: number) {
  const [c] = await db
    .select({ mime: expertCertificates.mime, data: expertCertificates.data })
    .from(expertCertificates)
    .where(and(eq(expertCertificates.id, id), eq(expertCertificates.expertId, expertId)));
  return c ?? null;
}

/** Не больше стольких файлов за одну загрузку — чтобы запрос не вышел за лимит размера. */
export const MAX_CERTIFICATES_PER_UPLOAD = 10;

/**
 * Добавить один или несколько сертификатов с одной подписью (потом её можно поправить у каждого).
 * Сначала проверяются все файлы: если хоть один не подходит — не добавляется ни один.
 * Строка — ошибка для админа, null — готово.
 */
export async function addCertificates(db: Db, expertId: number, title: string, files: Buffer[]): Promise<string | null> {
  if (files.length === 0) return "Выберите картинку сертификата";
  if (files.length > MAX_CERTIFICATES_PER_UPLOAD) return `За раз — не больше ${MAX_CERTIFICATES_PER_UPLOAD} файлов`;
  const t = title.trim();
  if (t.length > MAX_CERTIFICATE_TITLE) return `Подпись длиннее ${MAX_CERTIFICATE_TITLE} символов`;
  const items: { mime: string; data: Buffer }[] = [];
  for (const [i, data] of files.entries()) {
    const n = files.length > 1 ? ` (файл ${i + 1})` : "";
    if (data.length === 0) return `Пустой файл${n}`;
    if (data.length > MAX_CERTIFICATE_BYTES) return `Картинка больше 5 МБ${n}`;
    const mime = detectImageMime(data);
    if (!mime) return `Сертификат — картинка JPEG, PNG или WebP${n}`;
    items.push({ mime, data });
  }
  await db.insert(expertCertificates).values(items.map((it) => ({ expertId, title: t, ...it })));
  return null;
}

/** Добавить один сертификат. */
export function addCertificate(db: Db, expertId: number, title: string, data: Buffer): Promise<string | null> {
  return addCertificates(db, expertId, title, [data]);
}

/** Поправить подпись сертификата. Строка — ошибка, null — готово. */
export async function setCertificateTitle(db: Db, expertId: number, id: number, title: string): Promise<string | null> {
  const t = title.trim();
  if (t.length > MAX_CERTIFICATE_TITLE) return `Подпись длиннее ${MAX_CERTIFICATE_TITLE} символов`;
  await db
    .update(expertCertificates)
    .set({ title: t })
    .where(and(eq(expertCertificates.id, id), eq(expertCertificates.expertId, expertId)));
  return null;
}

export async function deleteCertificate(db: Db, expertId: number, id: number): Promise<void> {
  await db.delete(expertCertificates).where(and(eq(expertCertificates.id, id), eq(expertCertificates.expertId, expertId)));
}
