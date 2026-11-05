import { eq } from "drizzle-orm";
import type { Mock } from "vitest";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { messages, telegramMessages } from "@/db/schema";
import { em, setBotEmoji } from "./bot-emoji";
import { notifyClient, sendLatestToTelegram, splitText } from "./bot-delivery";
import { handleClientMessage } from "./bot-inbox";
import { markClientRead, messageViews, startConversation } from "./chat";
import { createExpert, setExpertOnline } from "./experts";
import { createLead } from "./leads";
import { keyboard } from "./telegram";

const TOKEN = "123456789:AAHtestTOKENtestTOKENtestTOKENtest12";
const TG = 777000111;
const cfg = { token: TOKEN, siteUrl: "https://example.com" };
const realFetch = globalThis.fetch;

describe("свои эмодзи бота", () => {
  afterEach(() => setBotEmoji([]));

  it("набора нет — ни значков, ни стандартных эмодзи; есть — <tg-emoji> и значок на кнопке", () => {
    expect(em("check")).toBe("");
    expect(keyboard([{ text: "Ок", url: "https://x.ru", icon: "check" }])).toEqual({
      reply_markup: { inline_keyboard: [[{ text: "Ок", url: "https://x.ru" }]] },
    });
    expect(setBotEmoji([{ emoji: "✅", custom_emoji_id: "5368324170671202286" }, { emoji: "↩", custom_emoji_id: "42" }, { emoji: "🐱", custom_emoji_id: "1" }])).toBe(2);
    expect(em("check")).toBe('<tg-emoji emoji-id="5368324170671202286">✅</tg-emoji> ');
    expect(keyboard([{ text: "Ответить", webApp: "https://x.ru/c", icon: "reply" }])).toEqual({
      reply_markup: { inline_keyboard: [[{ text: "Ответить", web_app: { url: "https://x.ru/c" }, icon_custom_emoji_id: "42" }]] },
    });
  });
});

it("длинный текст режется по строкам, не длиннее предела", () => {
  const text = Array.from({ length: 50 }, (_, i) => `Строка ${i} ${"слово ".repeat(12).trim()}`).join("\n");
  const parts = splitText(text, 500);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.every((p) => p.length <= 500)).toBe(true);
  expect(parts.join("\n")).toBe(text.trim());
});

describe("переписка в Telegram-боте", () => {
  let db: Db;
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
  let nextId = 100;
  let experts = 0;

  beforeEach(async () => {
    db = await createTestDb();
    nextId = 100;
    fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      const method = String(url).split("/").pop();
      const result =
        method === "sendPhoto"
          ? { message_id: ++nextId, photo: [{ file_id: "small" }, { file_id: `card-${nextId}` }] }
          : method === "sendMessage"
            ? { message_id: ++nextId }
            : true;
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function chatFor(telegramUserId: number | null, name = "Мария | Таролог") {
    const expert = await createExpert(db, { name, login: `maria${++experts}`, password: "пароль-эксперта" });
    if (!expert.ok) throw new Error(expert.error);
    await setExpertOnline(db, expert.id, true, new Date());
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, new Date(), null, telegramUserId);
    const started = await startConversation(db, lead, expert.id, new Date());
    if (!started.ok) throw new Error(started.error);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("SITE_DOMAIN", "example.com");
    // К Telegram — подделка; остальное (файлы отрисовщика плашки) — настоящий fetch
    vi.stubGlobal("fetch", (url: unknown, init?: RequestInit) =>
      String(url).startsWith("https://api.telegram.org/") ? fetchMock(String(url), init) : realFetch(url as string, init),
    );
    return { lead, chat: started.conversation, expertId: expert.id };
  }

  /** Вызовы Bot API: метод и поля (JSON или multipart — объекты в multipart строкой JSON). */
  const calls = () =>
    fetchMock.mock.calls.map(([url, init]) => {
      const raw = (init as RequestInit).body;
      let body: Record<string, unknown> = {};
      if (raw instanceof FormData) {
        for (const [k, v] of raw.entries()) {
          body[k] = typeof v === "string" && /^[[{]/.test(v) ? JSON.parse(v) : typeof v === "string" ? v : "<file>";
        }
      } else body = JSON.parse(String(raw)) as Record<string, unknown>;
      return { method: String(url).split("/").pop(), body };
    });

  const expertSays = async (conversationId: string, expertId: number, body: string) => {
    const [m] = await db.insert(messages).values({ conversationId, author: "expert", expertId, body }).returning({ id: messages.id });
    return m!.id;
  };

  it("сообщения эксперта — в бот: первое с плашкой и подсказкой, следующее текстом; кнопка — под последним", async () => {
    const { lead, chat, expertId } = await chatFor(TG);
    const first = await expertSays(chat.id, expertId, "Здравствуйте, <Анна>!");
    await notifyClient(db, chat.id, { kind: "message", messageId: first });
    let sent = calls();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("sendPhoto");
    expect(sent[0]!.body.photo).toBe("<file>");
    expect(sent[0]!.body.chat_id).toBe(String(TG));
    expect(sent[0]!.body.caption).toContain("Здравствуйте, &lt;Анна&gt;!");
    expect(sent[0]!.body.caption).toContain("Ответить можно прямо здесь");
    expect(sent[0]!.body.reply_markup).toEqual({
      inline_keyboard: [[{ text: "Ответить на сайте", web_app: { url: `https://example.com/razbor/${lead.id}/chat?c=${chat.id}` } }]],
    });

    const second = await expertSays(chat.id, expertId, "Как вы?");
    await notifyClient(db, chat.id, { kind: "message", messageId: second });
    sent = calls();
    // Кнопка у прежнего сообщения убирается, когда новое уже ушло
    expect(sent.map((c) => c.method)).toEqual(["sendPhoto", "sendMessage", "editMessageReplyMarkup"]);
    expect(sent[1]!.body).toMatchObject({ chat_id: TG, text: "Как вы?", parse_mode: "HTML" });
    expect(sent[2]!.body).toMatchObject({ chat_id: TG, message_id: 101, reply_markup: { inline_keyboard: [] } });

    const rows = await db.select().from(telegramMessages).where(eq(telegramMessages.chatId, TG));
    expect(rows.map((r) => [r.messageId, r.conversationId, r.withButtons])).toEqual([
      [101, chat.id, false],
      [102, chat.id, true],
    ]);
  });

  it("клиент сейчас на сайте или заявка не из Telegram — в бот не шлём", async () => {
    const { chat, expertId } = await chatFor(TG);
    await markClientRead(db, chat.id, new Date());
    await notifyClient(db, chat.id, { kind: "message", messageId: await expertSays(chat.id, expertId, "…") });
    expect(fetchMock).not.toHaveBeenCalled();

    const site = await chatFor(null);
    await notifyClient(db, site.chat.id, { kind: "message", messageId: await expertSays(site.chat.id, site.expertId, "…") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("звонок и подробный разбор", async () => {
    const { chat, expertId } = await chatFor(TG);
    await notifyClient(db, chat.id, { kind: "call", expertId });
    const [m] = await db.insert(messages).values({ conversationId: chat.id, author: "system", body: "Ваш разбор: всё хорошо." }).returning();
    await notifyClient(db, chat.id, { kind: "fullText", messageId: m!.id });
    const sent = calls();
    expect(sent[0]).toMatchObject({ method: "sendMessage", body: { text: "<b>Мария | Таролог</b> звонит вам — откройте чат, чтобы ответить." } });
    const photo = sent.find((c) => c.method === "sendPhoto");
    expect(photo?.body.caption).toBe("<b>Анна, ваш подробный разбор готов</b>");
    expect(sent.filter((c) => c.method === "sendMessage").at(-1)?.body.text).toBe("<blockquote expandable>Ваш разбор: всё хорошо.</blockquote>");
  });

  it("ответ в боте — в чат на сайте: на сообщение эксперта — в его чат; подтверждение один раз", async () => {
    const a = await chatFor(TG, "Мария");
    // Второй чат того же человека, с другим экспертом
    const other = await createExpert(db, { name: "Ольга", login: "olga-bot", password: "пароль-эксперта" });
    if (!other.ok) throw new Error(other.error);
    await setExpertOnline(db, other.id, true, new Date());
    const b = await startConversation(db, a.lead, other.id, new Date());
    if (!b.ok) throw new Error(b.error);

    await notifyClient(db, a.chat.id, { kind: "message", messageId: await expertSays(a.chat.id, a.expertId, "Я Мария") });
    await notifyClient(db, b.conversation.id, { kind: "message", messageId: await expertSays(b.conversation.id, other.id, "Я Ольга") });
    const mariaMsg = (await db.select().from(telegramMessages).where(eq(telegramMessages.conversationId, a.chat.id)))[0]!.messageId;

    const incoming = (text: string, replyTo?: number) =>
      handleClientMessage(db, cfg, {
        message_id: 1,
        chat: { id: TG, type: "private" },
        from: { id: TG },
        text,
        ...(replyTo && { reply_to_message: { message_id: replyTo } }),
      });

    // Ответ на сообщение Марии — в чат с Марией, хотя последней писала Ольга
    expect(await incoming("Спасибо, Мария", mariaMsg)).toEqual({ handled: true, reply: "Отправлено эксперту <b>Мария</b>. Ответ придёт сюда." });
    // Просто сообщение — в чат, из которого бот писал последним (Ольга)
    expect(await incoming("А вам, Ольга?")).toEqual({ handled: true, reply: "Отправлено эксперту <b>Ольга</b>. Ответ придёт сюда." });
    expect(await incoming("И ещё вопрос")).toEqual({ handled: true });

    const inA = await db.select().from(messages).where(eq(messages.conversationId, a.chat.id));
    expect(inA.filter((m) => m.author === "client").map((m) => [m.body, m.viaTelegram])).toEqual([["Спасибо, Мария", true]]);
    const inB = await db.select().from(messages).where(eq(messages.conversationId, b.conversation.id));
    expect(inB.filter((m) => m.author === "client").map((m) => m.body)).toEqual(["А вам, Ольга?", "И ещё вопрос"]);
    // Эксперт видит, что клиент ответил из Telegram
    const staff = await messageViews(db, a.chat, 0, "staff");
    expect(staff.find((m) => m.author === "client")?.authorName).toBe("Анна · из Telegram");

    // Команды и стикеры — не ответ эксперту
    expect(await incoming("/stop")).toEqual({ handled: false });
    expect(await handleClientMessage(db, cfg, { message_id: 2, chat: { id: TG, type: "private" }, from: { id: TG } })).toEqual({
      handled: true,
      reply: "Эксперту можно отправить текст или фото.",
    });
  });

  it("человек без привязанной заявки или без чата — ответ решает botReply", async () => {
    const { lead } = await chatFor(null);
    expect(await handleClientMessage(db, cfg, { chat: { id: 1, type: "private" }, from: { id: 1 }, text: "привет" })).toEqual({ handled: false });
    expect(lead.telegramUserId).toBeNull();
    const noChat = await createLead(db, { name: "Ира", birthDate: "1991-01-01" }, new Date(), null, 555);
    expect(noChat.telegramUserId).toBe(555);
    expect(await handleClientMessage(db, cfg, { chat: { id: 555, type: "private" }, from: { id: 555 }, text: "привет" })).toEqual({ handled: false });
  });

  it("подключил Telegram — последнее сообщение эксперта сразу приходит в бот, даже если человек на сайте", async () => {
    const { lead, chat, expertId } = await chatFor(TG);
    await expertSays(chat.id, expertId, "Здравствуйте! Напишите время рождения");
    await markClientRead(db, chat.id, new Date());
    await sendLatestToTelegram(db, cfg, lead.id);
    const sent = calls();
    expect(sent[0]?.method).toBe("sendPhoto");
    expect(sent[0]?.body.caption).toContain("Здравствуйте! Напишите время рождения");
  });
});
