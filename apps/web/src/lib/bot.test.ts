import { eq } from "drizzle-orm";
import type { Mock } from "vitest";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { broadcasts, conversations, messages, reviews, telegramMessages, telegramStarts } from "@/db/schema";
import { em, setBotEmoji } from "./bot-emoji";
import { notifyClient, sendLatestToTelegram, splitText } from "./bot-delivery";
import { REMIND_AFTER_MS, REVIEW_ASK_AFTER_MS, askReviews, remindUnread } from "./bot-chores";
import { handleExpertCallback, showExperts } from "./bot-experts";
import { handleClientMessage } from "./bot-inbox";
import { handleCallback } from "./bot-reviews";
import { botStats } from "./bot-stats";
import { broadcastHtml, runBroadcast, validateBroadcast } from "./broadcasts";
import { markClientRead, messageViews, startConversation } from "./chat";
import { createExpert, setExpertOnline } from "./experts";
import { createLead } from "./leads";
import { botReply, keyboard, telegramStartSource } from "./telegram";

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
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(url).split("/").pop();
      // Человек 13 заблокировал бота
      if (typeof init?.body === "string" && (JSON.parse(init.body) as { chat_id?: number }).chat_id === 13) {
        return new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was blocked by the user" }), { status: 403 });
      }
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
  // Чтение набора эмодзи (getMe, getStickerSet) — не в счёт
  const calls = () =>
    fetchMock.mock.calls
      .filter(([url]) => !/\/(getMe|getStickerSet)$/.test(String(url)))
      .map(([url, init]) => {
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

  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

  it("эксперт ответил, клиент сутки не читал — одно напоминание; прочитал или ответил — нет", async () => {
    const { lead, chat, expertId } = await chatFor(TG, "Мария");
    await db.insert(messages).values({ conversationId: chat.id, author: "expert", expertId, body: "Как вы?", createdAt: hoursAgo(25) });
    // Второй чат: клиент ответил после эксперта — напоминать не о чем
    const other = await chatFor(TG, "Ольга");
    await db.insert(messages).values([
      { conversationId: other.chat.id, author: "expert", expertId: other.expertId, body: "?", createdAt: hoursAgo(30) },
      { conversationId: other.chat.id, author: "client", body: "Да", createdAt: hoursAgo(29) },
    ]);
    // Третий: ответ свежий — ещё рано
    const fresh = await chatFor(TG, "Вера");
    await db.insert(messages).values({ conversationId: fresh.chat.id, author: "expert", expertId: fresh.expertId, body: "!", createdAt: hoursAgo(2) });

    expect(await remindUnread(db, new Date())).toBe(1);
    const sent = calls();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.text).toBe("У вас непрочитанный ответ от эксперта <b>Мария</b>. Напишите прямо сюда или откройте чат.");
    expect(sent[0]!.body.reply_markup).toEqual({
      inline_keyboard: [[{ text: "Открыть чат", web_app: { url: `https://example.com/razbor/${lead.id}/chat?c=${chat.id}` } }]],
    });
    // Повторно о том же сообщении — нет
    expect(await remindUnread(db, new Date())).toBe(0);
    expect(REMIND_AFTER_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("через полчаса после разбора — просьба оценить; кнопка ставит оценку, ответ — текст отзыва", async () => {
    const { chat } = await chatFor(TG, "Мария");
    const doneAt = new Date(Date.now() - REVIEW_ASK_AFTER_MS - 60_000);
    await db.update(conversations).set({ fullTextSentAt: doneAt }).where(eq(conversations.id, chat.id));
    await db.insert(messages).values({ conversationId: chat.id, author: "system", body: "Разбор", createdAt: doneAt });

    expect(await askReviews(db, new Date())).toBe(1);
    expect(await askReviews(db, new Date())).toBe(0);
    const ask = calls()[0]!;
    expect(ask.body.text).toContain("Как вам разбор эксперта <b>Мария</b>?");
    const row = (ask.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard[0]!;
    expect(row.map((b) => b.text)).toEqual(["1", "2", "3", "4", "5"]);
    expect(row[3]!.callback_data).toBe(`rv:${chat.id}:4`);
    const askId = (await db.select().from(telegramMessages).where(eq(telegramMessages.purpose, "review")))[0]!.messageId;

    // Чужой человек жмёт кнопку — отзыва нет
    await handleCallback(db, cfg, { id: "q0", from: { id: 999 }, data: `rv:${chat.id}:1`, message: { message_id: askId, chat: { id: 999 } } });
    expect(await db.select().from(reviews)).toHaveLength(0);

    await handleCallback(db, cfg, { id: "q1", from: { id: TG }, data: `rv:${chat.id}:4`, message: { message_id: askId, chat: { id: TG } } });
    let [review] = await db.select().from(reviews);
    expect(review).toMatchObject({ conversationId: chat.id, stars: 4, body: "", authorName: "Анна" });
    const edited = calls().find((c) => c.method === "editMessageText");
    expect(edited?.body.text).toContain("Ваша оценка эксперту <b>Мария</b>: ★★★★☆");

    const reply = await handleClientMessage(db, cfg, {
      message_id: 5,
      chat: { id: TG, type: "private" },
      from: { id: TG },
      text: "Очень точно, спасибо!",
      reply_to_message: { message_id: askId },
    });
    expect(reply).toEqual({ handled: true, reply: "Спасибо! Отзыв об эксперте <b>Мария</b> сохранён." });
    [review] = await db.select().from(reviews);
    expect(review).toMatchObject({ stars: 4, body: "Очень точно, спасибо!" });
    // Текст отзыва не ушёл в чат эксперту
    expect((await db.select().from(messages).where(eq(messages.author, "client"))).length).toBe(0);
  });

  it("рассылка: текст с **жирным** и /stop, проверка полей, итог — дошло и не дошло", async () => {
    await chatFor(TG);
    expect(validateBroadcast({ body: " ", buttonText: "", buttonUrl: "", gift: false })).toBe("Напишите текст рассылки");
    expect(validateBroadcast({ body: "Привет", buttonText: "Кнопка", buttonUrl: "", gift: false })).toBe("Для кнопки нужны и надпись, и адрес");
    expect(validateBroadcast({ body: "Привет", buttonText: "Кнопка", buttonUrl: "http://x.ru", gift: false })).toBe(
      "Адрес кнопки должен начинаться с https://",
    );
    const input = { body: "**Подарок** <для вас>", buttonText: "Забрать", buttonUrl: "https://taromba.com", gift: false };
    expect(validateBroadcast(input)).toBeNull();
    expect(broadcastHtml(input)).toBe("<b>Подарок</b> &lt;для вас&gt;\n\n<i>Отключить сообщения — /stop</i>");

    const [b] = await db.insert(broadcasts).values({ body: input.body, total: 2 }).returning();
    await runBroadcast(db, cfg, b!.id, [TG, 13], input);
    const [after] = await db.select().from(broadcasts);
    expect(after).toMatchObject({ sent: 1, failed: 1 });
    expect(after!.finishedAt).not.toBeNull();
    expect(calls()[0]!.body.reply_markup).toEqual({ inline_keyboard: [[{ text: "Забрать", url: "https://taromba.com" }]] });
  });

  it("ссылка на бота с источником: запоминается первое касание, «Открыть» — через короткий адрес", async () => {
    const reply = await botReply(db, cfg, 4242, "/start r3", new Date());
    expect(reply.buttons[0]).toEqual({ text: "Открыть", webApp: "https://example.com/r3", icon: "moon" });
    await botReply(db, cfg, 4242, "/start karta", new Date());
    expect(await telegramStartSource(db, 4242)).toBe("r3");
    expect(await db.select().from(telegramStarts)).toHaveLength(1);
    expect(await telegramStartSource(db, 1)).toBeNull();
    // Несуществующий источник — не запоминается
    await botReply(db, cfg, 4343, "/start rr", new Date());
    expect(await telegramStartSource(db, 4343)).toBeNull();
  });

  it("сводка по боту", async () => {
    const { chat } = await chatFor(TG);
    await chatFor(TG);
    await db.insert(messages).values({ conversationId: chat.id, author: "client", body: "из бота", viaTelegram: true });
    const stats = await botStats(db, null);
    expect(stats).toMatchObject({ subscribers: 1, linkedLeads: 2, repliedLeads: 1, repliedMessages: 1, reminders: 0, reviewAsks: 0 });
  });

  it("выбор эксперта в боте: карточка листается в том же сообщении, «Написать» открывает чат", async () => {
    const { lead, expertId } = await chatFor(TG, "Мария | Таролог");
    const second = await createExpert(db, { name: "Ольга | Астролог", login: "olga-pick", password: "пароль-эксперта" });
    if (!second.ok) throw new Error(second.error);
    await setExpertOnline(db, second.id, true, new Date());

    await showExperts(db, cfg, TG, TG, 0);
    let sent = calls();
    expect(sent[0]!.method).toBe("sendPhoto");
    expect(sent[0]!.body.caption).toContain("<b>Мария</b> · Таролог");
    const kb = (sent[0]!.body.reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] }).inline_keyboard;
    expect(kb[0]!.map((b) => b.text)).toEqual(["◀", "1 из 2", "▶"]);
    // С Марией чат уже есть
    expect(kb[1]![0]).toMatchObject({ text: "Продолжить чат", callback_data: `exw:${expertId}` });

    expect(await handleExpertCallback(db, cfg, { id: "q", userId: TG, chatId: TG, messageId: 555, data: "ex:1" })).toBe(true);
    sent = calls();
    const edit = sent.find((c) => c.method === "editMessageMedia");
    expect(edit?.body.message_id).toBe("555");
    expect((edit?.body.media as { caption: string }).caption).toContain("<b>Ольга</b> · Астролог");

    await handleExpertCallback(db, cfg, { id: "q2", userId: TG, chatId: TG, messageId: 555, data: `exw:${second.id}` });
    const chats = await db.select().from(conversations).where(eq(conversations.leadId, lead.id));
    expect(chats.map((c) => c.expertId).sort()).toEqual([expertId, second.id].sort());
    const opened = calls().find((c) => c.method === "sendMessage");
    expect(opened?.body.text).toContain("Чат с экспертом <b>Ольга</b> открыт");
    // Следующее сообщение из бота уйдёт в новый чат
    const reply = await handleClientMessage(db, cfg, { message_id: 9, chat: { id: TG, type: "private" }, from: { id: TG }, text: "Здравствуйте!" });
    expect(reply).toEqual({ handled: true, reply: "Отправлено эксперту <b>Ольга</b>. Ответ придёт сюда." });

    // Без заявки — сначала разбор
    await handleExpertCallback(db, cfg, { id: "q3", userId: 31337, chatId: 31337, messageId: null, data: `exw:${second.id}` });
    expect(calls().filter((c) => c.method === "sendMessage").at(-1)?.body.text).toContain("Сначала получите бесплатный разбор");
  });
});
