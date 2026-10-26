import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { startConversation } from "./chat";
import type { Conversation } from "./chat";
import { createExpert, formatRating, getExpert, parseRating, setExpertOnline } from "./experts";
import { createLead } from "./leads";
import {
  REVIEWS_ON_CARD,
  deleteReview,
  expertReviews,
  listAllReviews,
  reviewForConversation,
  reviewsCountLabel,
  saveReview,
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

  it("на карточке — только видимые, свежие сверху, не больше REVIEWS_ON_CARD; скрыть и удалить", async () => {
    for (let i = 0; i < REVIEWS_ON_CARD + 2; i++) {
      await saveReview(db, await chat(`Клиент ${i}`), { stars: 5, body: `отзыв ${i}` }, new Date(Date.now() + i * 1000));
    }
    let card = (await expertReviews(db, [expertId])).get(expertId)!;
    expect(card.count).toBe(REVIEWS_ON_CARD + 2);
    expect(card.latest).toHaveLength(REVIEWS_ON_CARD);
    expect(card.latest[0]?.body).toBe(`отзыв ${REVIEWS_ON_CARD + 1}`);

    const [newest] = await listAllReviews(db);
    await setReviewHidden(db, newest!.id, true);
    card = (await expertReviews(db, [expertId])).get(expertId)!;
    expect(card.count).toBe(REVIEWS_ON_CARD + 1);
    expect(card.latest.map((r) => r.id)).not.toContain(newest!.id);

    await deleteReview(db, newest!.id);
    expect(await listAllReviews(db)).toHaveLength(REVIEWS_ON_CARD + 1);
    expect((await expertReviews(db, [])).size).toBe(0);
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
  it("новому эксперту — от 4,6 до 4,9", async () => {
    for (let i = 0; i < 12; i++) {
      const res = await createExpert(db, { name: `Э${i}`, login: `expert${i}`, password: "пароль-эксперта" });
      if (!res.ok) throw new Error(res.error);
      const rating = (await getExpert(db, res.id))!.rating;
      expect(rating).toBeGreaterThanOrEqual(46);
      expect(rating).toBeLessThanOrEqual(49);
    }
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
