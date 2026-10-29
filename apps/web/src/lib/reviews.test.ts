import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { startConversation } from "./chat";
import type { Conversation } from "./chat";
import { createExpert, formatRating, getExpert, parseRating, parseReviewsShown, setExpertOnline } from "./experts";
import { pageNumbers } from "./pagination";
import { createLead } from "./leads";
import {
  MAX_REVIEWS_ON_CARD,
  addReview,
  deleteReviews,
  expertReviews,
  listAllReviews,
  reviewForConversation,
  reviewsCount,
  reviewsCountLabel,
  saveReview,
  setReviewBody,
  setReviewHidden,
} from "./reviews";

let db: Db;
let expertId: number;

beforeEach(async () => {
  db = await createTestDb();
  const res = await createExpert(db, { name: "Мария", login: "maria", password: "пароль-эксперта" });
  if (!res.ok) throw new Error(res.error);
  expertId = res.id;
  await setExpertOnline(db, expertId, true, new Date());
});

async function chat(name = "Анна"): Promise<Conversation> {
  const lead = await createLead(db, { name, birthDate: "1990-03-15" }, new Date(), null);
  const c = await startConversation(db, lead, expertId, new Date());
  if (!c.ok) throw new Error(c.error);
  return c.conversation;
}

describe("отзывы", () => {
  it("один на чат: повторный — правка, имя клиента из заявки", async () => {
    const c = await chat("Анна");
    expect(await saveReview(db, c, { stars: 5, body: " Очень помогла " }, new Date())).toEqual({ ok: true });
    expect(await saveReview(db, c, { stars: 4, body: "Помогла" }, new Date())).toEqual({ ok: true });
    expect(await reviewForConversation(db, c.id)).toMatchObject({ stars: 4, body: "Помогла", authorName: "Анна", expertId });
    expect(await listAllReviews(db)).toHaveLength(1);
  });

  it("оценка только 1–5 целым, текст не длиннее 2000", async () => {
    const c = await chat();
    for (const stars of [0, 6, 4.5, Number.NaN]) {
      expect(await saveReview(db, c, { stars, body: "" }, new Date())).toMatchObject({ ok: false });
    }
    expect(await saveReview(db, c, { stars: 5, body: "я".repeat(2001) }, new Date())).toMatchObject({ ok: false });
    expect(await saveReview(db, c, { stars: 3, body: "" }, new Date())).toEqual({ ok: true });
  });

  it("на карточке — только видимые, свежие сверху; скрыть и удалить", async () => {
    for (let i = 0; i < 7; i++) {
      await saveReview(db, await chat(`Клиент ${i}`), { stars: 5, body: `отзыв ${i}` }, new Date(Date.now() + i * 1000));
    }
    let card = (await expertReviews(db, [expertId])).get(expertId)!;
    expect(card.count).toBe(7);
    expect(card.latest).toHaveLength(7);
    expect(card.latest[0]?.body).toBe("отзыв 6");

    const [newest] = await listAllReviews(db);
    await setReviewHidden(db, newest!.id, true);
    card = (await expertReviews(db, [expertId])).get(expertId)!;
    expect(card.count).toBe(6);
    expect(card.latest.map((r) => r.id)).not.toContain(newest!.id);

    const [, second, third] = await listAllReviews(db);
    expect(await setReviewBody(db, second!.id, "  Новый текст \r\nотзыва ")).toBeNull();
    expect(await setReviewBody(db, second!.id, "я".repeat(2001))).not.toBeNull();
    expect((await listAllReviews(db)).find((r) => r.id === second!.id)).toMatchObject({ body: "Новый текст \nотзыва", stars: 5 });

    await deleteReviews(db, [newest!.id]);
    expect(await listAllReviews(db)).toHaveLength(6);
    await deleteReviews(db, [second!.id, third!.id]);
    expect(await listAllReviews(db)).toHaveLength(4);
    expect((await expertReviews(db, [])).size).toBe(0);
  });

  it("на карточке — последние MAX_REVIEWS_ON_CARD, число — все видимые плюс с других площадок", async () => {
    for (let i = 0; i < 19; i++) {
      await saveReview(db, await chat(`Клиент ${i}`), { stars: 5, body: `отзыв ${i}` }, new Date(Date.now() + i * 1000));
    }
    const card = (await expertReviews(db, [expertId])).get(expertId)!;
    expect(card.latest).toHaveLength(MAX_REVIEWS_ON_CARD);
    expect(card.latest[0]?.body).toBe("отзыв 18");
    expect(card.count).toBe(19);
    expect(reviewsCount(300, card.count)).toEqual({ total: 319, elsewhere: 300 });
    expect(reviewsCount(0, 5)).toEqual({ total: 5, elsewhere: 0 });
  });

  it("отзыв из админки: без чата, с заданными именем и датой; фильтр по эксперту", async () => {
    const other = await createExpert(db, { name: "Ольга", login: "olga", password: "пароль-эксперта" });
    if (!other.ok) throw new Error(other.error);
    const when = new Date("2026-05-01T09:00:00Z");
    expect(await addReview(db, { expertId, authorName: " Ирина ", stars: 4, body: "Хорошо", createdAt: when })).toEqual({ ok: true });
    expect(await addReview(db, { expertId: other.id, authorName: "Олег", stars: 5, body: "", createdAt: when })).toEqual({ ok: true });
    const mine = await listAllReviews(db, expertId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ authorName: "Ирина", stars: 4, conversationId: null, createdAt: when });
    expect(await listAllReviews(db)).toHaveLength(2);

    expect(await addReview(db, { expertId, authorName: "", stars: 5, body: "", createdAt: when })).toMatchObject({ ok: false });
    expect(await addReview(db, { expertId, authorName: "А", stars: 6, body: "", createdAt: when })).toMatchObject({ ok: false });
    expect(await addReview(db, { expertId: 999_999, authorName: "А", stars: 5, body: "", createdAt: when })).toMatchObject({ ok: false });
    expect(await addReview(db, { expertId, authorName: "А", stars: 5, body: "", createdAt: new Date("x") })).toMatchObject({ ok: false });
  });

  it("страницы: первая, последняя и соседние с текущей", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageNumbers(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageNumbers(10, 10)).toEqual([1, null, 9, 10]);
  });

  it("подпись числа отзывов", () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 101, 111].map(reviewsCountLabel)).toEqual([
      "1 отзыв",
      "2 отзыва",
      "5 отзывов",
      "11 отзывов",
      "12 отзывов",
      "21 отзыв",
      "22 отзыва",
      "25 отзывов",
      "101 отзыв",
      "111 отзывов",
    ]);
  });
});

describe("рейтинг", () => {
  it("новому эксперту — рейтинг от 4,6 до 4,9 и 0 отзывов с других площадок", async () => {
    for (let i = 0; i < 12; i++) {
      const res = await createExpert(db, { name: `Э${i}`, login: `expert${i}`, password: "пароль-эксперта" });
      if (!res.ok) throw new Error(res.error);
      const e = (await getExpert(db, res.id))!;
      expect(e.rating).toBeGreaterThanOrEqual(46);
      expect(e.rating).toBeLessThanOrEqual(49);
      expect(e.reviewsShown).toBe(0);
    }
    expect(parseReviewsShown("347")).toBe(347);
    expect(parseReviewsShown("0")).toBe(0);
    expect(parseReviewsShown("-1")).toBeNull();
    expect(parseReviewsShown("3,5")).toBeNull();
    expect(parseReviewsShown("100001")).toBeNull();
  });

  it("показ «4,8» и разбор из формы", () => {
    expect(formatRating(48)).toBe("4,8");
    expect(formatRating(50)).toBe("5,0");
    expect(parseRating("4,7")).toBe(47);
    expect(parseRating(" 4.9 ")).toBe(49);
    expect(parseRating("5")).toBe(50);
    expect(parseRating("5,1")).toBeNull();
    expect(parseRating("0,9")).toBeNull();
    expect(parseRating("4,75")).toBeNull();
    expect(parseRating("abc")).toBeNull();
  });
});
