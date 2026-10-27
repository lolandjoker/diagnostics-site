/**
 * Фото эксперта: главное (expert_photos — оно же на аватарке) и дополнительные (expert_gallery_photos).
 * В профиле и мини-профиле у чата листаются по порядку: главное, затем дополнительные.
 * Дополнительное можно сделать главным — тогда прежнее главное встаёт на его место.
 */
import { and, asc, eq, max } from "drizzle-orm";
import type { Db } from "@/db";
import { expertGalleryPhotos, expertPhotos } from "@/db/schema";
import { detectImageMime, getExpertPhoto } from "./experts";

export const MAX_GALLERY_PHOTOS = 10;
export const MAX_GALLERY_PHOTO_BYTES = 5 * 1024 * 1024;

export interface GalleryPhoto {
  id: number;
  url: string;
}

/** Дополнительные фото без самих картинок — адреса для <img>. Адрес не меняется: фото не правится, только удаляется. */
export async function listGallery(db: Db, expertId: number): Promise<GalleryPhoto[]> {
  const rows = await db
    .select({ id: expertGalleryPhotos.id })
    .from(expertGalleryPhotos)
    .where(eq(expertGalleryPhotos.expertId, expertId))
    .orderBy(asc(expertGalleryPhotos.sort), asc(expertGalleryPhotos.id));
  return rows.map((r) => ({ id: r.id, url: `/experts/${expertId}/gallery/${r.id}` }));
}

/** Все фото для листания: главное (если есть), затем дополнительные. */
export async function expertGallery(db: Db, expertId: number, mainUrl: string | null): Promise<string[]> {
  const extra = await listGallery(db, expertId);
  return [...(mainUrl ? [mainUrl] : []), ...extra.map((p) => p.url)];
}

export async function getGalleryPhoto(db: Db, expertId: number, id: number) {
  const [p] = await db
    .select({ mime: expertGalleryPhotos.mime, data: expertGalleryPhotos.data, sort: expertGalleryPhotos.sort })
    .from(expertGalleryPhotos)
    .where(and(eq(expertGalleryPhotos.id, id), eq(expertGalleryPhotos.expertId, expertId)));
  return p ?? null;
}

/**
 * Добавить сразу несколько фото. Сначала проверяются все: если хоть одно не подходит —
 * не добавляется ни одно (строка — ошибка для админа), иначе null.
 */
export async function addGalleryPhotos(db: Db, expertId: number, files: Buffer[]): Promise<string | null> {
  if (files.length === 0) return "Выберите фото";
  const items: { mime: string; data: Buffer }[] = [];
  for (const [i, data] of files.entries()) {
    const n = files.length > 1 ? ` (файл ${i + 1})` : "";
    if (data.length === 0) return `Пустой файл${n}`;
    if (data.length > MAX_GALLERY_PHOTO_BYTES) return `Фото больше 5 МБ${n}`;
    const mime = detectImageMime(data);
    if (!mime) return `Фото должно быть в формате JPEG, PNG или WebP${n}`;
    items.push({ mime, data });
  }
  const have = (await listGallery(db, expertId)).length;
  if (have + items.length > MAX_GALLERY_PHOTOS) {
    return `Дополнительных фото может быть не больше ${MAX_GALLERY_PHOTOS}, сейчас ${have} — можно добавить ещё ${Math.max(0, MAX_GALLERY_PHOTOS - have)}`;
  }
  const [last] = await db
    .select({ sort: max(expertGalleryPhotos.sort) })
    .from(expertGalleryPhotos)
    .where(eq(expertGalleryPhotos.expertId, expertId));
  const start = (last?.sort ?? 0) + 1;
  await db.insert(expertGalleryPhotos).values(items.map((it, i) => ({ expertId, ...it, sort: start + i })));
  return null;
}

export async function deleteGalleryPhoto(db: Db, expertId: number, id: number): Promise<void> {
  await db.delete(expertGalleryPhotos).where(and(eq(expertGalleryPhotos.id, id), eq(expertGalleryPhotos.expertId, expertId)));
}

/** Сделать дополнительное фото главным; прежнее главное встаёт на его место среди дополнительных. */
export async function makeMainPhoto(db: Db, expertId: number, id: number): Promise<void> {
  const photo = await getGalleryPhoto(db, expertId, id);
  if (!photo) return;
  const main = await getExpertPhoto(db, expertId);
  await db.transaction(async (tx) => {
    await tx.delete(expertGalleryPhotos).where(eq(expertGalleryPhotos.id, id));
    if (main) await tx.insert(expertGalleryPhotos).values({ expertId, mime: main.mime, data: main.data, sort: photo.sort });
    await tx
      .insert(expertPhotos)
      .values({ expertId, mime: photo.mime, data: photo.data })
      .onConflictDoUpdate({ target: expertPhotos.expertId, set: { mime: photo.mime, data: photo.data, updatedAt: new Date() } });
  });
}

/** Удалить главное фото: его место занимает первое дополнительное, если оно есть. */
export async function deleteMainPhoto(db: Db, expertId: number): Promise<void> {
  if (!(await getExpertPhoto(db, expertId))) return;
  const [next] = await listGallery(db, expertId);
  const photo = next ? await getGalleryPhoto(db, expertId, next.id) : null;
  if (!next || !photo) {
    await db.delete(expertPhotos).where(eq(expertPhotos.expertId, expertId));
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(expertGalleryPhotos).where(eq(expertGalleryPhotos.id, next.id));
    await tx
      .update(expertPhotos)
      .set({ mime: photo.mime, data: photo.data, updatedAt: new Date() })
      .where(eq(expertPhotos.expertId, expertId));
  });
}
