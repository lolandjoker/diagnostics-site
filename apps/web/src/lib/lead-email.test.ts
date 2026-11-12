import { eq } from "drizzle-orm";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { leads } from "@/db/schema";
import { blockClient } from "./blocks";
import { FULL_TEXT_DELAY_MS, deliverDueFullTexts, inbox, markClientRead, postMessage, startConversation } from "./chat";
import { createExpert, setExpertFullText, setExpertOnline } from "./experts";
import {
  EMAIL_CHANGE_GAP_MS,
  MESSAGE_EMAIL_DELAY_MS,
  MESSAGE_EMAIL_WINDOW_MS,
  connectEmail,
  deliverDueMessageEmails,
  emailStats, leadFromOptOutCode,
  normalizeEmail,
  optOutCode,
  optOutEmail,
  sendFullTextEmail,
} from "./lead-email";
import { createLead } from "./leads";
import { DEFAULT_UNISENDER_GO_API_URL, mailConfig, sendMail, setMailTransport } from "./mail";

const SECRET = "test-secret-test-secret-test-secret";
let db: Db;
let sent: { to: string; from: string; subject: string; text: string; html: string }[];
let failNext = false;
let n = 0;

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  failNext = false;
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("SITE_DOMAIN", "taromba.test");
  vi.stubEnv("UNISENDER_GO_API_KEY", "test-key");
  vi.stubEnv("MAIL_FROM", "Таромба <noreply@taromba.test>");
  setMailTransport({
    sendMail: async (m: object) => {
      if (failNext) {
        failNext = false;
        throw new Error("SMTP недоступен");
      }
      sent.push(m as (typeof sent)[number]);
    },
  });
});

afterEach(() => {
  setMailTransport(null);
  vi.unstubAllEnvs();
});

async function chat(name = "Анна Петрова") {
  const e = await createExpert(db, { name: "Мария | Таролог", login: `maria-${++n}`, password: "пароль-эксперта" });
  if (!e.ok) throw new Error(e.error);
  await setExpertOnline(db, e.id, true, new Date());
  await setExpertFullText(db, e.id, "Первый абзац разбора, {name}.\n\nВторой абзац <важно>.");
  const lead = await createLead(db, { name, birthDate: "1990-03-15" }, new Date(), null, null);
  const res = await startConversation(db, lead, e.id, new Date());
  if (!res.ok) throw new Error(res.error);
  return { lead, c: res.conversation };
}

const later = () => new Date(Date.now() + FULL_TEXT_DELAY_MS + 60_000);
/** Письмо уходит в фоне после разбора — ждём. */
async function waitMail(count: number) {
  for (let i = 0; i < 100 && sent.length < count; i++) await new Promise((r) => setTimeout(r, 20));
}

describe("почта клиента", () => {
  it("адрес: пробелы и регистр, явные ошибки", () => {
    expect(normalizeEmail("  Anna.P@Mail.RU ")).toBe("anna.p@mail.ru");
    expect(normalizeEmail("anna@почта.рф")).toBe("anna@почта.рф");
    for (const bad of ["anna", "anna@", "@mail.ru", "anna@mail", "an na@mail.ru", "anna@mail.r", "a<b>@mail.ru"]) expect(normalizeEmail(bad)).toBeNull();
  });

  it("почта до разбора: письмо уходит, когда разбор пришёл, один раз — с текстом, кнопкой в чат и отпиской", async () => {
    const { lead, c } = await chat();
    expect(await connectEmail(db, lead.id, " Anna@Mail.ru ", new Date())).toEqual({ ok: true, sentNow: false });
    expect(sent).toHaveLength(0);

    await deliverDueFullTexts(db, later());
    await waitMail(1);
    await deliverDueFullTexts(db, later());
    expect(await sendFullTextEmail(db, lead.id, new Date())).toBe(false);
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe("anna@mail.ru");
    expect(m.subject).toBe("Ваш подробный разбор готов");
    expect(m.text).toContain("Анна, ваш подробный разбор готов");
    expect(m.text).toContain("Первый абзац разбора, Анна Петрова.");
    expect(m.text).toContain(`https://taromba.test/razbor/${lead.id}/chat?c=${c.id}`);
    expect(m.html).toContain("Второй абзац &lt;важно&gt;.");
    expect(m.html).toContain("Эксперт <b>Мария</b>");
    const unsub = `https://taromba.test/pochta/otpiska?t=${optOutCode(SECRET, lead.id)}`;
    expect(m.text).toContain(unsub);
    expect(m.html).toContain(unsub);
    expect(m.from).toBe("Таромба <noreply@taromba.test>");
  });

  it("почта после разбора — письмо сразу; не ушло — отметки нет, можно снова", async () => {
    const { lead } = await chat();
    await deliverDueFullTexts(db, later());
    failNext = true;
    expect(await connectEmail(db, lead.id, "anna@mail.ru", new Date())).toEqual({ ok: true, sentNow: false });
    const [row] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(row!.emailFullTextSentAt).toBeNull();
    expect(await connectEmail(db, lead.id, "anna@mail.ru", new Date())).toEqual({ ok: true, sentNow: true });
    expect(sent.map((m) => m.to)).toEqual(["anna@mail.ru"]);
  });

  it("отписка по ссылке: подпись проверяется, писем больше нет; новая почта снова подписывает", async () => {
    const { lead } = await chat();
    const code = optOutCode(SECRET, lead.id);
    expect(leadFromOptOutCode(SECRET, code)).toBe(lead.id);
    expect(leadFromOptOutCode("другой-секрет", code)).toBeNull();
    expect(leadFromOptOutCode(SECRET, code.replace(/.$/, (ch) => (ch === "0" ? "1" : "0")))).toBeNull();

    await connectEmail(db, lead.id, "anna@mail.ru", new Date());
    expect(await optOutEmail(db, lead.id, new Date())).toBe(true);
    await deliverDueFullTexts(db, later());
    await new Promise((r) => setTimeout(r, 100));
    expect(sent).toHaveLength(0);

    // Сменить почту сразу нельзя — защита от перебора чужих адресов
    expect(await connectEmail(db, lead.id, "other@mail.ru", new Date())).toMatchObject({ ok: false, status: 429 });
    // Через минуту — можно, подписка снова включена, разбор уже есть — письмо сразу
    expect(await connectEmail(db, lead.id, "other@mail.ru", new Date(Date.now() + EMAIL_CHANGE_GAP_MS + 1000))).toEqual({ ok: true, sentNow: true });
    expect(sent.map((m) => m.to)).toEqual(["other@mail.ru"]);
  });

  it("почта не настроена — адрес сохраняем, письмо не уходит и не отмечается", async () => {
    vi.stubEnv("UNISENDER_GO_API_KEY", "");
    expect(mailConfig()).toBeNull();
    const { lead } = await chat();
    await deliverDueFullTexts(db, later());
    expect(await connectEmail(db, lead.id, "anna@mail.ru", new Date())).toEqual({ ok: true, sentNow: false });
    const [row] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(row).toMatchObject({ email: "anna@mail.ru", emailFullTextSentAt: null });
    expect(await connectEmail(db, lead.id, "плохо", new Date())).toMatchObject({ ok: false, status: 400 });
  });
});

describe("отправка через Web API UniSender Go", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = realFetch;
  });

  it("настройки из .env, запрос email/send.json с ключом, ответ: успех, отказ по адресу, ошибка сервиса", async () => {
    setMailTransport(null);
    expect(mailConfig({ UNISENDER_GO_API_KEY: "k", MAIL_FROM: "Таромба <noreply@taromba.com>" })).toEqual({
      apiUrl: DEFAULT_UNISENDER_GO_API_URL,
      apiKey: "k",
      fromEmail: "noreply@taromba.com",
      fromName: "Таромба",
    });
    expect(mailConfig({ UNISENDER_GO_API_KEY: "k", MAIL_FROM: "noreply@taromba.com", UNISENDER_GO_API_URL: "https://go1.example/api/" })).toMatchObject({
      apiUrl: "https://go1.example/api",
      fromName: "",
    });
    expect(mailConfig({ UNISENDER_GO_API_KEY: "k", MAIL_FROM: "не адрес" })).toBeNull();

    const replies = [
      { status: 200, body: { status: "success", job_id: "1", emails: ["a@b.ru"] } },
      { status: 200, body: { status: "success", job_id: "2", emails: [], failed_emails: { "a@b.ru": "unsubscribed" } } },
      { status: 400, body: { status: "error", message: "domain not verified" } },
    ];
    const fetchMock = vi.fn(async () => {
      const r = replies.shift()!;
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    vi.stubGlobal("fetch", fetchMock);
    const cfg = mailConfig({ UNISENDER_GO_API_KEY: "secret", MAIL_FROM: "Таромба <noreply@taromba.com>" })!;
    const mail = { to: "a@b.ru", subject: "Тема", html: "<p>Привет</p>", text: "Привет" };
    expect(await sendMail(cfg, mail)).toBe(true);
    expect(await sendMail(cfg, mail)).toBe(false);
    expect(await sendMail(cfg, mail)).toBe(false);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_UNISENDER_GO_API_URL}/email/send.json`);
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("secret");
    expect(JSON.parse(String(init.body))).toEqual({
      message: {
        recipients: [{ email: "a@b.ru" }],
        subject: "Тема",
        body: { html: "<p>Привет</p>", plaintext: "Привет" },
        from_email: "noreply@taromba.com",
        from_name: "Таромба",
        global_language: "ru",
        track_links: 0,
        track_read: 0,
      },
    });
  });
});

describe("статистика почты для «Сводки» и пометка в списке чатов", () => {
  it("по заявкам за период: указали, письмо ушло, отписались; в списке чатов — email только у подписанных", async () => {
    const { lead } = await chat("Анна");
    const { lead: second } = await chat("Ольга");
    await chat("Без почты");
    await connectEmail(db, lead.id, "anna@mail.ru", new Date());
    await connectEmail(db, second.id, "olga@mail.ru", new Date());
    await deliverDueFullTexts(db, later());
    await waitMail(2);
    await optOutEmail(db, second.id, new Date());

    expect(await emailStats(db, null)).toEqual({ leads: 3, withEmail: 2, sent: 2, optedOut: 1 });
    expect(await emailStats(db, new Date(Date.now() + 60_000))).toEqual({ leads: 0, withEmail: 0, sent: 0, optedOut: 0 });

    const items = await inbox(db, {});
    const byName = Object.fromEntries(items.map((i) => [i.leadName, i.email]));
    expect(byName).toEqual({ Анна: true, Ольга: false, "Без почты": false });
  });
});

describe("письмо «Вам написал эксперт»", () => {
  const at = (ms: number) => new Date(Date.now() + ms);
  const due = () => at(MESSAGE_EMAIL_DELAY_MS + 5_000);

  async function withEmail(name = "Анна Петрова") {
    const x = await chat(name);
    await db.update(leads).set({ email: "anna@mail.ru", emailAt: new Date() }).where(eq(leads.id, x.lead.id));
    return x;
  }

  it("на каждое сообщение эксперта без ответа через 2 минуты — письмо, один раз", async () => {
    const { lead, c } = await withEmail();
    await postMessage(db, c.id, { author: "expert", expertId: c.expertId, body: "Анна, вижу у вас <важный> период.\n\nРасскажите подробнее?" });
    await postMessage(db, c.id, { author: "admin", body: "И ещё вопрос" });
    expect(await deliverDueMessageEmails(db, at(60_000))).toBe(0);
    expect(await deliverDueMessageEmails(db, due())).toBe(2);
    expect(await deliverDueMessageEmails(db, due())).toBe(0);
    expect(sent).toHaveLength(2);
    const m = sent[0]!;
    expect(m.to).toBe("anna@mail.ru");
    expect(m.subject).toBe("Вам написал эксперт Мария");
    expect(m.html).toContain("Анна, вам написал эксперт Мария");
    expect(m.html).toContain("&lt;важный&gt;");
    expect(m.html).toContain(`/razbor/${lead.id}/chat?c=${c.id}`);
    expect(leadFromOptOutCode(SECRET, /otpiska\?t=([^"&\s]+)/.exec(m.html)?.[1] ?? "")).toBe(lead.id);
    expect(sent[1]!.text).toContain("И ещё вопрос");
  });

  it("ответил или открыл чат — письма нет; приветствие, разбор, старые сообщения — тоже", async () => {
    const a = await withEmail();
    await postMessage(db, a.c.id, { author: "expert", expertId: a.c.expertId, body: "Вопрос 1" });
    await postMessage(db, a.c.id, { author: "client", body: "Ответ" });
    const b = await withEmail("Ольга");
    await postMessage(db, b.c.id, { author: "expert", expertId: b.c.expertId, body: "Вопрос 2" });
    await markClientRead(db, b.c.id, at(1_000));
    const c = await withEmail("Ирина");
    await postMessage(db, c.c.id, { author: "expert", expertId: c.c.expertId, body: "Привет", automatic: true });
    await postMessage(db, c.c.id, { author: "system", body: "Разбор" });
    expect(await deliverDueMessageEmails(db, due())).toBe(0);
    // Сообщение старше окна — без письма
    await postMessage(db, c.c.id, { author: "expert", expertId: c.c.expertId, body: "Давно" });
    expect(await deliverDueMessageEmails(db, at(MESSAGE_EMAIL_WINDOW_MS + 60_000))).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("без почты, отписался или заблокирован — письма нет", async () => {
    const none = await chat("Без почты");
    await postMessage(db, none.c.id, { author: "expert", expertId: none.c.expertId, body: "Вопрос" });
    const out = await withEmail("Отписалась");
    await optOutEmail(db, out.lead.id, new Date());
    await postMessage(db, out.c.id, { author: "expert", expertId: out.c.expertId, body: "Вопрос" });
    const blocked = await withEmail("Спам");
    await blockClient(db, blocked.lead.id);
    await postMessage(db, blocked.c.id, { author: "admin", body: "Вопрос" });
    expect(await deliverDueMessageEmails(db, due())).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
