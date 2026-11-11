import { eq } from "drizzle-orm";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { leads } from "@/db/schema";
import { FULL_TEXT_DELAY_MS, deliverDueFullTexts, startConversation } from "./chat";
import { createExpert, setExpertFullText, setExpertOnline } from "./experts";
import { EMAIL_CHANGE_GAP_MS, connectEmail, leadFromOptOutCode, normalizeEmail, optOutCode, optOutEmail, sendFullTextEmail } from "./lead-email";
import { createLead } from "./leads";
import { mailConfig, setMailTransport } from "./mail";

const SECRET = "test-secret-test-secret-test-secret";
let db: Db;
let sent: { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }[];
let failNext = false;
let n = 0;

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  failNext = false;
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("SITE_DOMAIN", "taromba.test");
  vi.stubEnv("SMTP_HOST", "smtp.example.test");
  vi.stubEnv("SMTP_USER", "user");
  vi.stubEnv("SMTP_PASS", "pass");
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
    expect(m.headers).toEqual({
      "List-Unsubscribe": `<${unsub}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "X-UNISENDER-GO": '{"global_language":"ru"}',
    });
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
    vi.stubEnv("SMTP_PASS", "");
    expect(mailConfig()).toBeNull();
    const { lead } = await chat();
    await deliverDueFullTexts(db, later());
    expect(await connectEmail(db, lead.id, "anna@mail.ru", new Date())).toEqual({ ok: true, sentNow: false });
    const [row] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(row).toMatchObject({ email: "anna@mail.ru", emailFullTextSentAt: null });
    expect(await connectEmail(db, lead.id, "плохо", new Date())).toMatchObject({ ok: false, status: 400 });
  });
});
