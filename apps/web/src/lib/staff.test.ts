import { eq } from "drizzle-orm";
import type { Mock } from "vitest";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { conversations, leads, messages } from "@/db/schema";
import { moscowNow, personalDay } from "./numerology";
import { markExpertRead, messageViews, postMessage, startConversation } from "./chat";
import { createExpert, setExpertOnline } from "./experts";
import { createLead } from "./leads";
import { createOperator, setOperatorActive } from "./operators";
import { sourceStats } from "./sources";
import { STAFF_LINK_MS, consumeStaffLink, createStaffLinkToken, handleStaffReply, notifyStaff, staffTelegramStatus } from "./staff-telegram";

const TOKEN = "123456789:AAHtestTOKENtestTOKENtestTOKENtest12";
const cfg = { token: TOKEN, siteUrl: "https://example.com" };
const realFetch = globalThis.fetch;
const OP_TG = 5001;
const EXPERT_TG = 5002;

describe("Telegram сотрудников", () => {
  let db: Db;
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
  let nextId = 700;

  beforeEach(async () => {
    db = await createTestDb();
    nextId = 700;
    fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      const method = String(url).split("/").pop();
      const result = method === "sendMessage" ? { message_id: ++nextId } : true;
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

  const sent = () =>
    fetchMock.mock.calls
      .filter(([url]) => /\/sendMessage$/.test(String(url)))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { chat_id: number; text: string; reply_markup?: unknown });

  async function setup() {
    const expert = await createExpert(db, { name: "Мария | Таролог", login: "maria-st", password: "пароль-эксперта" });
    if (!expert.ok) throw new Error(expert.error);
    await setExpertOnline(db, expert.id, true, new Date());
    const op = await createOperator(db, { name: "Лена", login: "lena", password: "пароль-оператора" });
    if (!op.ok) throw new Error(op.error);
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, new Date(), null);
    const started = await startConversation(db, lead, expert.id, new Date());
    if (!started.ok) throw new Error(started.error);
    return { expertId: expert.id, operatorId: op.id, lead, chat: started.conversation };
  }

  it("привязка: одноразовая ссылка на 15 минут, чужая и старая не работают, выключенного не привязать", async () => {
    const { operatorId } = await setup();
    const now = new Date();
    const token = await createStaffLinkToken(db, { kind: "operator", staffId: operatorId }, now);
    expect(token).toMatch(/^[\w-]{24}$/);
    expect(await consumeStaffLink(db, "lабв", { id: OP_TG, name: "Лена" }, now)).toBeNull();
    expect(await consumeStaffLink(db, "st_неттакого_кода_неттакого", { id: OP_TG, name: "x" }, now)).toContain("Ссылка");

    // Просроченная
    expect(await consumeStaffLink(db, `st_${token}`, { id: OP_TG, name: "Лена" }, new Date(now.getTime() + STAFF_LINK_MS + 1000))).toContain(
      "устарела",
    );
    const ok = await consumeStaffLink(db, `st_${token}`, { id: OP_TG, name: "Лена @lena" }, now);
    expect(ok).toContain("Telegram подключён</b> — оператор Лена");
    expect(await staffTelegramStatus(db, { kind: "operator", staffId: operatorId })).toEqual({ connected: true, name: "Лена @lena" });
    // Повторно та же ссылка — нет (например, если её переслали)
    expect(await consumeStaffLink(db, `st_${token}`, { id: 9999, name: "чужой" }, now)).toContain("использована");
    expect(await staffTelegramStatus(db, { kind: "operator", staffId: operatorId })).toMatchObject({ name: "Лена @lena" });

    await setOperatorActive(db, operatorId, false);
    const again = await createStaffLinkToken(db, { kind: "operator", staffId: operatorId }, now);
    expect(await consumeStaffLink(db, `st_${again}`, { id: OP_TG, name: "Лена" }, now)).toContain("выключен");
  });

  it("клиент написал — уведомление эксперту чата и оператору; ответ на уведомление уходит клиенту", async () => {
    const { expertId, operatorId, chat } = await setup();
    const now = new Date();
    for (const [ref, tg] of [
      [{ kind: "operator" as const, staffId: operatorId }, OP_TG],
      [{ kind: "expert" as const, staffId: expertId }, EXPERT_TG],
    ] as const) {
      await consumeStaffLink(db, `st_${await createStaffLinkToken(db, ref, now)}`, { id: tg, name: "" }, now);
    }
    // Другой эксперт с Telegram — не его чат, уведомления нет
    const other = await createExpert(db, { name: "Ольга", login: "olga-st", password: "пароль-эксперта" });
    if (!other.ok) throw new Error(other.error);
    await consumeStaffLink(db, `st_${await createStaffLinkToken(db, { kind: "expert", staffId: other.id }, now)}`, { id: 5003, name: "" }, now);

    const [m] = await db.insert(messages).values({ conversationId: chat.id, author: "client", body: "Здравствуйте, <вопрос>" }).returning();
    await notifyStaff(db, chat.id, m!.id);
    const notices = sent();
    expect(notices.map((n) => n.chat_id).sort()).toEqual([OP_TG, EXPERT_TG].sort());
    expect(notices[0]!.text).toContain("<b>Анна</b> → Мария\nЗдравствуйте, &lt;вопрос&gt;");
    const toOperator = notices.find((n) => n.chat_id === OP_TG)!;
    expect(JSON.stringify(toOperator.reply_markup)).toContain(`https://example.com/operator/chat/${chat.id}`);
    expect(JSON.stringify(notices.find((n) => n.chat_id === EXPERT_TG)!.reply_markup)).toContain(`/expert/chat/${chat.id}`);

    // Оператор отвечает на уведомление
    const opNotice = 701 + notices.findIndex((n) => n.chat_id === OP_TG);
    const res = await handleStaffReply(db, cfg, {
      chat: { id: OP_TG, type: "private" },
      from: { id: OP_TG },
      text: "Добрый вечер! Эксперт скоро ответит.",
      reply_to_message: { message_id: opNotice },
    });
    expect(res).toEqual({ handled: true, reply: "Отправлено клиенту <b>Анна</b>." });
    const [reply] = await db.select().from(messages).where(eq(messages.author, "admin"));
    expect(reply).toMatchObject({ conversationId: chat.id, operatorId, body: "Добрый вечер! Эксперт скоро ответит." });
    // Клиент видит его от эксперта чата
    const client = await messageViews(db, chat, 0, "client");
    expect(client.at(-1)).toMatchObject({ author: "expert", authorName: "Мария | Таролог" });

    // Чужой Telegram на то же уведомление — не ответ сотрудника
    expect(await handleStaffReply(db, cfg, { chat: { id: 7777, type: "private" }, from: { id: 7777 }, text: "x", reply_to_message: { message_id: opNotice } })).toEqual({
      handled: false,
    });
    // Выключенный оператор — ответ не уходит
    await setOperatorActive(db, operatorId, false);
    const blocked = await handleStaffReply(db, cfg, { chat: { id: OP_TG, type: "private" }, from: { id: OP_TG }, text: "ещё", reply_to_message: { message_id: opNotice } });
    expect(blocked).toEqual({ handled: true, reply: "Ваш доступ выключен — ответ не отправлен." });

    // Сотрудник сейчас смотрит чат на сайте — не дублируем
    fetchMock.mockClear();
    await markExpertRead(db, chat.id, new Date());
    const [m2] = await db.insert(messages).values({ conversationId: chat.id, author: "client", body: "ещё вопрос" }).returning();
    await notifyStaff(db, chat.id, m2!.id);
    expect(sent()).toHaveLength(0);
  });

  it("сообщение клиента через postMessage тоже зовёт сотрудников", async () => {
    const { operatorId, chat } = await setup();
    await consumeStaffLink(db, `st_${await createStaffLinkToken(db, { kind: "operator", staffId: operatorId }, new Date())}`, { id: OP_TG, name: "" }, new Date());
    await postMessage(db, chat.id, { author: "client", body: "Помогите" });
    await vi.waitFor(() => expect(sent().some((n) => n.chat_id === OP_TG)).toBe(true));
  });
});

describe("прогноз на день", () => {
  it("личный день по нумерологии и дата по Москве", () => {
    // 15.03.1990, 05.11.2026: год 6+3+1=1, месяц 1+11→3, день 3+5=8
    expect(personalDay("1990-03-15", "2026-11-05")).toBe(8);
    expect(personalDay("1990-03-15", "2026-11-06")).toBe(9);
    expect(personalDay("1990-03-15", "2026-11-07")).toBe(1);
    expect(moscowNow(new Date("2026-11-05T21:30:00Z"))).toEqual({ date: "2026-11-06", hour: 0 });
  });

});

it("«Вернулись»: снова пришли в чат через сутки и позже", async () => {
  const db = await createTestDb();
  const expert = await createExpert(db, { name: "Мария", login: "maria-ret", password: "пароль-эксперта" });
  if (!expert.ok) throw new Error(expert.error);
  await setExpertOnline(db, expert.id, true, new Date());
  const day = 24 * 60 * 60 * 1000;
  const old = new Date(Date.now() - 3 * day);
  const back = await createLead(db, { name: "Вернулась", birthDate: "1990-01-01" }, old, null);
  const gone = await createLead(db, { name: "Ушла", birthDate: "1990-01-01" }, old, null);
  for (const l of [back, gone]) {
    await db.update(leads).set({ createdAt: old }).where(eq(leads.id, l.id));
    const c = await startConversation(db, l, expert.id, old);
    if (!c.ok) throw new Error(c.error);
    // Оба читали чат в первый час; одна вернулась через два дня
    await db
      .update(conversations)
      .set({ clientReadAt: l.id === back.id ? new Date(old.getTime() + 2 * day) : new Date(old.getTime() + 60_000) })
      .where(eq(conversations.id, c.conversation.id));
  }
  const main = (await sourceStats(db, null)).find((r) => r.key === null)!;
  expect(main).toMatchObject({ leads: 2, returned: 1 });
});
