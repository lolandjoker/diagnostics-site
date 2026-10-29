/**
 * Отзывы об экспертах. Клиент оставляет отзыв в своём чате — один на чат, может поправить; отзыв сразу
 * виден на карточке эксперта с именем клиента из заявки (форма об этом предупреждает). Админ и эксперты
 * в разделе «Отзывы» добавляют отзывы (без чата), правят текст, скрывают и удаляют.
 * Число отзывов на карточке — отзывы с сайта плюс отзывы эксперта с других площадок (поле reviewsShown,
 * задаёт админ). В профиле так и подписано: «из них N — с других площадок».
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { experts, leads, reviews } from "@/db/schema";
import type { Conversation } from "./chat";

export type Review = typeof reviews.$inferSelect;

export const MAX_REVIEW_LENGTH = 2000;
/** Отзывов на странице в списке на карточке эксперта. */
export const REVIEWS_PAGE_SIZE = 5;
/** Сколько последних отзывов показывать на карточке (листаются по REVIEWS_PAGE_SIZE). */
export const MAX_REVIEWS_ON_CARD = 15;

export async function reviewForConversation(db: Db, conversationId: string): Promise<Review | null> {
  const [r] = await db.select().from(reviews).where(eq(reviews.conversationId, conversationId));
  return r ?? null;
}

export type SaveReviewResult = { ok: true } | { ok: false; error: string };

/** Отзыв клиента из чата: новый или правка прежнего. Скрытый админом при правке остаётся скрытым. */
export async function saveReview(
  db: Db,
  conversation: Conversation,
  input: { stars: number; body: string },
  now: Date,
): Promise<SaveReviewResult> {
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) return { ok: false, error: "Поставьте от 1 до 5 звёзд" };
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (body.length > MAX_REVIEW_LENGTH) return { ok: false, error: `Отзыв длиннее ${MAX_REVIEW_LENGTH} символов` };
  const [lead] = await db.select({ name: leads.name }).from(leads).where(eq(leads.id, conversation.leadId));
  await db
    .insert(reviews)
    .values({
      conversationId: conversation.id,
      expertId: conversation.expertId,
      authorName: lead?.name ?? "Клиент",
      stars: input.stars,
      body,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({ target: reviews.conversationId, set: { stars: input.stars, body, updatedAt: now } });
  return { ok: true };
}

export interface PublicReview {
  id: number;
  authorName: string;
  stars: number;
  body: string;
  createdAt: string;
}

/** Видимые отзывы для карточек экспертов: эксперт → число видимых и последние MAX_REVIEWS_ON_CARD, свежие сверху. */
export async function expertReviews(db: Db, expertIds: number[]): Promise<Map<number, { count: number; latest: PublicReview[] }>> {
  const out = new Map<number, { count: number; latest: PublicReview[] }>();
  if (expertIds.length === 0) return out;
  const rows = await db
    .select({
      id: reviews.id,
      expertId: reviews.expertId,
      authorName: reviews.authorName,
      stars: reviews.stars,
      body: reviews.body,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(and(inArray(reviews.expertId, expertIds), eq(reviews.hidden, false)))
    .orderBy(desc(reviews.createdAt));
  for (const r of rows) {
    const e = out.get(r.expertId) ?? { count: 0, latest: [] };
    e.count += 1;
    if (e.latest.length < MAX_REVIEWS_ON_CARD) {
      e.latest.push({ id: r.id, authorName: r.authorName, stars: r.stars, body: r.body, createdAt: r.createdAt.toISOString() });
    }
    out.set(r.expertId, e);
  }
  return out;
}

/** Отзывы для админки и экспертов, свежие сверху; expertId — только этого эксперта. */
export function listAllReviews(db: Db, expertId?: number) {
  return db
    .select({
      id: reviews.id,
      conversationId: reviews.conversationId,
      expertId: reviews.expertId,
      expertName: experts.name,
      authorName: reviews.authorName,
      stars: reviews.stars,
      body: reviews.body,
      hidden: reviews.hidden,
      createdAt: reviews.createdAt,
      updatedAt: reviews.updatedAt,
    })
    .from(reviews)
    .innerJoin(experts, eq(experts.id, reviews.expertId))
    .where(expertId === undefined ? undefined : eq(reviews.expertId, expertId))
    .orderBy(desc(reviews.createdAt))
    .limit(1000);
}

export type AddReviewInput = { expertId: number; authorName: string; stars: number; body: string; createdAt: Date };

/** Отзыв, добавленный в админке: без чата, с заданными именем автора и датой. */
export async function addReview(db: Db, input: AddReviewInput): Promise<SaveReviewResult> {
  const authorName = input.authorName.trim();
  if (authorName === "" || authorName.length > 60) return { ok: false, error: "Укажите имя автора (до 60 символов)" };
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) return { ok: false, error: "Поставьте от 1 до 5 звёзд" };
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (body.length > MAX_REVIEW_LENGTH) return { ok: false, error: `Отзыв длиннее ${MAX_REVIEW_LENGTH} символов` };
  if (Number.isNaN(input.createdAt.getTime())) return { ok: false, error: "Неверная дата" };
  const [expert] = await db.select({ id: experts.id }).from(experts).where(eq(experts.id, input.expertId));
  if (!expert) return { ok: false, error: "Эксперт не найден" };
  await db.insert(reviews).values({
    expertId: input.expertId,
    authorName,
    stars: input.stars,
    body,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  return { ok: true };
}

export async function setReviewHidden(db: Db, id: number, hidden: boolean): Promise<void> {
  await db.update(reviews).set({ hidden }).where(eq(reviews.id, id));
}

/** Админ поправил текст отзыва. Звёзды, автор и дата остаются прежними. Ошибка — текст для человека. */
export async function setReviewBody(db: Db, id: number, input: string): Promise<string | null> {
  const body = input.replace(/\r\n/g, "\n").trim();
  if (body.length > MAX_REVIEW_LENGTH) return `Отзыв длиннее ${MAX_REVIEW_LENGTH} символов`;
  await db.update(reviews).set({ body, updatedAt: new Date() }).where(eq(reviews.id, id));
  return null;
}

/** Удаление насовсем — одного отзыва или всех отмеченных в списке. */
export async function deleteReviews(db: Db, ids: number[]): Promise<void> {
  if (ids.length > 0) await db.delete(reviews).where(inArray(reviews.id, ids));
}

/** Отзывы эксперта для карточки: всего (с сайта + с других площадок) и сколько из них с других площадок. */
export interface ReviewsCount {
  total: number;
  elsewhere: number;
}

export function reviewsCount(elsewhere: number, onSite: number): ReviewsCount {
  return { total: elsewhere + onSite, elsewhere };
}

/** «3 отзыва», «5 отзывов», «1 отзыв». */
export function reviewsCountLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "отзыв" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "отзыва" : "отзывов";
  return `${n} ${word}`;
}

