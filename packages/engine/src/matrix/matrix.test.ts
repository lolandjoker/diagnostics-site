import { destinyMatrix, reduce22 } from "./index";

describe("reduce22", () => {
  it("числа до 22 не меняет", () => {
    expect(reduce22(1)).toBe(1);
    expect(reduce22(22)).toBe(22);
  });

  it("числа больше 22 сворачивает суммой цифр", () => {
    expect(reduce22(23)).toBe(5);
    expect(reduce22(37)).toBe(10);
    expect(reduce22(47)).toBe(11);
    expect(reduce22(99)).toBe(18);
    expect(reduce22(199)).toBe(19);
  });

  it("не принимает отрицательные числа", () => {
    expect(() => reduce22(-1)).toThrow();
  });
});

describe("destinyMatrix", () => {
  it("15.03.1990", () => {
    // A = 15, B = 3, C = 1+9+9+0 = 19
    // D = 15+3+19 = 37 → 10; E = 15+3+19+10 = 47 → 11
    // F = 18; G = 22; H = 19+10 = 29 → 11; I = 10+15 = 25 → 7
    // небо = 3+10 = 13; земля = 15+19 = 34 → 7; личное = 20
    // мужская линия = 18+11 = 29 → 11; женская = 22+7 = 29 → 11; социальное = 22
    // духовное = 20+22 = 42 → 6
    expect(destinyMatrix({ day: 15, month: 3, year: 1990 })).toEqual({
      a: 15, b: 3, c: 19, d: 10, e: 11,
      f: 18, g: 22, h: 11, i: 7,
      sky: 13, earth: 7,
      personalPurpose: 20, socialPurpose: 22, spiritualPurpose: 6,
    });
  });

  it("22.12.1999", () => {
    // A = 22, B = 12, C = 1+9+9+9 = 28 → 10
    // D = 44 → 8; E = 52 → 7
    // F = 34 → 7; G = 22; H = 18; I = 30 → 3
    // небо = 20; земля = 32 → 5; личное = 25 → 7
    // мужская = 7+18 = 25 → 7; женская = 22+3 = 25 → 7; социальное = 14
    // духовное = 7+14 = 21
    expect(destinyMatrix({ day: 22, month: 12, year: 1999 })).toEqual({
      a: 22, b: 12, c: 10, d: 8, e: 7,
      f: 7, g: 22, h: 18, i: 3,
      sky: 20, earth: 5,
      personalPurpose: 7, socialPurpose: 14, spiritualPurpose: 21,
    });
  });

  it("день больше 22 сворачивается: 31 → 4", () => {
    expect(destinyMatrix({ day: 31, month: 1, year: 2000 }).a).toBe(4);
  });

  it("каждая точка — от 1 до 22 для всех дат 1900–2100", () => {
    const start = Date.UTC(1900, 0, 1);
    const end = Date.UTC(2100, 11, 31);
    const dayMs = 24 * 60 * 60 * 1000;
    for (let t = start; t <= end; t += dayMs) {
      const dt = new Date(t);
      const m = destinyMatrix({
        day: dt.getUTCDate(),
        month: dt.getUTCMonth() + 1,
        year: dt.getUTCFullYear(),
      });
      for (const v of Object.values(m)) {
        if (v < 1 || v > 22) {
          throw new Error(`Значение ${v} вне 1–22 для ${dt.toISOString().slice(0, 10)}`);
        }
      }
    }
  });

  it("не считает несуществующую дату", () => {
    expect(() => destinyMatrix({ day: 31, month: 6, year: 1990 })).toThrow();
  });
});
