import { eq } from "drizzle-orm";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { conversations, leads } from "@/db/schema";
import { createExpert, setExpertOnline } from "./experts";
import { createLead } from "./leads";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => jar.set(k, v),
  }),
}));
// redirect в серверном действии — исключение с адресом (как в Next)
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
let db: Db;
vi.mock("@/db", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getDb: async () => db }));

const { chooseExpert } = await import("@/app/razbor/[id]/eksperty/actions");

const form = (fields: Record<string, string | number>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, String(v));
  return f;
};
const go = (f: FormData) => chooseExpert(f).then(() => "", (e: Error) => e.message);

describe("выбор эксперта — почта обязательна", () => {
  beforeEach(async () => {
    db = await createTestDb();
    jar.clear();
  });

  it("без почты чат не начинается; с почтой — сохраняем её и открываем чат; почта уже есть — сразу в чат", async () => {
    const e = await createExpert(db, { name: "Мария | Таролог", login: "maria-1", password: "пароль-эксперта" });
    if (!e.ok) throw new Error(e.error);
    await setExpertOnline(db, e.id, true, new Date());
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, new Date(), null, null);

    expect(await go(form({ leadId: lead.id, expertId: e.id }))).toBe(
      `REDIRECT /razbor/${lead.id}/eksperty?error=${encodeURIComponent("Укажите почту — на неё придёт ваш разбор")}`,
    );
    expect(await go(form({ leadId: lead.id, expertId: e.id, email: "не почта" }))).toMatch(/error=/);
    expect(await db.select().from(conversations)).toHaveLength(0);

    const ok = await go(form({ leadId: lead.id, expertId: e.id, email: " Anna@Mail.ru " }));
    const [chat] = await db.select().from(conversations);
    expect(ok).toBe(`REDIRECT /razbor/${lead.id}/chat?c=${chat!.id}`);
    expect((await db.select().from(leads).where(eq(leads.id, lead.id)))[0]!.email).toBe("anna@mail.ru");

    // Почта уже есть — поле не нужно, тот же чат
    expect(await go(form({ leadId: lead.id, expertId: e.id }))).toBe(`REDIRECT /razbor/${lead.id}/chat?c=${chat!.id}`);
  });
});
