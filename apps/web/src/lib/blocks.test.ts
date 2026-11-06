import { eq } from "drizzle-orm";
import type { Mock } from "vitest";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { leads, telegramBlocks } from "@/db/schema";
import { blockClient, inheritBlock, isTelegramBlocked, unblockClient } from "./blocks";
import { broadcastRecipients } from "./broadcasts";
import { inbox, postMessage, startConversation } from "./chat";
import { createExpert, setExpertOnline } from "./experts";
import { createLead } from "./leads";
import { botCall } from "./telegram";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => jar.set(k, v),
  }),
}));

const TOKEN = "123456789:AAHtestTOKENtestTOKENtestTOKENtest12";
const realFetch = globalThis.fetch;
let db: Db;
let fetchMock: Mock;
let n = 0;

beforeEach(async () => {
  db = await createTestDb();
  jar.clear();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }));
  vi.stubGlobal("fetch", (url: unknown, init?: RequestInit) =>
    String(url).startsWith("https://api.telegram.org/") ? fetchMock(String(url), init) : realFetch(url as string, init),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function expert() {
  const e = await createExpert(db, { name: "Мария | Таролог", login: `maria${++n}`, password: "пароль-эксперта" });
  if (!e.ok) throw new Error(e.error);
  await setExpertOnline(db, e.id, true, new Date());
  return e.id;
}

async function chat(tg: number | null, expertId: number, name = "Анна") {
  const lead = await createLead(db, { name, birthDate: "1990-03-15" }, new Date(), null, tg);
  const res = await startConversation(db, lead, expertId, new Date());
  if (!res.ok) throw new Error(res.error);
  return { lead, c: res.conversation };
}

describe("блокировка клиента", () => {
  it("блокирует все заявки с тем же Telegram, бот ему ничего не шлёт, новых чатов нет; разблокировка — обратно", async () => {
    const e = await expert();
    const a = await chat(9001, e);
    const b = await chat(9001, await expert());
    await postMessage(db, a.c.id, { author: "client", body: "спам" });

    expect(await blockClient(db, a.lead.id)).toBe(true);
    const rows = await db.select({ id: leads.id, blockedAt: leads.blockedAt }).from(leads);
    expect(rows.every((r) => r.blockedAt !== null)).toBe(true);
    expect(await isTelegramBlocked(db, 9001)).toBe(true);

    // Bot API: отправка заблокированному не уходит, остальным — уходит
    expect(await botCall(TOKEN, "sendMessage", { chat_id: 9001, text: "привет" })).toBeNull();
    expect(await botCall(TOKEN, "sendPhoto", { chat_id: "9001" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await botCall(TOKEN, "sendMessage", { chat_id: 9002, text: "привет" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Новый чат не начать; в списке — пометка, в «Без ответа» не попадает
    const [blockedLead] = await db.select().from(leads).where(eq(leads.id, a.lead.id));
    expect(await startConversation(db, blockedLead!, await expert(), new Date())).toEqual({ ok: false, error: "Переписка недоступна" });
    const item = (await inbox(db)).find((i) => i.id === a.c.id)!;
    expect(item).toMatchObject({ blocked: true, waitingSince: null });

    expect(await unblockClient(db, b.lead.id)).toBe(true);
    expect((await db.select().from(leads)).every((r) => r.blockedAt === null)).toBe(true);
    expect(await db.select().from(telegramBlocks)).toHaveLength(0);
    expect(await isTelegramBlocked(db, 9001)).toBe(false);
  });

  it("новая заявка из заблокированного браузера или Telegram — сразу в блоке", async () => {
    const e = await expert();
    const a = await chat(9101, e);
    await blockClient(db, a.lead.id);

    const fromTg = await createLead(db, { name: "Снова", birthDate: "1990-03-15" }, new Date(), null, 9101);
    await inheritBlock(db, fromTg.id, 9101);
    const fresh = await createLead(db, { name: "Другая", birthDate: "1991-03-15" }, new Date(), null, null);
    await inheritBlock(db, fresh.id, null);
    jar.set("hb", "1");
    const fromBrowser = await createLead(db, { name: "Из браузера", birthDate: "1992-03-15" }, new Date(), null, null);
    await inheritBlock(db, fromBrowser.id, null);

    const byId = new Map((await db.select({ id: leads.id, blockedAt: leads.blockedAt }).from(leads)).map((r) => [r.id, r.blockedAt]));
    expect(byId.get(fromTg.id)).not.toBeNull();
    expect(byId.get(fresh.id)).toBeNull();
    expect(byId.get(fromBrowser.id)).not.toBeNull();
  });
});

describe("кому рассылка", () => {
  it("все / не ответили нам / ни разу не писали; заблокированных нет", async () => {
    const e = await expert();
    // Писал, мы ответили последними — «не ответил»
    const silent = await chat(8001, e, "Тишина");
    await postMessage(db, silent.c.id, { author: "client", body: "вопрос" });
    await postMessage(db, silent.c.id, { author: "admin", body: "ответ" });
    // Писал последним — ждёт нас
    const waits = await chat(8002, e, "Ждёт");
    await postMessage(db, waits.c.id, { author: "admin", body: "здравствуйте" });
    await postMessage(db, waits.c.id, { author: "client", body: "а вот вопрос" });
    // Ни разу не писал
    await chat(8003, e, "Молчун");
    // Заблокирован
    const spam = await chat(8004, e, "Спам");
    await postMessage(db, spam.c.id, { author: "client", body: "спам" });
    await postMessage(db, spam.c.id, { author: "admin", body: "ответ" });
    await blockClient(db, spam.lead.id);
    // Без Telegram — никуда
    const site = await chat(null, e, "Сайт");
    await postMessage(db, site.c.id, { author: "client", body: "привет" });

    expect(await broadcastRecipients(db, "all")).toEqual([8001, 8002, 8003]);
    expect(await broadcastRecipients(db, "silent")).toEqual([8001]);
    expect(await broadcastRecipients(db, "never")).toEqual([8003]);
  });
});
