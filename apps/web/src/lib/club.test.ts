import { eq } from "drizzle-orm";
import type { Mock } from "vitest";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { dailyCards, telegramUsers } from "@/db/schema";
import { ARCANA } from "./arcana";
import { handleForecastCallback, joinClub, sendForecasts, sendMorningCard } from "./bot-forecast";
import { cardStreak, cardView, daysLabel, drawDailyCard, recentDays, todayCard } from "./club";
import { createLead } from "./leads";

const TOKEN = "123456789:AAHtestTOKENtestTOKENtestTOKENtest12";
const cfg = { token: TOKEN, siteUrl: "https://example.com" };
const realFetch = globalThis.fetch;
const day = 24 * 60 * 60 * 1000;
// 11:00 по Москве
const morning = new Date("2026-11-05T08:00:00Z");

describe("карта дня", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("одна карта в день; без ИИ — запасная расшифровка; без Telegram текст не отдаём", async () => {
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null);
    expect(await drawDailyCard(db, lead.id, 0, morning)).toBeNull();
    expect(await drawDailyCard(db, lead.id, 6, morning)).toBeNull();
    const first = await drawDailyCard(db, lead.id, 3, morning);
    expect(first).toMatchObject({ position: 3, day: "2026-11-05", model: null });
    expect(first!.text).toBe(ARCANA[first!.card]!.advice);
    // Второй раз за день — та же карта, перетянуть нельзя
    const again = await drawDailyCard(db, lead.id, 1, new Date(morning.getTime() + 3600_000));
    expect(again).toMatchObject({ card: first!.card, position: 3 });
    expect(await db.select().from(dailyCards)).toHaveLength(1);

    // 15.03.1990, 05.11.2026 — личный день 8
    expect(cardView(first!, false, "1990-03-15")).toEqual({ card: first!.card, position: 3, day: 8, sections: null });
    const c = ARCANA[first!.card]!;
    expect(cardView(first!, true, "1990-03-15").sections).toEqual({
      main: c.advice,
      love: c.love,
      work: c.work,
      tip: c.tip,
      teaser: `«${c.name}» в ваш личный день 8 — сочетание, которое стоит разобрать подробнее. Что именно оно значит для вас в ближайшие недели, можно понять только по вашей дате рождения.`,
    });
  });

  it("серия — дни подряд по сегодня (или по вчера, если сегодня ещё не тянули)", async () => {
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null);
    for (const d of [3, 2, 1]) await drawDailyCard(db, lead.id, 1, new Date(morning.getTime() - d * day));
    expect(await cardStreak(db, lead.id, morning)).toBe(3);
    expect(await recentDays(db, lead.id, morning, 5)).toEqual([false, true, true, true, false]);
    await drawDailyCard(db, lead.id, 2, morning);
    expect(await cardStreak(db, lead.id, morning)).toBe(4);
    // Пропустил день — серия заново
    expect(await cardStreak(db, lead.id, new Date(morning.getTime() + 2 * day))).toBe(0);
    expect([1, 2, 5, 11, 21, 22].map(daysLabel)).toEqual(["1 день", "2 дня", "5 дней", "11 дней", "21 день", "22 дня"]);
  });
});

describe("карта дня в боте", () => {
  let db: Db;
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
  let nextId = 900;
  const TG = 6001;

  beforeEach(async () => {
    db = await createTestDb();
    nextId = 900;
    fetchMock = vi.fn(async (url: string) => {
      const method = String(url).split("/").pop();
      const result =
        method === "sendPhoto" ? { message_id: ++nextId, photo: [{ file_id: `ph-${nextId}` }] } : method === "sendMessage" ? { message_id: ++nextId } : true;
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("SITE_DOMAIN", "example.com");
    vi.stubGlobal("fetch", (url: unknown, init?: RequestInit) =>
      String(url).startsWith("https://api.telegram.org/") ? fetchMock(String(url), init) : realFetch(url as string, init),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const calls = () =>
    fetchMock.mock.calls
      .filter(([url]) => !/\/(getMe|getStickerSet)$/.test(String(url)))
      .map(([url, init]) => {
        const raw = (init as RequestInit).body;
        const body: Record<string, unknown> = {};
        if (raw instanceof FormData) {
          for (const [k, v] of raw.entries()) body[k] = typeof v === "string" ? (/^[[{]/.test(v) ? JSON.parse(v) : v) : "<file>";
        } else Object.assign(body, JSON.parse(String(raw)));
        return { method: String(url).split("/").pop(), body };
      });

  it("утром — пять рубашек и кнопки 1–5; нажал — карта с расшифровкой; повторно утром не беспокоим", async () => {
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null, TG);
    await db.insert(telegramUsers).values({ telegramUserId: TG, forecast: true });

    expect(await sendForecasts(db, new Date("2026-11-05T05:00:00Z"))).toBe(0); // 08:00 по Москве — рано
    expect(await sendForecasts(db, morning)).toBe(1);
    const prompt = calls()[0]!;
    expect(prompt.method).toBe("sendPhoto");
    expect(prompt.body.caption).toContain("<b>Анна, доброе утро!</b>");
    const kb = (prompt.body.reply_markup as { inline_keyboard: { text: string; callback_data?: string; web_app?: { url: string } }[][] }).inline_keyboard;
    expect(kb[0]!.map((b) => b.callback_data)).toEqual(["cd:1", "cd:2", "cd:3", "cd:4", "cd:5"]);
    expect(kb[1]![0]!.web_app?.url).toBe(`https://example.com/razbor/${lead.id}/den`);
    expect(await sendForecasts(db, new Date(morning.getTime() + 3600_000))).toBe(0);

    await handleForecastCallback(db, cfg, { id: "q", userId: TG, chatId: TG, messageId: 901, data: "cd:4" }, morning);
    const row = await todayCard(db, lead.id, morning);
    expect(row).toMatchObject({ position: 4 });
    const sent = calls();
    expect(sent.find((c) => c.method === "answerCallbackQuery")?.body.text).toBe("Открываю карту…");
    const reading = sent.filter((c) => c.method === "sendPhoto").at(-1)!;
    expect(reading.body.caption).toContain(`<b>${ARCANA[row!.card]!.n} · ${ARCANA[row!.card]!.name}</b>`);
    expect(reading.body.caption).toContain(ARCANA[row!.card]!.advice);
    expect(reading.body.caption).toContain(`<b>В любви.</b> ${ARCANA[row!.card]!.love}`);
    expect(reading.body.caption).toContain("<b>Что карта скрывает.</b>");

    // Уже тянул сегодня — утреннее сообщение не нужно
    expect(await sendMorningCard(db, cfg, TG, morning)).toBe(false);
  });

  it("вступил в клуб с сайта: подписан, сегодняшняя карта с сайта приходит в бот", async () => {
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null, TG);
    const row = await drawDailyCard(db, lead.id, 2, morning);
    await joinClub(db, cfg, lead.id, morning);
    const [sub] = await db.select().from(telegramUsers).where(eq(telegramUsers.telegramUserId, TG));
    expect(sub).toMatchObject({ forecast: true, forecastSentOn: "2026-11-05" });
    const photo = calls().find((c) => c.method === "sendPhoto")!;
    expect(photo.body.caption).toContain("Ваша карта дня");
    expect(photo.body.caption).toContain(ARCANA[row!.card]!.name);
  });

  it("«Отписаться» под утренней картинкой — отписка", async () => {
    await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null, TG);
    await db.insert(telegramUsers).values({ telegramUserId: TG, forecast: true });
    await handleForecastCallback(db, cfg, { id: "q", userId: TG, chatId: TG, messageId: 5, data: "fc:0" }, morning);
    const [sub] = await db.select().from(telegramUsers).where(eq(telegramUsers.telegramUserId, TG));
    expect(sub?.forecast).toBe(false);
    expect(await sendForecasts(db, new Date(morning.getTime() + day))).toBe(0);
  });
});
