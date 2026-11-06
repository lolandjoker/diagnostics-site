import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { drawDailyCard } from "./club";
import { clubStatus } from "./club-status";
import { createLead } from "./leads";
import { runArchetype } from "./quiz-archetype";
import { runCompat } from "./quiz-compat";
import { runYesNo } from "./quiz-yesno";

const morning = new Date("2026-11-05T08:00:00Z");
let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("клуб клиента в шапке чата", () => {
  it("ничего не прошёл — пусто и напоминания (без Telegram — с припиской про подключение)", async () => {
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null);
    const s = (await clubStatus(db, lead.id, morning))!;
    expect(s).toMatchObject({ telegram: false, forecast: false, cards: { total: 0, streak: 0, today: null }, compat: null, archetype: null, yesno: null });
    expect(s.reminders.archetype).toContain("«Ваш архетип»");
    expect(s.reminders.archetype).toContain("после подключения Telegram");
    expect(await clubStatus(db, "00000000-0000-0000-0000-000000000000", morning)).toBeNull();
  });

  it("прошёл — видно результаты: серия карт, процент совместимости, архетип, ответ карты", async () => {
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null, 5150);
    await drawDailyCard(db, lead.id, 1, new Date(morning.getTime() - 86_400_000));
    await drawDailyCard(db, lead.id, 2, morning);
    await runCompat(db, lead, { partnerName: "Иван", partnerBirth: "1988-07-02" }, morning);
    await runArchetype(db, lead, [1, 1, 1, 0, 3], morning);
    await runYesNo(db, lead, "Стоит ли менять работу?", morning);
    const s = (await clubStatus(db, lead.id, morning))!;
    expect(s.telegram).toBe(true);
    expect(s.cards).toMatchObject({ total: 2, streak: 2, today: expect.any(String) });
    expect(s.compat).toMatchObject({ partner: "Иван", total: expect.any(Number), again: expect.any(String) });
    expect(s.archetype).toMatchObject({ name: "Луна" });
    expect(s.yesno).toMatchObject({ question: "Стоит ли менять работу?", card: expect.any(String) });
    expect(s.reminders.compat).not.toContain("Telegram");
  });
});
