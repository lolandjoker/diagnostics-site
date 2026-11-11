import { eq } from "drizzle-orm";
import type { Mock } from "vitest";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { leads, messages, telegramBlocks } from "@/db/schema";
import { blockClient, inheritBlock, isTelegramBlocked, unblockClient } from "./blocks";
import { broadcastRecipients } from "./broadcasts";
import { drawDailyCard } from "./club";
import { runArchetype } from "./quiz-archetype";
import { runYesNo } from "./quiz-yesno";
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

  it("условия: заявка старше N часов, не писал нам N часов (или не писал вовсе)", async () => {
    const e = await expert();
    const now = new Date();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
    // Заявка двое суток назад, ни разу не писал
    const old = await chat(8201, e, "Давно");
    await db.update(leads).set({ createdAt: hoursAgo(48) }).where(eq(leads.id, old.lead.id));
    // Новая заявка, написал только что
    const fresh = await chat(8202, e, "Новый");
    await postMessage(db, fresh.c.id, { author: "client", body: "вопрос" });
    // Новая заявка, писал 30 часов назад
    const quiet = await chat(8203, e, "Затих");
    await postMessage(db, quiet.c.id, { author: "client", body: "вопрос" });
    await db.update(messages).set({ createdAt: hoursAgo(30) }).where(eq(messages.conversationId, quiet.c.id));
    // У того же человека есть и старая заявка — регистрация по первой
    const again = await chat(8202, e, "Новый снова");
    await db.update(leads).set({ createdAt: hoursAgo(100) }).where(eq(leads.id, again.lead.id));

    expect(await broadcastRecipients(db, "all", {}, now)).toEqual([8201, 8202, 8203]);
    expect(await broadcastRecipients(db, "all", { registeredHours: 24 }, now)).toEqual([8201, 8202]);
    expect(await broadcastRecipients(db, "all", { silentHours: 24 }, now)).toEqual([8201, 8203]);
    expect(await broadcastRecipients(db, "all", { registeredHours: 24, silentHours: 24 }, now)).toEqual([8201]);
    expect(await broadcastRecipients(db, "all", { silentHours: 48 }, now)).toEqual([8201]);
    // Вместе с «Кому»: писали — и молчат сутки
    expect(await broadcastRecipients(db, "silent", { silentHours: 24 }, now)).toEqual([]);
    expect(await broadcastRecipients(db, "never", { registeredHours: 24 }, now)).toEqual([8201]);
  });

  it("по квизам: не проходили архетип / «Да или нет» / не тянули карту / ни одного квиза", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const e = await expert();
    const arch = await chat(8101, e, "Архетип");
    await runArchetype(db, arch.lead, [1, 1, 1, 0, 3], new Date());
    const yn = await chat(8102, e, "Вопрос");
    await runYesNo(db, yn.lead, "Стоит ли менять работу?", new Date());
    await drawDailyCard(db, yn.lead.id, 1, new Date());
    await chat(8103, e, "Ничего");

    expect(await broadcastRecipients(db, "no_archetype")).toEqual([8102, 8103]);
    expect(await broadcastRecipients(db, "no_yesno")).toEqual([8101, 8103]);
    expect(await broadcastRecipients(db, "no_compat")).toEqual([8101, 8102, 8103]);
    expect(await broadcastRecipients(db, "no_card")).toEqual([8101, 8103]);
    expect(await broadcastRecipients(db, "no_quiz")).toEqual([8103]);
    vi.unstubAllEnvs();
  });
});
