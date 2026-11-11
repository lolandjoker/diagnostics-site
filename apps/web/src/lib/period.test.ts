import { eq } from "drizzle-orm";
import { createTestDb } from "@/db";
import { leads } from "@/db/schema";
import { botStats } from "./bot-stats";
import { funnel, presetPeriod } from "./funnel";
import { geoStats } from "./geo-stats";
import { createLead } from "./leads";
import { customPeriod, mskDay, mskDayStart } from "./period";
import { sourceStats } from "./sources";

describe("период «Сводки»", () => {
  it("свой период — с даты по дату включительно, по Москве; один день; перепутанные даты; не даты", () => {
    // 9 ноября по Москве: с 8 ноября 21:00 UTC до 9 ноября 21:00 UTC
    expect(customPeriod("2026-11-09", "2026-11-09")).toEqual({
      since: new Date("2026-11-08T21:00:00Z"),
      until: new Date("2026-11-09T21:00:00Z"),
      from: "2026-11-09",
      to: "2026-11-09",
    });
    expect(customPeriod("2026-11-08", "2026-11-02")).toMatchObject({ from: "2026-11-02", to: "2026-11-08", until: new Date("2026-11-08T21:00:00Z") });
    expect(customPeriod("2026-11-05", undefined)).toMatchObject({ from: "2026-11-05", to: "2026-11-05" });
    expect(customPeriod(undefined, undefined)).toBeNull();
    expect(customPeriod("2026-02-30", "вчера")).toBeNull();
    expect(mskDayStart("2026-13-01")).toBeNull();
    // 23:30 по Москве 9 ноября — это ещё 9 ноября
    expect(mskDay(new Date("2026-11-09T20:30:00Z"))).toBe("2026-11-09");
  });

  it("«вчера» — весь вчерашний день по Москве", () => {
    // 11 ноября, 01:00 по Москве
    expect(presetPeriod("yesterday", new Date("2026-11-10T22:00:00Z"))).toEqual({
      since: new Date("2026-11-09T21:00:00Z"),
      until: new Date("2026-11-10T21:00:00Z"),
    });
    expect(presetPeriod("week", new Date("2026-11-10T22:00:00Z")).until).toBeNull();
  });

  it("подсчёты берут только заявки внутри дней: граница «по» — полночь после последнего дня", async () => {
    const db = await createTestDb();
    const at = async (name: string, iso: string, tg: number | null = null) => {
      const lead = await createLead(db, { name, birthDate: "1990-03-15" }, new Date(), null, tg);
      await db.update(leads).set({ createdAt: new Date(iso), geoCountry: "RU", geoCity: "Москва" }).where(eq(leads.id, lead.id));
    };
    await at("8 ноября, 23:59 МСК", "2026-11-08T20:59:00Z");
    await at("9 ноября, 00:00 МСК", "2026-11-08T21:00:00Z", 501);
    await at("9 ноября, 23:59 МСК", "2026-11-09T20:59:00Z");
    await at("10 ноября, 00:00 МСК", "2026-11-09T21:00:00Z", 502);

    const day = customPeriod("2026-11-09", "2026-11-09")!;
    const leadsStep = (await funnel(db, day.since, day.until)).find((s) => s.key === "lead")!;
    expect(leadsStep.count).toBe(2);
    expect((await sourceStats(db, day.since, day.until)).find((r) => r.key === null)!.leads).toBe(2);
    expect((await geoStats(db, day.since, day.until)).countries).toEqual([{ country: "RU", city: null, leads: 2, chats: 0 }]);
    expect((await botStats(db, day.since, day.until)).linkedLeads).toBe(1);

    const two = customPeriod("2026-11-08", "2026-11-10")!;
    expect((await funnel(db, two.since, two.until)).find((s) => s.key === "lead")!.count).toBe(4);
    // Без «по» — как раньше: с даты и до сейчас
    expect((await funnel(db, day.since)).find((s) => s.key === "lead")!.count).toBe(3);
  });
});
