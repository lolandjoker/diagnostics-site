import type { Mock } from "vitest";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { clubQuizzes } from "@/db/schema";
import { deliverQuiz, sendPendingQuizzes } from "./bot-quizzes";
import { createLead } from "./leads";
import { ARCHETYPES, archetypeFor, archetypeView, runArchetype } from "./quiz-archetype";
import { compatScores, compatView, parseCompatInput, runCompat, zodiac } from "./quiz-compat";
import { archetypeStoryPng } from "./quiz-images";
import { CARD_ANSWER, cleanQuestion, isSensitiveQuestion, runYesNo, yesNoView } from "./quiz-yesno";
import { attemptsLeft, lifePath } from "./quizzes";

const TOKEN = "123456789:AAHtestTOKENtestTOKENtestTOKENtest12";
const cfg = { token: TOKEN, siteUrl: "https://example.com" };
const TG = 555001;
const realFetch = globalThis.fetch;
const morning = new Date("2026-11-05T08:00:00Z");

describe("квизы клуба", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("знаки зодиака и числа судьбы", () => {
    expect(["1990-03-15", "1990-03-21", "1990-04-19", "1990-12-22", "1990-01-19", "1990-01-20", "1990-02-19"].map((d) => zodiac(d).name)).toEqual([
      "Рыбы",
      "Овен",
      "Овен",
      "Козерог",
      "Козерог",
      "Водолей",
      "Рыбы",
    ]);
    expect(zodiac("1988-07-30")).toMatchObject({ name: "Лев", element: "огонь" });
    // 1+5+0+3+1+9+9+0 = 28 → 10 → 1
    expect(lifePath("1990-03-15")).toBe(1);
  });

  it("совместимость: одинаково в любом порядке, в пределах 52–98%", () => {
    const a = compatScores("1990-03-15", "1988-07-02");
    expect(compatScores("1988-07-02", "1990-03-15")).toEqual(a);
    for (const p of ["1985-01-01", "1999-06-30", "1979-11-11", "2001-09-09"]) {
      const s = compatScores("1990-03-15", p);
      for (const v of Object.values(s)) {
        expect(v).toBeGreaterThanOrEqual(52);
        expect(v).toBeLessThanOrEqual(98);
      }
    }
    expect(parseCompatInput("", "31.02.1990", morning)).toHaveProperty("error");
    expect(parseCompatInput("", "15.03.2015", morning)).toEqual({ error: "Совместимость считаем для партнёров старше 18 лет" });
    expect(parseCompatInput("  Иван  ", "2.7.1988", morning)).toEqual({ partnerName: "Иван", partnerBirth: "1988-07-02" });
  });

  it("совместимость без ИИ: заготовки; без Telegram проценты закрыты; лимит в день", async () => {
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null);
    const row = await runCompat(db, lead, { partnerName: "Иван", partnerBirth: "1988-07-02" }, morning);
    if ("error" in row) throw new Error(row.error);
    expect(row.model).toBeNull();
    const open = compatView(row, lead.birthDate, true)!;
    expect(open).toMatchObject({ partnerName: "Иван", self: { sign: "Рыбы" }, partner: { sign: "Рак" } });
    expect(open.result!.text.summary).toContain("Рыбы и Рак");
    expect(compatView(row, lead.birthDate, false)!.result).toBeNull();

    for (let i = 0; i < 4; i++) await runCompat(db, lead, { partnerName: "", partnerBirth: "1985-01-01" }, morning);
    expect(await attemptsLeft(db, lead.id, "compat", morning)).toBe(0);
    expect(await runCompat(db, lead, { partnerName: "", partnerBirth: "1985-01-01" }, morning)).toHaveProperty("error");
    // Назавтра — снова можно
    expect(await attemptsLeft(db, lead.id, "compat", new Date(morning.getTime() + 24 * 3600_000))).toBe(5);
  });

  it("архетип: самый частый ответ, ничья — по числу судьбы; без Telegram название закрыто", async () => {
    // Луна ×3
    expect(archetypeFor([1, 1, 1, 0, 3], "1990-03-15")).toBe("luna");
    expect(archetypeFor([1, 1, 1], "1990-03-15")).toBeNull();
    expect(archetypeFor([1, 1, 1, 0, 9], "1990-03-15")).toBeNull();
    // Ничья решается одинаково для одной и той же даты
    const tie = archetypeFor([0, 0, 2, 1, 0], "1990-03-15");
    expect(archetypeFor([0, 0, 2, 1, 0], "1990-03-15")).toBe(tie);

    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null);
    expect(await runArchetype(db, lead, [1, 1], morning)).toEqual({ error: "Ответьте на все вопросы" });
    const row = await runArchetype(db, lead, [1, 1, 1, 0, 3], morning);
    if ("error" in row) throw new Error(row.error);
    const v = archetypeView(row, true)!;
    expect(v.result).toMatchObject({ key: "luna", archetype: { name: "Луна" } });
    expect(v.result!.personal).toContain(ARCHETYPES.luna.about);
    expect(archetypeView(row, false)!.result).toBeNull();
  });

  it("«Да или нет»: ответ карты; деликатный вопрос — без «да» и «нет»", async () => {
    expect(cleanQuestion("  да? ")).toHaveProperty("error");
    expect(cleanQuestion("Стоит   ли менять работу?")).toBe("Стоит ли менять работу?");
    expect(isSensitiveQuestion("Я выздоровею после операции?")).toBe(true);
    expect(isSensitiveQuestion("Будет ли у меня беременность в этом году?")).toBe(true);
    // Не путаем с обычными вопросами о чувствах и о знаке Рак
    expect(isSensitiveQuestion("Мне больно после расставания, он вернётся?")).toBe(false);
    expect(isSensitiveQuestion("Подходит ли мне мужчина-Рак?")).toBe(false);
    expect(CARD_ANSWER).toHaveLength(22);

    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null);
    const row = await runYesNo(db, lead, "Стоит ли менять работу?", morning);
    if ("error" in row) throw new Error(row.error);
    const v = yesNoView(row, true)!;
    expect(v.question).toBe("Стоит ли менять работу?");
    expect(v.result!.answer).toBe(CARD_ANSWER[v.card]);
    expect(yesNoView(row, false)!.result).toBeNull();

    const sens = await runYesNo(db, lead, "Я выздоровею после операции?", morning);
    if ("error" in sens) throw new Error(sens.error);
    const sv = yesNoView(sens, true)!;
    expect(sv.result!.answer).toBeNull();
    expect(sv.result!.text).toContain("врача");
    await runYesNo(db, lead, "Ещё один вопрос?", morning);
    expect(await runYesNo(db, lead, "И ещё один вопрос?", morning)).toHaveProperty("error");
  });

  describe("в бот", () => {
    let fetchMock: Mock;
    let nextId = 100;
    beforeEach(() => {
      fetchMock = vi.fn(async (url: string) => {
        const method = url.split("/").pop();
        const result =
          method === "getMe"
            ? { username: "taromba_bot" }
            : method === "sendPhoto"
              ? { message_id: ++nextId, photo: [{ file_id: `ph-${nextId}` }] }
              : method === "sendMessage"
                ? { message_id: ++nextId }
                : true;
        return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
      });
      vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
      vi.stubEnv("SITE_DOMAIN", "example.com");
      vi.stubGlobal("fetch", (url: unknown, init?: RequestInit) =>
        String(url).startsWith("https://api.telegram.org/") ? fetchMock(String(url), init) : realFetch(url as string, init),
      );
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

    it("Telegram подключён — результат приходит сразу и один раз", async () => {
      const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null, TG);
      const row = await runCompat(db, lead, { partnerName: "Иван", partnerBirth: "1988-07-02" }, morning);
      if ("error" in row) throw new Error(row.error);
      await deliverQuiz(db, row, morning);
      await deliverQuiz(db, row, morning);
      const sent = calls().filter((c) => c.method === "sendMessage");
      expect(sent).toHaveLength(1);
      const s = compatScores(lead.birthDate, "1988-07-02");
      expect(sent[0]!.body.text).toContain(`Совместимость пары: ${s.total}%`);
      expect(sent[0]!.body.text).toContain("Иван — Рак");
      expect(sent[0]!.body.text).toContain(`<b>Чувства — ${s.feelings}%.</b>`);
      const kb = (sent[0]!.body.reply_markup as { inline_keyboard: { text: string; callback_data?: string; web_app?: { url: string } }[][] }).inline_keyboard;
      expect(kb[0]!.map((b) => b.text)).toEqual(["Ещё пара", "Выбрать эксперта"]);
      expect(kb[0]![0]!.web_app?.url).toBe(`https://example.com/razbor/${lead.id}/sovmestimost`);
    });

    it("без Telegram — не шлём; подключил — приходит последний результат каждого квиза", async () => {
      const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null);
      const first = await runYesNo(db, lead, "Первый вопрос?", morning);
      const last = await runYesNo(db, lead, "Второй вопрос?", new Date(morning.getTime() + 60_000));
      const arch = await runArchetype(db, lead, [1, 1, 1, 0, 3], morning);
      if ("error" in first || "error" in last || "error" in arch) throw new Error("квиз не прошёл");
      await deliverQuiz(db, last, morning);
      expect(calls()).toHaveLength(0);

      const { leads } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(leads).set({ telegramUserId: TG }).where(eq(leads.id, lead.id));
      expect(await sendPendingQuizzes(db, cfg, lead.id, morning)).toBe(2);
      const photos = calls().filter((c) => c.method === "sendPhoto");
      expect(photos.map((p) => String(p.body.caption).split("\n")[0])).toEqual(
        expect.arrayContaining([expect.stringContaining("Ваш архетип — Луна"), expect.stringContaining("«Второй вопрос?»")]),
      );
      expect(calls().some((c) => JSON.stringify(c.body).includes("Первый вопрос?"))).toBe(false);
      // Всё отмечено — повторно не шлём
      expect(await sendPendingQuizzes(db, cfg, lead.id, morning)).toBe(0);
      const rows = await db.select().from(clubQuizzes);
      expect(rows.every((r) => r.sentAt !== null)).toBe(true);
    });
  });

  it("картинка для сторис — PNG 1080×1920", async () => {
    const png = await archetypeStoryPng("solnce", "taromba.com", "taromba_bot");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1920);
  });
});
