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

/** Добавить сертификат. Строка — ошибка для админа, null — готово. */
export async function addCertificate(db: Db, expertId: number, title: string, data: Buffer): Promise<string | null> {
  if (data.length === 0) return "Выберите картинку сертификата";
  if (data.length > MAX_CERTIFICATE_BYTES) return "Картинка больше 5 МБ";
  const mime = detectImageMime(data);
  if (!mime) return "Сертификат — картинка JPEG, PNG или WebP";
  const t = title.trim();
  if (t.length > MAX_CERTIFICATE_TITLE) return `Подпись длиннее ${MAX_CERTIFICATE_TITLE} символов`;
  await db.insert(expertCertificates).values({ expertId, title: t, mime, data });
  return null;
}

export async function deleteCertificate(db: Db, expertId: number, id: number): Promise<void> {
  await db.delete(expertCertificates).where(and(eq(expertCertificates.id, id), eq(expertCertificates.expertId, expertId)));
}
