import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { maskBirthDate } from "./date-input";
import { ageOn, birthDateToIso, validateLead } from "./leads";
import { fillTemplate, getTexts, saveTexts } from "./texts";

const NOW = new Date("2026-10-23T10:00:00Z");

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

describe("тексты", () => {
  it("без правок — тексты по умолчанию, после сохранения — новые", async () => {
    expect((await getTexts(db, ["home.title"]))["home.title"]).toBe("Ваш разбор по дате рождения");
    expect(await saveTexts(db, { "home.title": "Новый заголовок" })).toBeNull();
    expect((await getTexts(db, ["home.title"]))["home.title"]).toBe("Новый заголовок");
    expect(await saveTexts(db, { "home.title": "Ещё раз" })).toBeNull();
    expect((await getTexts(db, ["home.title"]))["home.title"]).toBe("Ещё раз");
  });

  it("подстановки", () => {
    expect(fillTemplate("{name}, ваш разбор: {x}", { name: "Анна" })).toBe("Анна, ваш разбор: {x}");
  });
});

describe("заявка", () => {
  const ok = { name: "Анна", birthDate: "1990-03-15" };

  it("принимает верные данные", () => {
    expect(validateLead(ok, NOW)).toBeNull();
  });

  it("поле даты: точки подставляются сами, лишнее отбрасывается", () => {
    expect(maskBirthDate("1")).toBe("1");
    expect(maskBirthDate("150")).toBe("15.0");
    expect(maskBirthDate("15031990")).toBe("15.03.1990");
    expect(maskBirthDate("15.03.1990")).toBe("15.03.1990");
    expect(maskBirthDate("150319901234")).toBe("15.03.1990");
    expect(maskBirthDate("1.5.1990")).toBe("01.05.1990");
    expect(maskBirthDate("15.")).toBe("15");
    expect(maskBirthDate("ab12")).toBe("12");
  });

  it("дата из формы ДД.ММ.ГГГГ → ГГГГ-ММ-ДД", () => {
    expect(birthDateToIso("15.03.1990")).toBe("1990-03-15");
    expect(birthDateToIso(" 1.5.1990 ")).toBe("1990-05-01");
    expect(birthDateToIso("15/03/1990")).toBe("1990-03-15");
    expect(birthDateToIso("1990-03-15")).toBe("1990-03-15");
    expect(birthDateToIso("15.03.90")).toBeNull();
    expect(birthDateToIso("15031990")).toBeNull();
    expect(birthDateToIso("")).toBeNull();
    // Несуществующую дату разбор пропускает — её отклоняет проверка заявки
    expect(validateLead({ ...ok, birthDate: birthDateToIso("31.02.1990")! }, NOW)).toMatch("не существует");
  });

  it("отклоняет пустое имя и неверную дату", () => {
    expect(validateLead({ ...ok, name: "  " }, NOW)).toMatch("имя");
    expect(validateLead({ ...ok, birthDate: "1990-02-30" }, NOW)).toMatch("не существует");
    expect(validateLead({ ...ok, birthDate: "" }, NOW)).toMatch("дату");
  });

  it("только с 18 лет: день в день — можно, днём раньше — нельзя", () => {
    expect(ageOn("2008-10-23", NOW)).toBe(18);
    expect(ageOn("2008-10-24", NOW)).toBe(17);
    expect(validateLead({ ...ok, birthDate: "2008-10-23" }, NOW)).toBeNull();
    expect(validateLead({ ...ok, birthDate: "2008-10-24" }, NOW)).toMatch("18");
  });
});
