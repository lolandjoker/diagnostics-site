import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { messages } from "@/db/schema";
import { postMessage, startConversation } from "./chat";
import { createExpert, setExpertOnline } from "./experts";
import { trackStep } from "./funnel";
import { createLead, getLead } from "./leads";
import { SOURCES, heardFromStats, isHeardFrom, isSource, setHeardFrom, sourceStats } from "./sources";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

const byKey = async (since: Date | null = null) =>
  Object.fromEntries((await sourceStats(db, since)).map((s) => [s.key ?? "none", s]));

describe("источники трафика", () => {
  it("короткие адреса и ответы проверяются по списку", () => {
    expect(isSource("karta")).toBe(true);
    expect(isSource("tayna")).toBe(true);
    expect(isSource("admin")).toBe(false);
    expect(isSource("toString")).toBe(false); // не берём ключи из прототипа
    expect(isHeardFrom("tiktok")).toBe(true);
    expect(isHeardFrom("radio")).toBe(false);
  });

  it("воронка по источникам: браузеры, заявки, чаты, сообщения", async () => {
    const expert = await createExpert(db, { name: "Мария", login: "maria", password: "пароль-эксперта" });
    if (!expert.ok) throw new Error(expert.error);
    await setExpertOnline(db, expert.id, true, new Date());

    // Двое пришли по /karta (один открыл главную дважды), один — по /tayna, один — без адреса
    for (const [v, src] of [["a", "karta"], ["a", "karta"], ["b", "karta"], ["c", "tayna"], ["d", null]] as const) {
      await trackStep(db, v, "home", null, src);
    }
    const anna = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, new Date(), null, null, "karta");
    await createLead(db, { name: "Олег", birthDate: "1985-01-01" }, new Date(), null, null, "karta");
    await createLead(db, { name: "Ира", birthDate: "1992-07-07" }, new Date(), null, null, null);

    const chat = await startConversation(db, anna, expert.id, new Date());
    if (!chat.ok) throw new Error(chat.error);
    await postMessage(db, chat.conversation.id, { author: "client", body: "Здравствуйте" });
    await db.insert(messages).values({ conversationId: chat.conversation.id, author: "expert", expertId: expert.id, body: "Добрый день" });

    const s = await byKey();
    expect(Object.keys(s)).toEqual([...Object.keys(SOURCES), "none"]);
    expect(s.karta).toMatchObject({ label: "TikTok · Твоя карта", visitors: 2, leads: 2, chats: 1, wrote: 1 });
    expect(s.tayna).toMatchObject({ visitors: 1, leads: 0, chats: 0, wrote: 0 });
    expect(s.none).toMatchObject({ visitors: 1, leads: 1, chats: 0, wrote: 0 });

    // Период после всех событий — нули
    const later = await byKey(new Date(Date.now() + 60_000));
    expect(Object.values(later).every((r) => r.visitors + r.leads + r.chats + r.wrote === 0)).toBe(true);
  });

  it("ответ «Откуда узнали» сохраняется один раз", async () => {
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, new Date());
    expect(await setHeardFrom(db, lead.id, "tiktok")).toBe(true);
    expect(await setHeardFrom(db, lead.id, "friends")).toBe(false);
    expect((await getLead(db, lead.id))?.heardFrom).toBe("tiktok");

    const stats = Object.fromEntries((await heardFromStats(db, null)).map((h) => [h.key, h.leads]));
    expect(stats.tiktok).toBe(1);
    expect(stats.friends).toBe(0);
  });
});
