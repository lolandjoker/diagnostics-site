import { eq } from "drizzle-orm";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { conversations, leads, messages } from "@/db/schema";
import { inbox, markClientRead, messageViews, postMessage, startConversation } from "./chat";
import { createExpert, setExpertOnline } from "./experts";
import { clientIp, lookupIp, rememberLeadGeo } from "./geo";
import { cityName, countryName, flag, geoLabel } from "./geo-label";
import { geoStats } from "./geo-stats";
import { inboxExperts, searchMessages, snippetAround, staffInbox } from "./staff-inbox";
import { createLead } from "./leads";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

let n = 0;
async function chatWith(name = "Анна", tg: number | null = null) {
  const expert = await createExpert(db, { name: `Мария ${name}`, login: `maria-${++n}`, password: "пароль-эксперта" });
  if (!expert.ok) throw new Error(expert.error);
  await setExpertOnline(db, expert.id, true, new Date());
  const lead = await createLead(db, { name, birthDate: "1990-03-15" }, new Date(), null, tg);
  const res = await startConversation(db, lead, expert.id, new Date());
  if (!res.ok) throw new Error(res.error);
  return { lead, chat: res.conversation, expertId: expert.id };
}

const item = async (id: string) => (await inbox(db)).find((c) => c.id === id)!;

describe("папка «Без ответа» и пометки в списке чатов", () => {
  it("клиент написал — ждёт ответа; автоприветствие и разбор — не ответ; живой ответ — убирает из папки", async () => {
    const { chat, expertId } = await chatWith();
    expect((await item(chat.id)).waitingSince).toBeNull();

    await postMessage(db, chat.id, { author: "expert", expertId, automatic: true, body: "Здравствуйте! Я Мария" });
    await postMessage(db, chat.id, { author: "client", body: "Здравствуйте, вопрос" });
    const first = await db.select({ at: messages.createdAt }).from(messages).where(eq(messages.body, "Здравствуйте, вопрос"));
    await postMessage(db, chat.id, { author: "system", body: "Подробный разбор" });
    await postMessage(db, chat.id, { author: "client", body: "ещё одно" });
    // Ждёт с первого сообщения без ответа
    expect((await item(chat.id)).waitingSince).toBe(first[0]!.at.toISOString());

    await postMessage(db, chat.id, { author: "admin", body: "Отвечаю" });
    expect((await item(chat.id)).waitingSince).toBeNull();
    await postMessage(db, chat.id, { author: "client", body: "спасибо, а ещё?" });
    expect((await item(chat.id)).waitingSince).not.toBeNull();
  });

  it("птички у нашего последнего сообщения, значок Telegram и город", async () => {
    const { chat, lead, expertId } = await chatWith("Ира", 7001);
    await postMessage(db, chat.id, { author: "client", body: "вопрос" });
    expect(await item(chat.id)).toMatchObject({ lastOwnRead: null, telegram: true, geoCountry: null });

    await postMessage(db, chat.id, { author: "expert", expertId, body: "ответ" });
    expect((await item(chat.id)).lastOwnRead).toBe(false);
    await markClientRead(db, chat.id, new Date(Date.now() + 1000));
    expect((await item(chat.id)).lastOwnRead).toBe(true);

    await db.update(leads).set({ geoCountry: "RU", geoCity: "Moscow" }).where(eq(leads.id, lead.id));
    expect(await item(chat.id)).toMatchObject({ geoCountry: "RU", geoCity: "Moscow" });

    // Ответ из бота — отметкой, а не в имени
    await postMessage(db, chat.id, { author: "client", body: "из бота", viaTelegram: true });
    const views = await messageViews(db, chat, 0, "staff");
    expect(views.at(-1)).toMatchObject({ authorName: "Ира", viaTelegram: true });
    expect((await messageViews(db, chat, 0, "client")).at(-1)?.viaTelegram).toBeUndefined();
  });
});

describe("геолокация", () => {
  it("по IP — страна и город из базы на сервере; локальные адреса не определяем", async () => {
    expect(await lookupIp("95.165.0.1")).toEqual({ country: "RU", city: "Moscow" });
    expect(await lookupIp("::ffff:5.18.0.1")).toMatchObject({ country: "RU" });
    expect(await lookupIp("192.168.1.5")).toBeNull();
    expect(await lookupIp("127.0.0.1")).toBeNull();
    expect(await lookupIp("не адрес")).toBeNull();
    expect(await lookupIp(null)).toBeNull();
    expect(clientIp(new Headers({ "x-forwarded-for": "95.165.0.1, 10.0.0.2" }))).toBe("95.165.0.1");
    expect(clientIp(new Headers())).toBeNull();
  });

  it("подписи по-русски", () => {
    expect(geoLabel("RU", "Moscow")).toBe("Москва");
    expect(geoLabel("KZ", "Almaty")).toBe("Казахстан, Алматы");
    expect(geoLabel("DE", null)).toBe("Германия");
    expect(geoLabel(null, null)).toBeNull();
    expect(cityName("Nizhnevartovsk")).toBe("Нижневартовск");
    expect(cityName("Smallville")).toBe("Smallville");
    expect(countryName("RU")).toBe("Россия");
    expect(flag("RU")).toBe("🇷🇺");
  });

  it("в заявку пишется один раз; «Сводка» — по странам и городам", async () => {
    const a = await chatWith("Анна");
    await rememberLeadGeo(db, a.lead.id, "95.165.0.1");
    await rememberLeadGeo(db, a.lead.id, "8.8.8.8"); // уже определено — не перезаписываем
    const b = await createLead(db, { name: "Оля", birthDate: "1991-01-01" }, new Date(), null);
    await rememberLeadGeo(db, b.id, "178.176.0.1");
    const c = await createLead(db, { name: "Джон", birthDate: "1985-01-01" }, new Date(), null);
    await rememberLeadGeo(db, c.id, "8.8.8.8");
    await createLead(db, { name: "Без IP", birthDate: "1985-01-01" }, new Date(), null);

    const [row] = await db.select().from(leads).where(eq(leads.id, a.lead.id));
    expect(row).toMatchObject({ geoCountry: "RU", geoCity: "Moscow" });

    const s = await geoStats(db, null);
    expect(s.countries).toEqual([
      { country: "RU", city: null, leads: 2, chats: 1 },
      { country: "US", city: null, leads: 1, chats: 0 },
    ]);
    expect(s.cities[0]).toEqual({ country: "RU", city: "Moscow", leads: 2, chats: 1 });
    expect(s.unknown).toBe(1);
  });
});

describe("чаты по экспертам, переходы и поиск", () => {
  it("клиент у двух экспертов: «перешёл от», где разбор, другие чаты; фильтр по эксперту", async () => {
    const first = await chatWith("Анна");
    // Тот же клиент (та же заявка) пишет второму эксперту
    const e2 = await createExpert(db, { name: "Ольга Р | Таролог", login: `olga-${++n}`, password: "пароль-эксперта" });
    if (!e2.ok) throw new Error(e2.error);
    await setExpertOnline(db, e2.id, true, new Date());
    const second = await startConversation(db, first.lead, e2.id, new Date(Date.now() + 1000));
    if (!second.ok) throw new Error(second.error);
    // Разбор пришёл в первый чат; во втором отметка тоже стоит, но текста нет — это не «разбор здесь»
    await db.update(conversations).set({ fullTextSentAt: new Date(), createdAt: new Date(Date.now() - 60_000) }).where(eq(conversations.id, first.chat.id));
    await db.update(conversations).set({ fullTextSentAt: new Date() }).where(eq(conversations.id, second.conversation.id));
    await postMessage(db, first.chat.id, { author: "system", body: "Подробный разбор" });
    await postMessage(db, second.conversation.id, { author: "client", body: "Здравствуйте, Ольга" });

    const list = await inbox(db);
    const a = list.find((c) => c.id === first.chat.id)!;
    const b = list.find((c) => c.id === second.conversation.id)!;
    expect(a).toMatchObject({ diagnosis: true, movedFrom: null, otherChats: [{ id: second.conversation.id, diagnosis: false }] });
    expect(b).toMatchObject({ diagnosis: false, movedFrom: a.expertName, otherChats: [{ id: first.chat.id, diagnosis: true }] });

    const onlyOlga = await inbox(db, { expertId: e2.id });
    expect(onlyOlga.map((c) => c.id)).toEqual([second.conversation.id]);
    const experts = await inboxExperts(db);
    expect(experts.map((e) => e.id)).toEqual(expect.arrayContaining([first.expertId, e2.id]));
  });

  it("поиск по тексту сообщений: без регистра, % и _ — как обычные символы, фильтр по эксперту, кусок вокруг", async () => {
    const a = await chatWith("Вера");
    const b = await chatWith("Ира");
    await postMessage(db, a.chat.id, { author: "client", body: "Хочу узнать про СОВМЕСТИМОСТЬ с мужем" });
    await postMessage(db, b.chat.id, { author: "admin", body: "Совместимость посчитаем по датам" });
    await postMessage(db, b.chat.id, { author: "client", body: "скидка 50% будет?" });

    const hits = await searchMessages(db, "совместим");
    expect(hits.map((h) => h.leadName).sort()).toEqual(["Вера", "Ира"]);
    expect(hits[0]!.snippet.toLowerCase()).toContain("совместим");
    expect((await searchMessages(db, "совместим", a.expertId)).map((h) => h.leadName)).toEqual(["Вера"]);
    expect(await searchMessages(db, "с")).toEqual([]);
    expect((await searchMessages(db, "50%")).map((h) => h.leadName)).toEqual(["Ира"]);
    expect(await searchMessages(db, "5_%")).toEqual([]);
    expect(snippetAround("a".repeat(100) + " найди меня " + "b".repeat(200), "найди")).toMatch(/^…a+ найди меня b+…$/);
  });

  it("список для панели — один запрос к базе на 2 секунды для всех сотрудников", async () => {
    const { chat } = await chatWith("Кеш");
    const t = Date.now() + 10_000_000;
    const first = await staffInbox(db, undefined, t);
    expect(first.some((c) => c.id === chat.id)).toBe(true);
    await postMessage(db, chat.id, { author: "client", body: "новое" });
    // Через секунду — то же самое из кеша
    expect(await staffInbox(db, undefined, t + 1000)).toBe(first);
    // Через 2 секунды — свежий список
    const fresh = await staffInbox(db, undefined, t + 2500);
    expect(fresh).not.toBe(first);
    expect(fresh.find((c) => c.id === chat.id)?.lastMessage).toBe("новое");
  });
});
