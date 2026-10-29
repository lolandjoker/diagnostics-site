import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { messages } from "@/db/schema";
import { postMessage, startConversation } from "./chat";
import { createExpert, setExpertOnline } from "./experts";
import { funnel, funnelStart, periodStart, trackStep, trackingSince } from "./funnel";
import { createLead } from "./leads";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

const counts = async (since: Date | null = null) => Object.fromEntries((await funnel(db, since)).map((s) => [s.key, s.count]));

describe("воронка", () => {
  it("каждый шаг считается один раз на браузер или заявку; дальше — по данным", async () => {
    const expert = await createExpert(db, { name: "Мария", login: "maria", password: "пароль-эксперта" });
    if (!expert.ok) throw new Error(expert.error);
    await setExpertOnline(db, expert.id, true, new Date());

    // Три браузера открыли главную (один — дважды), двое начали заполнять форму
    for (const v of ["a", "a", "b", "c"]) await trackStep(db, v, "home", null);
    for (const v of ["a", "b"]) await trackStep(db, v, "form_start", null);
    // Шаг после заявки без заявки — не пишется
    await trackStep(db, "c", "result", null);

    const anna = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, new Date(), null, 777);
    const oleg = await createLead(db, { name: "Олег", birthDate: "1985-01-01" }, new Date(), null);
    await trackStep(db, "a", "result", anna.id);
    await trackStep(db, "a", "result", anna.id);
    await trackStep(db, "b", "result", oleg.id);
    await trackStep(db, "a", "experts", anna.id);

    const chat = await startConversation(db, anna, expert.id, new Date());
    if (!chat.ok) throw new Error(chat.error);
    await postMessage(db, chat.conversation.id, { author: "client", body: "Здравствуйте" });
    await db.insert(messages).values({ conversationId: chat.conversation.id, author: "expert", expertId: expert.id, body: "Добрый день" });

    expect(await counts()).toEqual({
      home: 3,
      form_start: 2,
      lead: 2,
      result: 2,
      experts: 1,
      chat: 1,
      wrote: 1,
      replied: 1,
      telegram: 1,
    });

    // Период — после всех событий: пусто
    expect(Object.values(await counts(new Date(Date.now() + 60_000))).every((n) => n === 0)).toBe(true);
  });

  it("воронка — не раньше начала сбора данных", async () => {
    expect(await trackingSince(db)).toBeNull();
    await trackStep(db, "a", "home", null);
    const since = await trackingSince(db);
    expect(since).not.toBeNull();
    const before = new Date(since!.getTime() - 86_400_000);
    const after = new Date(since!.getTime() + 1000);
    expect(funnelStart(null, since!)).toEqual(since);
    expect(funnelStart(before, since!)).toEqual(since);
    expect(funnelStart(after, since!)).toEqual(after);
  });

  it("«сегодня» — с полуночи по Москве", () => {
    // 29 октября 2026, 01:30 по Москве = 28 октября 22:30 UTC
    expect(periodStart("today", new Date("2026-10-28T22:30:00Z"))?.toISOString()).toBe("2026-10-28T21:00:00.000Z");
    expect(periodStart("all", new Date())).toBeNull();
  });
});
