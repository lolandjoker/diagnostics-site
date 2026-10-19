import { findAspects } from "./aspects";
import { natalChart } from "./chart";
import { formatPosition, zodiacPosition } from "./signs";

const moscow = { timeZone: "Europe/Moscow", latitude: 55.7558, longitude: 37.6173 };

describe("natalChart", () => {
  it("15.03.1990 14:30, Москва: Солнце в Рыбах в 9-м доме, асцендент во Льве, MC в Овне", () => {
    const c = natalChart({ year: 1990, month: 3, day: 15, time: { hour: 14, minute: 30 }, ...moscow });
    expect(c.utc).toBe("1990-03-15T11:30:00.000Z");
    expect(c.timeKnown).toBe(true);
    expect(c.bodies.sun.sign).toBe("pisces");
    expect(c.bodies.sun.house).toBe(9);
    expect(c.bodies.saturn.sign).toBe("capricorn");
    expect(c.bodies.pluto.sign).toBe("scorpio");
    expect(zodiacPosition(c.houses?.asc ?? NaN).sign).toBe("leo");
    expect(zodiacPosition(c.houses?.mc ?? NaN).sign).toBe("aries");
    expect(c.moonSignUncertain).toBe(false);
  });

  it("без времени: карта на полдень, без домов, у планет house = null", () => {
    const c = natalChart({ year: 1990, month: 3, day: 15, ...moscow });
    expect(c.timeKnown).toBe(false);
    expect(c.houses).toBeNull();
    expect(c.bodies.sun.house).toBeNull();
    expect(c.utc).toBe("1990-03-15T09:00:00.000Z");
  });

  it("без времени: помечает, что Луна за день сменила знак", () => {
    // Ищем в марте 1990 день, когда Луна переходит из знака в знак, и день без перехода
    const flags = Array.from({ length: 28 }, (_, i) =>
      natalChart({ year: 1990, month: 3, day: i + 1, ...moscow }).moonSignUncertain,
    );
    // Луна проходит знак за ~2,5 дня → смена знака примерно в каждый 2–3-й день
    const changes = flags.filter(Boolean).length;
    expect(changes).toBeGreaterThanOrEqual(9);
    expect(changes).toBeLessThanOrEqual(13);
  });

  it("с известным временем пометка про Луну не ставится", () => {
    for (let day = 1; day <= 5; day++) {
      expect(natalChart({ year: 1990, month: 3, day, time: { hour: 0, minute: 0 }, ...moscow }).moonSignUncertain).toBe(false);
    }
  });

  it("неверные данные — понятные ошибки", () => {
    expect(() => natalChart({ year: 1990, month: 2, day: 30, ...moscow })).toThrow("Такой даты не существует");
    expect(() => natalChart({ year: 1990, month: 3, day: 15, ...moscow, latitude: 95 })).toThrow("Широта");
    expect(() => natalChart({ year: 1990, month: 3, day: 15, ...moscow, longitude: 200 })).toThrow("Долгота");
    expect(() => natalChart({ year: 1990, month: 3, day: 15, ...moscow, time: { hour: 24, minute: 0 } })).toThrow("Час");
    expect(() => natalChart({ year: 1990, month: 3, day: 15, ...moscow, time: { hour: 10, minute: 60 } })).toThrow("Минуты");
  });

  it("считается быстрее 300 мс", () => {
    const t0 = Date.now();
    natalChart({ year: 2001, month: 9, day: 11, time: { hour: 8, minute: 46 }, timeZone: "America/New_York", latitude: 40.71, longitude: -74.01 });
    expect(Date.now() - t0).toBeLessThan(300);
  });
});

describe("findAspects", () => {
  it("находит точные мажорные аспекты", () => {
    const list = findAspects({ sun: 0, moon: 120, mars: 90, venus: 181 });
    const key = (a: { a: string; b: string; type: string }) => `${a.a}-${a.b}:${a.type}`;
    const keys = list.map(key);
    expect(keys).toContain("sun-moon:trine");
    expect(keys).toContain("sun-mars:square");
    expect(keys).toContain("sun-venus:opposition");
    expect(keys).toContain("mars-venus:square"); // 91° — квадрат с орбисом 1°
  });

  it("30° — не мажорный аспект: пары нет в списке", () => {
    const list = findAspects({ moon: 120, mars: 90 });
    expect(list).toEqual([]);
  });

  it("каждой паре — один, самый точный аспект; список отсортирован по точности", () => {
    const list = findAspects({ sun: 0, moon: 64, mars: 92 });
    // солнце–луна: секстиль 4° (луминар, орбис 5+2); солнце–марс: квадрат 2°; луна–марс: 28° — нет
    expect(list.map((a) => `${a.a}-${a.b}:${a.type}`)).toEqual(["sun-mars:square", "sun-moon:sextile"]);
  });

  it("орбис для Солнца и Луны шире на 2°", () => {
    expect(findAspects({ sun: 0, moon: 129 })).toHaveLength(1); // трин 9° ≤ 7 + 2
    expect(findAspects({ mars: 0, venus: 129 })).toHaveLength(0); // трин 9° > 7
  });
});

describe("formatPosition", () => {
  it.each([
    [0, "0°00′ Овен"],
    [24.75, "24°45′ Овен"],
    [359.999, "0°00′ Овен"],
    [29.9999, "0°00′ Телец"],
    [300.48, "0°29′ Водолей"],
  ])("%f → %s", (lon, text) => {
    expect(formatPosition(lon)).toBe(text);
  });
});
