import { assertValidBirthDate, dateDigitSum, digitSum } from "./date";

describe("digitSum", () => {
  it("складывает цифры числа", () => {
    expect(digitSum(1990)).toBe(19);
    expect(digitSum(0)).toBe(0);
    expect(digitSum(7)).toBe(7);
    expect(digitSum(2026)).toBe(10);
  });

  it("не принимает отрицательные и дробные числа", () => {
    expect(() => digitSum(-5)).toThrow();
    expect(() => digitSum(1.5)).toThrow();
  });
});

describe("dateDigitSum", () => {
  it("складывает все цифры даты", () => {
    // 15.03.1990 → 1+5 + 0+3 + 1+9+9+0 = 28
    expect(dateDigitSum({ day: 15, month: 3, year: 1990 })).toBe(28);
  });
});

describe("assertValidBirthDate", () => {
  it("пропускает существующие даты", () => {
    expect(() => assertValidBirthDate({ day: 29, month: 2, year: 2024 })).not.toThrow();
    expect(() => assertValidBirthDate({ day: 31, month: 12, year: 1900 })).not.toThrow();
  });

  it("отклоняет несуществующие даты", () => {
    expect(() => assertValidBirthDate({ day: 29, month: 2, year: 2023 })).toThrow("Такой даты не существует");
    expect(() => assertValidBirthDate({ day: 31, month: 4, year: 1990 })).toThrow("Такой даты не существует");
    expect(() => assertValidBirthDate({ day: 0, month: 1, year: 1990 })).toThrow("Такой даты не существует");
  });

  it("отклоняет месяц и год вне диапазона", () => {
    expect(() => assertValidBirthDate({ day: 1, month: 13, year: 1990 })).toThrow("Месяц");
    expect(() => assertValidBirthDate({ day: 1, month: 1, year: 1899 })).toThrow("Год");
    expect(() => assertValidBirthDate({ day: 1, month: 1, year: 2101 })).toThrow("Год");
  });

  it("отклоняет дробные значения", () => {
    expect(() => assertValidBirthDate({ day: 1.5, month: 1, year: 1990 })).toThrow("целых");
  });
});
