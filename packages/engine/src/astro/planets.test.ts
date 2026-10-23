import { separation, signedDiff } from "./angles";
import { BODIES, bodyLongitude, bodyPosition } from "./planets";
import type { Body } from "./planets";
import { julianEphemerisDay } from "./time";

// Эталоны — публичные астрономические события (время по UTC), независимые от библиотеки.
const jde = (isoUtc: string) => julianEphemerisDay(Date.parse(isoUtc));
const lon = (b: Body, isoUtc: string) => bodyLongitude(b, jde(isoUtc));

describe("Солнце", () => {
  it.each([
    ["весеннее равноденствие 2024-03-20 03:06", "2024-03-20T03:06:00Z", 0],
    ["летнее солнцестояние 2024-06-20 20:51", "2024-06-20T20:51:00Z", 90],
    ["осеннее равноденствие 2024-09-22 12:44", "2024-09-22T12:44:00Z", 180],
    ["зимнее солнцестояние 2023-12-22 03:27", "2023-12-22T03:27:00Z", 270],
  ])("%s → %i°", (_name, t, expected) => {
    expect(separation(lon("sun", t), expected)).toBeLessThan(0.01);
  });
});

describe("Луна", () => {
  it("новолуние 2024-04-08 18:21 (полное солнечное затмение): Луна = Солнце ≈ 19,4° Овна", () => {
    const t = "2024-04-08T18:21:00Z";
    expect(separation(lon("moon", t), lon("sun", t))).toBeLessThan(0.05);
    expect(separation(lon("sun", t), 19.4)).toBeLessThan(0.05);
  });

  it("полнолуние 2024-09-18 02:34: Луна напротив Солнца", () => {
    const t = "2024-09-18T02:34:00Z";
    expect(Math.abs(separation(lon("moon", t), lon("sun", t)) - 180)).toBeLessThan(0.05);
  });

  it("пример 47.a из «Астрономических алгоритмов» Меёса: 1992-04-12 0ч TD, видимая долгота 133,167265°", () => {
    expect(separation(bodyLongitude("moon", 2_448_724.5), 133.167265)).toBeLessThan(0.001);
  });

  it("никогда не ретроградна, скорость 11–16° в сутки", () => {
    for (const t of ["1950-06-01T00:00:00Z", "1990-03-15T12:00:00Z", "2026-10-19T00:00:00Z"]) {
      const p = bodyPosition("moon", jde(t));
      expect(p.retrograde).toBe(false);
      expect(p.speed).toBeGreaterThan(11);
      expect(p.speed).toBeLessThan(16);
    }
  });
});

describe("планеты", () => {
  it("великое соединение Юпитера и Сатурна 2020-12-21: оба ≈ 0,5° Водолея", () => {
    const t = "2020-12-21T18:00:00Z";
    expect(separation(lon("jupiter", t), lon("saturn", t))).toBeLessThan(0.15);
    expect(separation(lon("jupiter", t), 300.48)).toBeLessThan(0.1);
  });

  it("Плутон входит в Водолей 2024-11-19 ≈ 20:30", () => {
    expect(separation(lon("pluto", "2024-11-19T20:30:00Z"), 300)).toBeLessThan(0.005);
  });

  it.each([
    ["Марс", "mars", "2025-01-16T02:32:00Z"],
    ["Юпитер", "jupiter", "2023-11-03T05:03:00Z"],
    ["Сатурн", "saturn", "2024-09-08T04:35:00Z"],
  ] as const)("противостояние: %s напротив Солнца", (_name, body, t) => {
    expect(Math.abs(separation(lon(body, t), lon("sun", t)) - 180)).toBeLessThan(0.1);
  });

  it.each([
    ["Уран", "uranus", "2024-11-17T12:00:00Z"],
    ["Нептун", "neptune", "2024-09-21T12:00:00Z"],
  ] as const)("противостояние (известна только дата): %s напротив Солнца ±1°", (_name, body, t) => {
    expect(Math.abs(separation(lon(body, t), lon("sun", t)) - 180)).toBeLessThan(1);
  });

  it("Меркурий ретрограден 1–25 апреля 2024 и не ретрограден до и после", () => {
    expect(bodyPosition("mercury", jde("2024-04-10T12:00:00Z")).retrograde).toBe(true);
    expect(bodyPosition("mercury", jde("2024-03-20T12:00:00Z")).retrograde).toBe(false);
    expect(bodyPosition("mercury", jde("2024-05-10T12:00:00Z")).retrograde).toBe(false);
  });

  it("Солнце никогда не ретроградно, скорость ≈ 1° в сутки", () => {
    const p = bodyPosition("sun", jde("2026-01-01T00:00:00Z"));
    expect(p.retrograde).toBe(false);
    expect(p.speed).toBeGreaterThan(0.95);
    expect(p.speed).toBeLessThan(1.03);
  });

  it("все тела дают долготу в [0, 360) на всём диапазоне 1900–2100", () => {
    for (let year = 1900; year <= 2100; year += 7) {
      const t = jde(`${year}-06-15T00:00:00Z`);
      for (const b of BODIES) {
        const l = bodyLongitude(b, t);
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThan(360);
      }
    }
  });

  it("скорость считается через переход 360° → 0° без скачка", () => {
    // Солнце пересекает 0° Овна 2024-03-20
    expect(signedDiff(lon("sun", "2024-03-20T00:00:00Z"), lon("sun", "2024-03-21T00:00:00Z"))).toBeCloseTo(0.99, 1);
  });
});
