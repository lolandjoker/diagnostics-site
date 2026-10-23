import { eq } from "drizzle-orm";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { experts, priceVariants, products, variations } from "@/db/schema";
import {
  CLIENT_MESSAGES_PER_MINUTE,
  FULL_TEXT_DELAY_MS,
  deliverDueFullTexts,
  inbox,
  markExpertRead,
  messageViews,
  postMessage,
  startConversation,
} from "./chat";
import {
  ONLINE_TIMEOUT_MS,
  adminOnlineMs,
  createExpert,
  createExpertToken,
  detectImageMime,
  getExpert,
  getExpertWithSecret,
  isOnline,
  setExpertOnline,
  setExpertPassword,
  setOnlineByAdmin,
  verifyExpertToken,
  verifyPassword,
} from "./experts";
import { createLead } from "./leads";
import { createOrder, markPaid } from "./orders";
import {
  NO_METHOD,
  pickVariation,
  saveVariationTexts,
  setVariationMode,
  variationFor,
  variationStats,
} from "./variations";

const NOW = new Date();
const SECRET = "x".repeat(40);
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

async function newVariation(title: string, method = NO_METHOD, active = true) {
  const [v] = await db.insert(variations).values({ title, method, active }).returning();
  return v!;
}

async function onlineExpert(name = "Мария", login = "maria") {
  const res = await createExpert(db, { name, login, password: "пароль-эксперта" });
  if (!res.ok) throw new Error(res.error);
  await setExpertOnline(db, res.id, true, new Date());
  return res.id;
}

const lead = (variationId: number | null) =>
  createLead(db, { name: "Анна", birthDate: "1990-03-15", consent: true }, NOW, variationId);

describe("варианты диагностики", () => {
  it("нет активных вариантов — null", async () => {
    expect(await pickVariation(db)).toBeNull();
    await newVariation("Выключен", NO_METHOD, false);
    expect(await pickVariation(db)).toBeNull();
  });

  it("по кругу — поровну", async () => {
    const a = await newVariation("А");
    const b = await newVariation("Б");
    await setVariationMode(db, "sequential");
    const picked: number[] = [];
    for (let i = 0; i < 6; i++) {
      const id = await pickVariation(db);
      picked.push(id!);
      await lead(id);
    }
    expect(picked).toEqual([a.id, b.id, a.id, b.id, a.id, b.id]);
  });

  it("случайно — достаются оба", async () => {
    await newVariation("А");
    await newVariation("Б");
    const seen = new Set<number | null>();
    for (let i = 0; i < 40; i++) seen.add(await pickVariation(db));
    expect(seen.size).toBe(2);
  });

  it("тексты одни для всех — не зависят от имени и даты", async () => {
    const v = await newVariation("А");
    await saveVariationTexts(db, v.id, { shortText: " Текст 1 ", fullText: "Текст 2" });
    expect(await variationFor(db, v.id)).toEqual({ shortText: "Текст 1", fullText: "Текст 2" });
    // Старый вариант со способом расчёта — тексты те же, способ не учитывается
    const old = await newVariation("Старый", "archetype");
    await saveVariationTexts(db, old.id, { shortText: "к", fullText: "п" });
    expect(await variationFor(db, old.id)).toEqual({ shortText: "к", fullText: "п" });
    // Оба пустые — запись удаляется
    await saveVariationTexts(db, v.id, { shortText: "", fullText: "  " });
    expect(await variationFor(db, v.id)).toEqual({ shortText: "", fullText: "" });
    expect(await variationFor(db, null)).toBeNull();
  });
});

describe("эксперты", () => {
  it("проверка данных при создании", async () => {
    expect(await createExpert(db, { name: "", login: "maria", password: "длинный-пароль" })).toMatchObject({ ok: false });
    expect(await createExpert(db, { name: "М", login: "Мария!", password: "длинный-пароль" })).toMatchObject({ ok: false });
    expect(await createExpert(db, { name: "М", login: "maria", password: "short" })).toMatchObject({ ok: false });
    expect(await createExpert(db, { name: "М", login: "Maria", password: "длинный-пароль" })).toMatchObject({ ok: true });
    expect(await createExpert(db, { name: "М2", login: "maria", password: "длинный-пароль" })).toEqual({
      ok: false,
      error: "Такой логин уже есть",
    });
  });

  it("пароль хранится хешем и сверяется", async () => {
    const id = await onlineExpert();
    const e = await getExpertWithSecret(db, { id });
    expect(e?.passwordHash).not.toContain("пароль-эксперта");
    expect(await verifyPassword("пароль-эксперта", e!.passwordHash)).toBe(true);
    expect(await verifyPassword("пароль-эксперт", e!.passwordHash)).toBe(false);
  });

  it("сессия: смена пароля и подделка — недействительна", async () => {
    const id = await onlineExpert();
    const e = (await getExpertWithSecret(db, { id }))!;
    const token = createExpertToken(e, Date.now(), SECRET);
    expect(verifyExpertToken(token, e, Date.now(), SECRET)).toBe(true);
    expect(verifyExpertToken(token.replace(/^\d+/, String(id + 1)), e, Date.now(), SECRET)).toBe(false);
    await setExpertPassword(db, id, "новый-пароль-эксперта");
    const changed = (await getExpertWithSecret(db, { id }))!;
    expect(verifyExpertToken(token, changed, Date.now(), SECRET)).toBe(false);
  });

  it("онлайн гаснет, если эксперт давно не заходил", () => {
    const now = new Date();
    const base = { onlineUntil: null };
    expect(isOnline({ ...base, online: true, lastSeenAt: new Date(now.getTime() - 60_000) }, now)).toBe(true);
    expect(isOnline({ ...base, online: true, lastSeenAt: new Date(now.getTime() - ONLINE_TIMEOUT_MS - 1) }, now)).toBe(false);
    expect(isOnline({ ...base, online: false, lastSeenAt: now }, now)).toBe(false);
  });

  it("срок «в сети» от админа: минуты, часы, дни в пределах от минуты до года", () => {
    expect(adminOnlineMs("1", "hours")).toBe(60 * 60_000);
    expect(adminOnlineMs("90", "minutes")).toBe(90 * 60_000);
    expect(adminOnlineMs("3", "days")).toBe(3 * 24 * 60 * 60_000);
    expect(adminOnlineMs("365", "days")).not.toBeNull();
    expect(adminOnlineMs("366", "days")).toBeNull();
    expect(adminOnlineMs("0", "hours")).toBeNull();
    expect(adminOnlineMs("-1", "hours")).toBeNull();
    expect(adminOnlineMs("1.5", "hours")).toBeNull();
    expect(adminOnlineMs("1", "weeks")).toBeNull();
  });

  it("админ включает «в сети» на свой срок без панели эксперта и выключает", async () => {
    const res = await createExpert(db, { name: "Ольга", login: "olga", password: "пароль-эксперта" });
    if (!res.ok) throw new Error(res.error);
    const now = new Date();
    await setOnlineByAdmin(db, res.id, adminOnlineMs("5", "hours"), now);
    const e = (await getExpert(db, res.id))!;
    expect(isOnline(e, new Date(now.getTime() + 299 * 60_000))).toBe(true);
    expect(isOnline(e, new Date(now.getTime() + 301 * 60_000))).toBe(false);

    const l = await lead(null);
    expect(await startConversation(db, l, res.id, new Date())).toMatchObject({ ok: true });

    await setOnlineByAdmin(db, res.id, null, new Date());
    expect(isOnline((await getExpert(db, res.id))!, new Date())).toBe(false);
  });

  it("эксперт сам ушёл из сети — включение админом тоже снимается", async () => {
    const id = await onlineExpert();
    await setOnlineByAdmin(db, id, 60 * 60_000, new Date());
    await setExpertOnline(db, id, false, new Date());
    expect(isOnline((await getExpert(db, id))!, new Date())).toBe(false);
  });

  it("тип фото — по содержимому", () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg");
    expect(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(detectImageMime(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("чат", () => {
  it("эксперт не в сети — чат не начать", async () => {
    const res = await createExpert(db, { name: "Ольга", login: "olga", password: "пароль-эксперта" });
    if (!res.ok) throw new Error(res.error);
    const l = await lead(null);
    expect(await startConversation(db, l, res.id, new Date())).toMatchObject({ ok: false });
  });

  it("текст 2 приходит через 3 минуты, один раз, подписан как разбор, а не от эксперта", async () => {
    const v = await newVariation("А");
    await saveVariationTexts(db, v.id, { shortText: "к", fullText: "{name}, подробно" });
    const expertId = await onlineExpert();
    const l = await createLead(db, { name: "Qwerty", birthDate: "2001-01-01", consent: true }, NOW, v.id);
    const res = await startConversation(db, l, expertId, new Date());
    if (!res.ok) throw new Error(res.error);
    const start = res.conversation.createdAt.getTime();

    await deliverDueFullTexts(db, new Date(start + FULL_TEXT_DELAY_MS - 5000), res.conversation.id);
    expect(await messageViews(db, res.conversation, 0, "client")).toHaveLength(0);

    const due = new Date(start + FULL_TEXT_DELAY_MS + 1000);
    await Promise.all([deliverDueFullTexts(db, due, res.conversation.id), deliverDueFullTexts(db, due)]);
    await deliverDueFullTexts(db, new Date(due.getTime() + 60_000));
    const client = await messageViews(db, res.conversation, 0, "client");
    expect(client).toHaveLength(1);
    expect(client[0]).toMatchObject({ author: "system", authorName: "Подробный разбор", body: "Qwerty, подробно" });

    const again = await startConversation(db, l, expertId, new Date());
    expect(again.ok && again.conversation.id).toBe(res.conversation.id);
  });

  it("подписи сообщений: клиент, эксперт, админ, предложение продукта", async () => {
    const expertId = await onlineExpert("Мария", "maria");
    const l = await lead(null);
    const res = await startConversation(db, l, expertId, new Date());
    if (!res.ok) throw new Error(res.error);
    const c = res.conversation;
    const [p] = await db.insert(products).values({ title: "Курс", active: true, showOnResult: false }).returning();
    await db.insert(priceVariants).values({ productId: p!.id, amountKopecks: 295000 });

    await postMessage(db, c.id, { author: "client", body: "Здравствуйте" });
    await postMessage(db, c.id, { author: "expert", expertId, body: "Добрый день" });
    await postMessage(db, c.id, { author: "admin", body: "Эксперт вышел, скоро вернётся" });
    await postMessage(db, c.id, { author: "expert", expertId, productId: p!.id });

    const client = await messageViews(db, c, 0, "client");
    expect(client.map((m) => m.authorName)).toEqual(["Вы", "Мария", "Администратор", "Мария"]);
    expect(client[3]?.offer).toMatchObject({ title: "Курс", url: `/razbor/${l.id}/zakaz/${p!.id}` });
    expect(client[3]?.offer?.price).toMatch("2");

    const staff = await messageViews(db, c, 0, "staff");
    expect(staff[0]?.authorName).toBe("Анна");
    expect(await messageViews(db, c, client[1]!.id, "client")).toHaveLength(2);

    // Продукт, предложенный в чате, можно купить, даже если под разбором его нет
    const order = await createOrder(db, { leadId: l.id, productId: p!.id, email: "a@b.ru" });
    expect(order.ok).toBe(true);
  });

  it("другой эксперт отвечает в чужом чате — клиент видит его настоящее имя", async () => {
    const maria = await onlineExpert("Мария", "maria");
    const olga = await onlineExpert("Ольга", "olga");
    const l = await lead(null);
    const res = await startConversation(db, l, maria, new Date());
    if (!res.ok) throw new Error(res.error);
    await postMessage(db, res.conversation.id, { author: "expert", expertId: olga, body: "Подменяю коллегу" });
    const [m] = await messageViews(db, res.conversation, 0, "client");
    expect(m).toMatchObject({ authorName: "Ольга", expertId: olga });
  });

  it("непрочитанные у эксперта и отметка о прочтении", async () => {
    const expertId = await onlineExpert();
    const l = await lead(null);
    const res = await startConversation(db, l, expertId, new Date());
    if (!res.ok) throw new Error(res.error);
    await postMessage(db, res.conversation.id, { author: "client", body: "раз" });
    await postMessage(db, res.conversation.id, { author: "client", body: "два" });
    expect((await inbox(db))[0]).toMatchObject({ leadName: "Анна", unread: 2, lastMessage: "два" });
    await markExpertRead(db, res.conversation.id, new Date(Date.now() + 1000));
    expect((await inbox(db))[0]?.unread).toBe(0);
  });

  it("пустые, слишком длинные и слишком частые сообщения отклоняются", async () => {
    const expertId = await onlineExpert();
    const l = await lead(null);
    const res = await startConversation(db, l, expertId, new Date());
    if (!res.ok) throw new Error(res.error);
    const id = res.conversation.id;
    expect(await postMessage(db, id, { author: "client", body: "   " })).toMatchObject({ ok: false });
    expect(await postMessage(db, id, { author: "client", body: "я".repeat(4001) })).toMatchObject({ ok: false });
    for (let i = 0; i < CLIENT_MESSAGES_PER_MINUTE; i++) await postMessage(db, id, { author: "client", body: `${i}` });
    expect(await postMessage(db, id, { author: "client", body: "ещё" })).toMatchObject({ ok: false });
    expect(await postMessage(db, id, { author: "expert", expertId, body: "эксперту можно" })).toMatchObject({ ok: true });
  });

  it("воронка по вариантам: заявка → чат → ответ → оплата", async () => {
    const a = await newVariation("А");
    const b = await newVariation("Б");
    const expertId = await onlineExpert();
    const [p] = await db.insert(products).values({ title: "Курс", active: true }).returning();
    await db.insert(priceVariants).values({ productId: p!.id, amountKopecks: 100000 });

    const l1 = await lead(a.id);
    await lead(a.id);
    await lead(b.id);
    const res = await startConversation(db, l1, expertId, new Date());
    if (!res.ok) throw new Error(res.error);
    await postMessage(db, res.conversation.id, { author: "client", body: "хочу" });
    const order = await createOrder(db, { leadId: l1.id, productId: p!.id, email: "a@b.ru" });
    if (!order.ok) throw new Error(order.error);
    await markPaid(db, order.order.id, null);

    const stats = await variationStats(db);
    expect(stats.find((s) => s.variationId === a.id)).toMatchObject({ leads: 2, chats: 1, replied: 1, paid: 1, revenueKopecks: 100000 });
    expect(stats.find((s) => s.variationId === b.id)).toMatchObject({ leads: 1, chats: 0, replied: 0, paid: 0 });
  });

  it("выключенный эксперт не может начать чат", async () => {
    const expertId = await onlineExpert();
    await db.update(experts).set({ active: false }).where(eq(experts.id, expertId));
    const l = await lead(null);
    expect(await startConversation(db, l, expertId, new Date())).toMatchObject({ ok: false });
  });
});
