import { julianDayUT, julianEphemerisDay, localToUtcMs, zoneOffsetMs } from "./time";

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const local = (year: number, month: number, day: number, hour: number, minute = 0) =>
  ({ year, month, day, hour, minute });

describe("localToUtcMs — местное время в UTC с историей часовых поясов", () => {
  it.each([
    // Москва: в марте 1990 — зимнее время UTC+3 (летнее началось 25.03.1990)
    ["Europe/Moscow", local(1990, 3, 15, 12), "1990-03-15T09:00"],
    // Москва: летом 1990 — летнее время UTC+4
    ["Europe/Moscow", local(1990, 7, 1, 12), "1990-07-01T08:00"],
    // Москва 2012: постоянное UTC+4 (2011–2014)
    ["Europe/Moscow", local(2012, 7, 1, 12), "2012-07-01T08:00"],
    // Москва 2020: UTC+3
    ["Europe/Moscow", local(2020, 7, 1, 12), "2020-07-01T09:00"],
    // Новосибирск 2000: UTC+6
    ["Asia/Novosibirsk", local(2000, 1, 1, 12), "2000-01-01T06:00"],
    // Нью-Йорк зимой: UTC−5
    ["America/New_York", local(2024, 1, 15, 12), "2024-01-15T17:00"],
  ])("%s %o → %s UTC", (zone, t, expected) => {
    expect(iso(localToUtcMs(t, zone))).toBe(expected);
  });

  it("несуществующее время (перевод вперёд) сдвигается вперёд", () => {
    // 28.03.2010 в Москве часы перевели с 02:00 на 03:00; 02:30 не было → 03:30 MSD = 23:30 UTC 27.03
    expect(iso(localToUtcMs(local(2010, 3, 28, 2, 30), "Europe/Moscow"))).toBe("2010-03-27T23:30");
  });

  it("неоднозначное время (перевод назад) — по зимнему времени", () => {
    // 31.10.2010 в Москве 02:30 было дважды; берём второе, UTC+3 → 23:30 UTC 30.10
    expect(iso(localToUtcMs(local(2010, 10, 31, 2, 30), "Europe/Moscow"))).toBe("2010-10-30T23:30");
  });

  it("неизвестный часовой пояс — понятная ошибка", () => {
    expect(() => localToUtcMs(local(2000, 1, 1, 12), "Mars/Olympus")).toThrow("Неизвестный часовой пояс");
  });

  it("смещение вместо названия пояса («+05:30») не принимается — нужен пояс с историей", () => {
    expect(() => localToUtcMs(local(2000, 1, 1, 12), "+05:30")).toThrow("Неизвестный часовой пояс");
    expect(() => localToUtcMs(local(2000, 1, 1, 12), "-03:00")).toThrow("Неизвестный часовой пояс");
  });

  it("регистр в названии пояса не важен, результат тот же", () => {
    expect(localToUtcMs(local(2020, 7, 1, 12), "europe/moscow")).toBe(localToUtcMs(local(2020, 7, 1, 12), "Europe/Moscow"));
  });

  it("пояса с дробным смещением: Индия +5:30, Непал +5:45", () => {
    expect(iso(localToUtcMs(local(2024, 1, 1, 12), "Asia/Kolkata"))).toBe("2024-01-01T06:30");
    expect(iso(localToUtcMs(local(2024, 1, 1, 12), "Asia/Kathmandu"))).toBe("2024-01-01T06:15");
  });
});

describe("zoneOffsetMs", () => {
  it("Москва в 2012 году — +4 часа", () => {
    expect(zoneOffsetMs(Date.UTC(2012, 0, 1), "Europe/Moscow")).toBe(4 * 3600_000);
  });
});

describe("юлианские дни", () => {
  it("J2000.0: 2000-01-01 12:00 UT = 2451545.0", () => {
    expect(julianDayUT(Date.UTC(2000, 0, 1, 12))).toBe(2_451_545.0);
  });

  it("ΔT около 2000 года ≈ 64 с", () => {
    const ms = Date.UTC(2000, 0, 1, 12);
    const dtSeconds = (julianEphemerisDay(ms) - julianDayUT(ms)) * 86_400;
    expect(dtSeconds).toBeGreaterThan(62);
    expect(dtSeconds).toBeLessThan(66);
  });
});
