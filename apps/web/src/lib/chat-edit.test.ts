import { eq } from "drizzle-orm";
import type { Mock } from "vitest";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { messagePhotos, messages, telegramMessages } from "@/db/schema";
import { deleteFromTelegram, resendEditedToTelegram } from "./bot-delivery";
import { chatSync, messageViews, postMessage, startConversation } from "./chat";
import { deleteMessage, editMessage } from "./chat-edit";
import { createExpert, setExpertOnline } from "./experts";
import { createLead } from "./leads";

const TOKEN = "123456789:AAHtestTOKENtestTOKENtestTOKENtest12";
const TG = 777000222;
const realFetch = globalThis.fetch;

let db: Db;
let fetchMock: Mock;
let nextId = 500;

beforeEach(async () => {
  db = await createTestDb();
  fetchMock = vi.fn(async (url: string) => {
    const method = url.split("/").pop();
    const result =
      method === "getMe" ? { username: "test_bot" } : method === "sendPhoto" || method === "sendMessage" ? { message_id: ++nextId, photo: [{ file_id: "f" }] } : true;
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  });
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

const methods = () => fetchMock.mock.calls.map(([url]) => String(url).split("/").pop()).filter((m) => m !== "getMe" && m !== "getStickerSet");

async function chat(tg: number | null = null) {
  const expert = await createExpert(db, { name: "Мария | Таролог", login: `maria${++nextId}`, password: "пароль-эксперта" });
  if (!expert.ok) throw new Error(expert.error);
  await setExpertOnline(db, expert.id, true, new Date());
  const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, new Date(), null, tg);
  const res = await startConversation(db, lead, expert.id, new Date());
  if (!res.ok) throw new Error(res.error);
  return { lead, c: res.conversation, expertId: expert.id };
}

async function post(conversationId: string, input: Parameters<typeof postMessage>[2]) {
  const r = await postMessage(db, conversationId, input);
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

describe("правка и удаление сообщений", () => {
  it("исправить — только наши сообщения; клиент видит «изменено»; удалить — любое, вместе с фото", async () => {
    const { c, expertId } = await chat();
    const client = await post(c.id, { author: "client", body: "спам" });
    const mine = await post(c.id, { author: "admin", body: "Опечатка" });
    const expert = await post(c.id, { author: "expert", expertId, body: "Здравствуйте" });

    expect(await editMessage(db, c.id, client, "чужое")).toMatchObject({ ok: false, status: 400 });
    expect(await editMessage(db, c.id, 99999, "нет такого")).toMatchObject({ ok: false, status: 404 });
    expect(await editMessage(db, c.id, mine, "   ")).toMatchObject({ ok: false });
    expect(await editMessage(db, c.id, mine, "Без опечатки")).toEqual({ ok: true });
    expect(await editMessage(db, c.id, expert, "Здравствуйте, Анна!")).toEqual({ ok: true });

    const views = await messageViews(db, c, 0, "client");
    expect(views.find((m) => m.id === mine)).toMatchObject({ body: "Без опечатки", editedAt: expect.any(String) });

    await db.insert(messagePhotos).values({ messageId: client, mime: "image/png", data: Buffer.from([1, 2, 3]) });
    expect(await deleteMessage(db, c.id, client)).toEqual({ ok: true });
    expect(await db.select().from(messages).where(eq(messages.id, client))).toHaveLength(0);
    expect(await db.select().from(messagePhotos)).toHaveLength(0);
    // Чужой чат — не найдено
    const other = await chat();
    expect(await deleteMessage(db, other.c.id, mine)).toMatchObject({ ok: false, status: 404 });
  });

  it("опрос чата: удалённые пропадают, исправленные приходят заново", async () => {
    const { c } = await chat();
    const a = await post(c.id, { author: "admin", body: "раз" });
    const b = await post(c.id, { author: "admin", body: "два" });
    const first = await chatSync(db, c, null, "client");
    expect(first.ids).toEqual(expect.arrayContaining([a, b]));
    expect(first.edited).toEqual([]);

    await new Promise((r) => setTimeout(r, 10));
    await editMessage(db, c.id, a, "раз (исправлено)");
    await deleteMessage(db, c.id, b);
    const next = await chatSync(db, c, first.now, "client");
    expect(next.ids).not.toContain(b);
    expect(next.edited.map((m) => [m.id, m.body])).toEqual([[a, "раз (исправлено)"]]);
  });

  it("в Telegram: удалённое удаляется у клиента, исправленное — заменяется", async () => {
    const { c } = await chat(TG);
    const id = await post(c.id, { author: "admin", body: "Опечатка" });
    // Сообщение само уходит в Telegram (клиент не на сайте) — ждём отправку
    const sentRows = async () => db.select().from(telegramMessages).where(eq(telegramMessages.siteMessageId, id));
    for (let i = 0; i < 50 && (await sentRows()).length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    const before = (await sentRows()).map((r) => r.messageId);
    expect(before.length).toBeGreaterThan(0);
    fetchMock.mockClear();

    await db.update(messages).set({ body: "Исправлено", editedAt: new Date() }).where(eq(messages.id, id));
    await resendEditedToTelegram(db, c.id, id);
    expect(methods()[0]).toBe("deleteMessage");
    expect(methods()).toEqual(expect.arrayContaining(["sendPhoto"]));
    const rows = await db.select().from(telegramMessages).where(eq(telegramMessages.siteMessageId, id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !before.includes(r.messageId))).toBe(true);

    fetchMock.mockClear();
    expect(await deleteFromTelegram(db, id)).toEqual({ deleted: rows.length, failed: [] });
    expect(methods().every((m) => m === "deleteMessage")).toBe(true);

    // Старше 48 часов Telegram удалить не даёт — исправленное приходит ответом на старое, с пометкой
    const old = await post(c.id, { author: "admin", body: "Старое" });
    await db.insert(telegramMessages).values({ chatId: TG, messageId: 77, conversationId: c.id, siteMessageId: old, withButtons: false });
    fetchMock.mockImplementation(async (url: string) => {
      const method = url.split("/").pop();
      if (method === "deleteMessage") return new Response(JSON.stringify({ ok: false, description: "message can't be deleted" }), { status: 400 });
      return new Response(JSON.stringify({ ok: true, result: method === "sendMessage" ? { message_id: ++nextId } : true }), { status: 200 });
    });
    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 50)); // авто-отправка нового сообщения
    await db.delete(telegramMessages).where(eq(telegramMessages.siteMessageId, old));
    await db.insert(telegramMessages).values({ chatId: TG, messageId: 77, conversationId: c.id, siteMessageId: old, withButtons: false });
    await db.update(messages).set({ body: "Старое, исправленное", editedAt: new Date() }).where(eq(messages.id, old));
    fetchMock.mockClear();
    await resendEditedToTelegram(db, c.id, old);
    const sent = fetchMock.mock.calls.map(([url, init]) => ({ method: String(url).split("/").pop(), body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown> }));
    const fix = sent.find((x) => x.method === "sendMessage")!;
    expect(fix.body.text).toContain("Исправлено:");
    expect(fix.body.text).toContain("Старое, исправленное");
    expect(fix.body.reply_parameters).toMatchObject({ message_id: 77 });
    // Не было в Telegram — при правке ничего не шлём
    const other = await post(c.id, { author: "client", body: "клиент пишет" });
    fetchMock.mockClear();
    await resendEditedToTelegram(db, c.id, other);
    expect(methods()).toEqual([]);
  });
});
