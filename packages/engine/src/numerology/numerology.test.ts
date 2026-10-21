import {
  birthdayNumber,
  expressionNumber,
  lifePathNumber,
  numerologyProfile,
  personalityNumber,
  personalYearNumber,
  reduceToDigit,
  soulNumber,
} from "./index";

describe("reduceToDigit", () => {
  it("сворачивает до одной цифры", () => {
    expect(reduceToDigit(28)).toBe(1); // 28 → 10 → 1
    expect(reduceToDigit(99)).toBe(9); // 99 → 18 → 9
    expect(reduceToDigit(44)).toBe(8);
    expect(reduceToDigit(9)).toBe(9);
    expect(reduceToDigit(0)).toBe(0);
  });

  it("сохраняет управляющие числа 11, 22, 33", () => {
    expect(reduceToDigit(29)).toBe(11); // 29 → 11, стоп
    expect(reduceToDigit(38)).toBe(11); // 38 → 11, стоп
    expect(reduceToDigit(22)).toBe(22);
    expect(reduceToDigit(33)).toBe(33);
  });

  it("сворачивает управляющие числа, если попросили", () => {
    expect(reduceToDigit(29, { keepMaster: false })).toBe(2);
    expect(reduceToDigit(22, { keepMaster: false })).toBe(4);
  });
});

describe("lifePathNumber — число жизненного пути", () => {
  it.each([
    // дата, сумма цифр, ожидание
    [{ day: 15, month: 3, year: 1990 }, 1], // 28 → 1
    [{ day: 19, month: 9, year: 1990 }, 11], // 38 → 11
    [{ day: 1, month: 2, year: 1990 }, 22], // 22
    [{ day: 28, month: 12, year: 1982 }, 33], // 33
    [{ day: 29, month: 11, year: 1985 }, 9], // 36 → 9
  ])("%o → %i", (date, expected) => {
    expect(lifePathNumber(date)).toBe(expected);
  });

  it("без управляющих чисел: 19.09.1990 → 38 → 11 → 2", () => {
    expect(lifePathNumber({ day: 19, month: 9, year: 1990 }, { keepMaster: false })).toBe(2);
  });

  it("не считает несуществующую дату", () => {
    expect(() => lifePathNumber({ day: 30, month: 2, year: 1990 })).toThrow();
  });
});

describe("birthdayNumber — число дня рождения", () => {
  it.each([
    [7, 7],
    [22, 22],
    [29, 11],
    [30, 3],
  ])("день %i → %i", (day, expected) => {
    expect(birthdayNumber({ day, month: 1, year: 1990 })).toBe(expected);
  });
});

describe("числа по имени (таблица Пифагора)", () => {
  // Анна: А1 Н6 Н6 А1 = 14 → 5; гласные А+А = 2; согласные Н+Н = 12 → 3
  it("Анна", () => {
    expect(expressionNumber("Анна")).toBe(5);
    expect(soulNumber("Анна")).toBe(2);
    expect(personalityNumber("Анна")).toBe(3);
  });

  // Мария: М5 А1 Р9 И1 Я6 = 22; гласные А+И+Я = 8; согласные М+Р = 14 → 5
  it("Мария — управляющее 22 в числе судьбы", () => {
    expect(expressionNumber("Мария")).toBe(22);
    expect(soulNumber("Мария")).toBe(8);
    expect(personalityNumber("Мария")).toBe(5);
  });

  // Ольга: О7 Л4 Ь3 Г4 А1 = 19 → 1; гласные О+А = 8; согласные Л+Ь+Г = 11
  it("Ольга — мягкий знак считается согласной", () => {
    expect(expressionNumber("Ольга")).toBe(1);
    expect(soulNumber("Ольга")).toBe(8);
    expect(personalityNumber("Ольга")).toBe(11);
  });

  // Алёна: А1 Л4 Ё7 Н6 А1 = 19 → 1
  it("буква Ё имеет своё значение", () => {
    expect(expressionNumber("Алёна")).toBe(1);
  });

  it("регистр, пробелы и дефисы не влияют", () => {
    expect(expressionNumber("анна")).toBe(5);
    expect(expressionNumber("  Анна  ")).toBe(5);
    // Анна-Мария: 14 + 22 = 36 → 9
    expect(expressionNumber("Анна-Мария")).toBe(9);
  });

  it("имя без русских букв — понятная ошибка", () => {
    expect(() => expressionNumber("Anna")).toThrow("нет ни одной буквы");
    expect(() => soulNumber("")).toThrow("нет ни одной буквы");
  });

  it("буквы в «разложенном» виде (NFD, бывает при вставке с Mac) считаются верно", () => {
    // Й = И + кратка, Ё = Е + две точки
    expect(expressionNumber("Андрей".normalize("NFD"))).toBe(expressionNumber("Андрей"));
    expect(expressionNumber("Алёна".normalize("NFD"))).toBe(1);
  });

  it("имя без согласных или без гласных — число не определено (null), а не 0", () => {
    // Ия: И1 Я6 — только гласные
    expect(soulNumber("Ия")).toBe(7);
    expect(personalityNumber("Ия")).toBeNull();
    // Мрк — только согласные
    expect(soulNumber("Мрк")).toBeNull();
  });

  it("таблицу можно заменить", () => {
    const table = { А: 1, Н: 1 };
    expect(expressionNumber("Анна", { table })).toBe(4);
  });
});

describe("personalYearNumber — число личного года", () => {
  it("15.03 в 2026 году: 6 + 3 + 10 = 19 → 1", () => {
    expect(personalYearNumber({ day: 15, month: 3, year: 1990 }, 2026)).toBe(1);
  });

  it("не сохраняет управляющие числа: 19.09 в 2026 → 29 → 11 → 2", () => {
    expect(personalYearNumber({ day: 19, month: 9, year: 1990 }, 2026)).toBe(2);
  });

  it("отклоняет год вне диапазона", () => {
    expect(() => personalYearNumber({ day: 1, month: 1, year: 1990 }, 1800)).toThrow();
  });
});

describe("numerologyProfile", () => {
  it("собирает все числа за один вызов", () => {
    expect(numerologyProfile({ day: 15, month: 3, year: 1990 }, "Анна", 2026)).toEqual({
      lifePath: 1,
      birthday: 6,
      expression: 5,
      soul: 2,
      personality: 3,
      personalYear: 1,
    });
  });
});
