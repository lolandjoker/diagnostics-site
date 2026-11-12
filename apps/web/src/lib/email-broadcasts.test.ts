import { eq } from "drizzle-orm";
import type { Mock } from "vitest";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { broadcasts, leads } from "@/db/schema";
import { blockClient } from "./blocks";
import { broadcastMail } from "./broadcast-mail";
import {
  type BroadcastInput,
  audienceCounts,
  emailRecipients,
  mailEnv,
  sendTestEmail,
  startBroadcast,
  validateBroadcast,
} from "./broadcasts";
import { postMessage, startConversation } from "./chat";
import { createExpert, setExpertOnline } from "./experts";
import { leadFromOptOutCode, optOutEmail } from "./lead-email";
import { createLead } from "./leads";
import { setMailTransport } from "./mail";
import type { TelegramConfig } from "./telegram";

const SECRET = "test-secret-test-secret-test-secret";
const TOKEN = "123456789:AAHtestTOKENtestTOKENtestTOKENtest12";
const realFetch = globalThis.fetch;
let db: Db;
let sent: { to: string; subject: string; text: string; html: string }[];
let fetchMock: Mock;
let n = 0;

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("SITE_DOMAIN", "taromba.test");
  vi.stubEnv("UNISENDER_GO_API_KEY", "test-key");
  vi.stubEnv("MAIL_FROM", "Таромба <noreply@taromba.test>");
  setMailTransport({ sendMail: async (m: object) => void sent.push(m as (typeof sent)[number]) });
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }));
  vi.stubGlobal("fetch", (url: unknown, init?: RequestInit) =>
    String(url).startsWith("https://api.telegram.org/") ? fetchMock(String(url), init) : realFetch(url as string, init),
  );
});

afterEach(() => {
  setMailTransport(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function expert() {
  const e = await createExpert(db, { name: "Мария | Таролог", login: `maria-${++n}`, password: "пароль-эксперта" });
  if (!e.ok) throw new Error(e.error);
  await setExpertOnline(db, e.id, true, new Date());
  return e.id;
}

/** Заявка с почтой (и Telegram, если задан) и чатом. */
async function person(email: string | null, tg: number | null, expertId: number, name = "Анна") {
  const lead = await createLead(db, { name, birthDate: "1990-03-15" }, new Date(), null, tg);
  if (email) await db.update(leads).set({ email, emailAt: new Date() }).where(eq(leads.id, lead.id));
  const res = await startConversation(db, lead, expertId, new Date());
  if (!res.ok) throw new Error(res.error);
  return { lead, c: res.conversation };
}

const input = (patch: Partial<BroadcastInput> = {}): BroadcastInput => ({
  body: "**Подарок** для вас",
  buttonText: "",
  buttonUrl: "",
  gift: false,
  channels: "email",
  subject: "Тест «Ваш архетип»",
  ...patch,
});

async function finished(id: number) {
  for (let i = 0; i < 300; i++) {
    const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
    if (b?.finishedAt) return b;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("рассылка не закончилась");
}

describe("рассылка на почту: кому", () => {
  it("каждому адресу один раз; отписавшихся и заблокированных нет; «Кому» и «только без Telegram»", async () => {
    const e = await expert();
    // Один адрес в двух заявках — одно письмо
    await person("anna@mail.ru", null, e);
    const again = await person("anna@mail.ru", null, e);
    await postMessage(db, again.c.id, { author: "client", body: "вопрос" });
    // С Telegram
    await person("tg@mail.ru", 7001, e);
    // Отписался по одной из заявок — не берём адрес совсем
    const out = await person("out@mail.ru", null, e);
    await person("out@mail.ru", null, e);
    await db.update(leads).set({ emailOptOutAt: new Date() }).where(eq(leads.id, out.lead.id));
    // Заблокирован
    const spam = await person("spam@mail.ru", null, e);
    await blockClient(db, spam.lead.id);
    // Без почты
    await person(null, 7002, e);

    expect(await emailRecipients(db, "all")).toEqual(["anna@mail.ru", "tg@mail.ru"]);
    expect(await emailRecipients(db, "never")).toEqual(["tg@mail.ru"]);
    expect(await emailRecipients(db, "all", { skipTelegram: true })).toEqual(["anna@mail.ru"]);
    const counts = await audienceCounts(db);
    expect(counts.all).toEqual({ telegram: 2, email: 2 });
    expect(counts.never).toEqual({ telegram: 2, email: 1 });
  });

  it("«Отписаться» по одной заявке снимает адрес во всех", async () => {
    const e = await expert();
    const a = await person("anna@mail.ru", null, e);
    const b = await person("anna@mail.ru", null, e);
    await optOutEmail(db, a.lead.id, new Date());
    const [row] = await db.select({ out: leads.emailOptOutAt }).from(leads).where(eq(leads.id, b.lead.id));
    expect(row!.out).not.toBeNull();
    expect(await emailRecipients(db, "all")).toEqual([]);
  });
});

describe("рассылка на почту: отправка", () => {
  it("письмо: тема, **жирный**, личная кнопка по последней заявке, «Отписаться»; в Telegram ничего", async () => {
    const e = await expert();
    await person("anna@mail.ru", 7001, e);
    const last = await person("anna@mail.ru", 7001, e);
    const { id, total, emailTotal } = await startBroadcast(db, null, input({ personalPage: "arhetip", gift: true }), mailEnv());
    expect([total, emailTotal]).toEqual([0, 1]);
    const b = await finished(id);
    expect([b.channels, b.emailSent, b.emailFailed, b.subject]).toEqual(["email", 1, 0, "Тест «Ваш архетип»"]);
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe("anna@mail.ru");
    expect(m.subject).toBe("Тест «Ваш архетип»");
    expect(m.html).toContain("🎁 <b>Подарок</b> для вас");
    expect(m.html).toContain(`https://taromba.test/razbor/${last.lead.id}/arhetip`);
    expect(m.html).toContain("Пройти тест «Ваш архетип»");
    const code = /otpiska\?t=([^"&\s]+)/.exec(m.html)?.[1];
    expect(leadFromOptOutCode(SECRET, code ?? "")).toBe(last.lead.id);
    expect(m.text).toContain("Подарок для вас");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Telegram и почта: туда и туда; «только без Telegram» — письма лишь тем, у кого его нет", async () => {
    const e = await expert();
    await person("tg@mail.ru", 7001, e);
    await person("site@mail.ru", null, e);
    const cfg: TelegramConfig = { token: TOKEN, siteUrl: "https://taromba.test" };
    const { id, total, emailTotal } = await startBroadcast(db, cfg, input({ channels: "both", emailSkipTelegram: true }), mailEnv());
    expect([total, emailTotal]).toEqual([1, 1]);
    const b = await finished(id);
    expect([b.sent, b.emailSent, b.emailSkipTelegram]).toEqual([1, 1, true]);
    expect(sent.map((m) => m.to)).toEqual(["site@mail.ru"]);
    const tgSends = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/sendMessage"));
    expect(tgSends).toHaveLength(1);
  });

  it("фото — картинкой по адресу из хранилища, видео — ссылкой; проба на почту без заявки — без «Отписаться»", async () => {
    const photo = { kind: "photo" as const, data: Buffer.from([0xff, 0xd8, 0xff, 1]), name: "a.jpg", type: "image/jpeg" };
    const video = { kind: "video" as const, data: Buffer.from([0, 0, 0, 1]), name: "b.mp4", type: "video/mp4" };
    const ok = await sendTestEmail(
      db,
      mailEnv()!,
      "me@mail.ru",
      input({ messages: [{ body: "Смотрите", media: photo }, { body: "", media: video }] }),
    );
    expect(ok).toBe(true);
    const m = sent[0]!;
    expect(m.html).toMatch(/<img src="https:\/\/taromba\.test\/api\/chat\/media\/[0-9a-f-]{36}"/);
    expect(m.html).toMatch(/href="https:\/\/taromba\.test\/api\/chat\/media\/[0-9a-f-]{36}"[^>]*>▶ Смотреть видео/);
    expect(m.html).not.toContain("otpiska");
  });

  it("проверка: тема письма обязательна, если среди каналов почта; HTML в тексте экранируется", () => {
    expect(validateBroadcast(input({ subject: " " }))).toBe("Напишите тему письма");
    expect(validateBroadcast(input({ channels: "telegram", subject: "" }))).toBeNull();
    const m = broadcastMail({ subject: "Тема", parts: [{ body: "<script>x</script>" }], gift: false, buttons: [], optOutUrl: null });
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).not.toContain("<script>");
  });
});
