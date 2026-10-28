import { createHmac } from "node:crypto";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { markClientRead, startConversation } from "./chat";
import { createExpert, setExpertOnline } from "./experts";
import { createLead } from "./leads";
import {
  INIT_DATA_MAX_AGE_MS,
  leadForTelegramUser,
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

  it("текст уведомления: имя эксперта и начало сообщения", () => {
    expect(noticeText({ kind: "message", expertId: 1, body: "Добрый день!" }, "Мария", "Анна")).toBe("💬 Мария:\nДобрый день!");
    expect(noticeText({ kind: "message", expertId: 1, body: "" }, "Мария", "Анна")).toBe("💬 Мария:\n📷 Фото");
    expect(noticeText({ kind: "message", expertId: 1, body: "а".repeat(300) }, "Мария", "Анна")).toHaveLength(
      "💬 Мария:\n".length + 201,
    );
    expect(noticeText({ kind: "fullText" }, "Мария", "Анна")).toContain("Анна, ваш подробный разбор готов");
  });
});

describe("уведомления клиенту из бота", () => {
  let db: Db;
  let fetchMock: ReturnType<typeof vi.fn>;
  let experts = 0;

  beforeEach(async () => {
    db = await createTestDb();
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
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

  it("ответ эксперта — сообщение от бота с кнопкой в чат", async () => {
    const { lead, chat, expertId } = await chatFor(777000111);
    expect(await leadForTelegramUser(db, 777000111)).toBe(lead.id);
    expect(await leadForTelegramUser(db, 1)).toBeNull();

    await notifyClient(db, chat.id, { kind: "message", expertId, body: "Здравствуйте, Анна!" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    const body = JSON.parse(String(init.body)) as {
      chat_id: number;
      text: string;
      reply_markup: { inline_keyboard: { web_app: { url: string } }[][] };
    };
    expect(body.chat_id).toBe(777000111);
    expect(body.text).toBe("💬 Мария:\nЗдравствуйте, Анна!");
    expect(body.reply_markup.inline_keyboard[0]?.[0]?.web_app.url).toBe(
      `https://example.com/razbor/${lead.id}/chat?c=${chat.id}`,
    );
  });

  it("клиент сейчас в чате или пришёл не из Telegram — не беспокоим", async () => {
    const { chat, expertId } = await chatFor(777000111);
    await markClientRead(db, chat.id, new Date());
    await notifyClient(db, chat.id, { kind: "message", expertId, body: "Вы тут?" });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
    const site = await chatFor(null);
    await notifyClient(db, site.chat.id, { kind: "fullText" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
