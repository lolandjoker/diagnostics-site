import { createHmac } from "node:crypto";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { messages } from "@/db/schema";
import { markClientRead, startConversation } from "./chat";
import { createExpert, setExpertOnline } from "./experts";
import { createLead } from "./leads";
import {
  INIT_DATA_MAX_AGE_MS,
  LOGIN_CODE_MS,
  botReply,
  leadForTelegramUser,
  leadFromLinkCode,
  leadFromLoginCode,
  linkCode,
  loginCode,
  newMessagesLabel,
  noticeText,
  notifyClient,
  telegramConfig,
  verifyInitData,
  webhookSecret,
} from "./telegram";

const TOKEN = "123456789:AAHtestTOKENtestTOKENtestTOKENtest12";

/** initData, подписанные так же, как подписывает Telegram. */
function signedInitData(fields: Record<string, string>, token = TOKEN): string {
  const checkString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const now = new Date("2026-10-28T12:00:00Z");
const authDate = String(Math.floor(now.getTime() / 1000) - 60);
const user = JSON.stringify({ id: 777000111, first_name: "Анна", username: "anna" });

describe("данные из Telegram", () => {
  it("подпись Telegram принимается, подделка и чужой токен — нет", () => {
    const data = signedInitData({ auth_date: authDate, query_id: "AAE1", user });
    expect(verifyInitData(data, TOKEN, now)).toEqual({ id: 777000111, firstName: "Анна" });

    const forged = data.replace(encodeURIComponent("777000111"), encodeURIComponent("777000112"));
    expect(verifyInitData(forged, TOKEN, now)).toBeNull();
    expect(verifyInitData(signedInitData({ auth_date: authDate, user }, "1:другой-токен"), TOKEN, now)).toBeNull();
    expect(verifyInitData("user=1&hash=zz", TOKEN, now)).toBeNull();
    expect(verifyInitData("", TOKEN, now)).toBeNull();
  });

  it("старые данные не принимаются", () => {
    const old = String(Math.floor((now.getTime() - INIT_DATA_MAX_AGE_MS) / 1000) - 1);
    expect(verifyInitData(signedInitData({ auth_date: old, user }), TOKEN, now)).toBeNull();
  });

  it("без токена или домена бот выключен", () => {
    expect(telegramConfig({})).toBeNull();
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN })).toBeNull();
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: "не токен", SITE_DOMAIN: "example.com" })).toBeNull();
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN, SITE_DOMAIN: "example.com" })).toEqual({
      token: TOKEN,
      siteUrl: "https://example.com",
    });
    expect(webhookSecret(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
    expect(webhookSecret(TOKEN)).not.toContain(TOKEN);
  });

  it("текст уведомления: сколько новых сообщений и от какого эксперта, без самого текста", () => {
    expect(noticeText({ kind: "message", expertId: 1 }, "Вера", "Анна")).toBe("💬 У вас 1 новое сообщение от эксперта Вера");
    expect(noticeText({ kind: "message", expertId: 1 }, "Вера", "Анна", 3)).toBe("💬 У вас 3 новых сообщения от эксперта Вера");
    expect([1, 2, 5, 11, 21, 22, 25, 112].map(newMessagesLabel)).toEqual([
      "1 новое сообщение",
      "2 новых сообщения",
      "5 новых сообщений",
      "11 новых сообщений",
      "21 новое сообщение",
      "22 новых сообщения",
      "25 новых сообщений",
      "112 новых сообщений",
    ]);
    expect(noticeText({ kind: "fullText" }, "Мария", "Анна")).toContain("Анна, ваш подробный разбор готов");
    expect(noticeText({ kind: "call", expertId: 1 }, "Мария", "Анна")).toBe("📞 Мария звонит вам — откройте чат, чтобы ответить.");
  });

  it("код привязки и код входа: подпись, срок, подделка", () => {
    const leadId = "0f8b7c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f";
    const code = linkCode(TOKEN, leadId);
    expect(code).toMatch(/^[\w-]{1,64}$/);
    expect(leadFromLinkCode(TOKEN, code)).toBe(leadId);
    expect(leadFromLinkCode("1:другой-токен", code)).toBeNull();
    expect(leadFromLinkCode(TOKEN, code.replace(/.$/, (c) => (c === "0" ? "1" : "0")))).toBeNull();
    expect(leadFromLinkCode(TOKEN, "")).toBeNull();

    const login = loginCode(TOKEN, leadId, now);
    expect(leadFromLoginCode(TOKEN, login, now)).toBe(leadId);
    expect(leadFromLoginCode(TOKEN, login, new Date(now.getTime() + LOGIN_CODE_MS + 1000))).toBeNull();
    expect(leadFromLoginCode(TOKEN, login.replace(leadId, "0f8b7c1e-2d3a-4b5c-8d9e-0a1b2c3d4e50"), now)).toBeNull();
    expect(leadFromLoginCode(TOKEN, code, now)).toBeNull();
  });
});

describe("бот: привязка заявки с сайта, /start, /stop", () => {
  const cfg = { token: TOKEN, siteUrl: "https://example.com" };
  const tg = 555000222;

  it("ссылка с сайта привязывает заявку; бот узнаёт человека и даёт вход на сайт; /stop отвязывает", async () => {
    const db = await createTestDb();
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, new Date(), null);

    // Новый человек — приветствие и «Открыть»
    let reply = await botReply(db, cfg, tg, "/start", now);
    expect(reply.buttons).toEqual([{ text: "Открыть", webApp: "https://example.com" }]);
    // Испорченная ссылка — ничего не привязано
    reply = await botReply(db, cfg, tg, "/start lнеткода", now);
    expect(reply.text).toContain("Ссылка не подошла");
    expect(await leadForTelegramUser(db, tg)).toBeNull();

    reply = await botReply(db, cfg, tg, `/start ${linkCode(TOKEN, lead.id)}`, now);
    expect(reply.text).toContain("Анна, Telegram подключён");
    expect(await leadForTelegramUser(db, tg)).toBe(lead.id);
    expect(reply.buttons[0]).toEqual({ text: "Открыть разбор", webApp: `https://example.com/razbor/${lead.id}` });
    const site = reply.buttons[1];
    if (!site || !("url" in site)) throw new Error("нет кнопки «Открыть на сайте»");
    const code = new URL(site.url).searchParams.get("t") ?? "";
    expect(new URL(site.url).pathname).toBe("/api/telegram/vhod");
    expect(leadFromLoginCode(TOKEN, code, now)).toBe(lead.id);

    // Потом — свой человек, с кнопкой в чат
    const expert = await createExpert(db, { name: "Мария", login: "maria-bot", password: "пароль-эксперта" });
    if (!expert.ok) throw new Error(expert.error);
    await setExpertOnline(db, expert.id, true, new Date());
    await startConversation(db, lead, expert.id, new Date());
    reply = await botReply(db, cfg, tg, "привет", now);
    expect(reply.text).toContain("Здравствуйте, Анна!");
    expect(reply.buttons[0]).toEqual({ text: "Открыть чат", webApp: `https://example.com/razbor/${lead.id}/chat` });

    reply = await botReply(db, cfg, tg, "/stop", now);
    expect(reply.text).toContain("Уведомления отключены");
    expect(await leadForTelegramUser(db, tg)).toBeNull();
    expect((await botReply(db, cfg, tg, "/stop", now)).text).toContain("и так не подключены");
  });
});

describe("уведомления клиенту из бота", () => {
  let db: Db;
  let fetchMock: ReturnType<typeof vi.fn>;
  let experts = 0;

  beforeEach(async () => {
    db = await createTestDb();
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function chatFor(telegramUserId: number | null) {
    const expert = await createExpert(db, { name: "Мария", login: `maria${++experts}`, password: "пароль-эксперта" });
    if (!expert.ok) throw new Error(expert.error);
    await setExpertOnline(db, expert.id, true, new Date());
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, new Date(), null, telegramUserId);
    const started = await startConversation(db, lead, expert.id, new Date());
    if (!started.ok) throw new Error(started.error);
    // Бот включается после подготовки — приветствие при открытии чата уведомлений не шлёт
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    vi.stubEnv("SITE_DOMAIN", "example.com");
    vi.stubGlobal("fetch", fetchMock);
    return { lead, chat: started.conversation, expertId: expert.id };
  }

  type Sent = {
    chat_id: number;
    message_id?: number;
    text: string;
    reply_markup: { inline_keyboard: { text: string; web_app: { url: string } }[][] };
  };
  const call = (i: number) => {
    const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
    return { method: url.split("/").pop(), body: JSON.parse(String(init.body)) as Sent };
  };
  const expertSays = (conversationId: string, expertId: number, at = new Date()) =>
    db.insert(messages).values({ conversationId, author: "expert", expertId, body: "…", createdAt: at });

  it("ответ эксперта — «У вас 1 новое сообщение» с кнопкой «Прочитать»; следующие меняют число", async () => {
    const { lead, chat, expertId } = await chatFor(777000111);
    expect(await leadForTelegramUser(db, 777000111)).toBe(lead.id);
    expect(await leadForTelegramUser(db, 1)).toBeNull();

    await expertSays(chat.id, expertId);
    await notifyClient(db, chat.id, { kind: "message", expertId });
    expect(call(0).method).toBe("sendMessage");
    expect(call(0).body.chat_id).toBe(777000111);
    expect(call(0).body.text).toBe("💬 У вас 1 новое сообщение от эксперта Мария");
    expect(call(0).body.reply_markup.inline_keyboard[0]?.[0]).toEqual({
      text: "Прочитать",
      web_app: { url: `https://example.com/razbor/${lead.id}/chat?c=${chat.id}` },
    });

    // Ещё два сообщения, клиент не читал — то же уведомление, число растёт, нового звука нет
    await expertSays(chat.id, expertId);
    await notifyClient(db, chat.id, { kind: "message", expertId });
    await expertSays(chat.id, expertId);
    await notifyClient(db, chat.id, { kind: "message", expertId });
    expect(call(2).method).toBe("editMessageText");
    expect(call(2).body.message_id).toBe(42);
    expect(call(2).body.text).toBe("💬 У вас 3 новых сообщения от эксперта Мария");

    // Прочитал и ушёл — следующее сообщение приходит новым уведомлением
    const read = new Date(Date.now() + 1000);
    await markClientRead(db, chat.id, read);
    await expertSays(chat.id, expertId, new Date(read.getTime() + 1000));
    await notifyClient(db, chat.id, { kind: "message", expertId }, new Date(read.getTime() + 60_000));
    expect(call(3).method).toBe("sendMessage");
    expect(call(3).body.text).toBe("💬 У вас 1 новое сообщение от эксперта Мария");
  });

  it("эксперт звонит — бот зовёт ответить", async () => {
    const { lead, chat, expertId } = await chatFor(777000111);
    await notifyClient(db, chat.id, { kind: "call", expertId });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as {
      text: string;
      reply_markup: { inline_keyboard: { text: string; web_app: { url: string } }[][] };
    };
    expect(body.text).toBe("📞 Мария звонит вам — откройте чат, чтобы ответить.");
    expect(body.reply_markup.inline_keyboard[0]?.[0]).toEqual({
      text: "Ответить",
      web_app: { url: `https://example.com/razbor/${lead.id}/chat?c=${chat.id}` },
    });
  });

  it("клиент сейчас в чате или пришёл не из Telegram — не беспокоим", async () => {
    const { chat, expertId } = await chatFor(777000111);
    await markClientRead(db, chat.id, new Date());
    await notifyClient(db, chat.id, { kind: "message", expertId });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
    const site = await chatFor(null);
    await notifyClient(db, site.chat.id, { kind: "fullText" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
