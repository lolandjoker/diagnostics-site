import { birthPortrait } from "./portrait";

describe("портрет по дате рождения", () => {
  it("знак, стихия и числа посчитаны из даты и имени", () => {
    const p = birthPortrait("Анна", "1993-03-10");
    expect(p.sun).toMatchObject({ signs: ["pisces"], label: "Рыбы" });
    expect(p.element.name).toBe("Вода");
    // 1+0+0+3+1+9+9+3 = 26 → 8
    expect(p.lifePath.value).toBe(8);
    // А1 Н6 Н6 А1 = 14 → 5
    expect(p.nameNumber?.value).toBe(5);
    expect(p.moon.signs.length).toBeGreaterThanOrEqual(1);
  });

  it("в день смены знака — оба знака, а не угадывание", () => {
    // Весеннее равноденствие 1990: ровно в один из этих дней Солнце переходит из Рыб в Овен
    const days = ["1990-03-19", "1990-03-20", "1990-03-21", "1990-03-22"].map((d) => birthPortrait("Анна", d).sun.signs);
    expect(days.filter((s) => s.length === 2)).toEqual([["pisces", "aries"]]);
    expect(days[0]).toEqual(["pisces"]);
    expect(days[3]).toEqual(["aries"]);
  });

  it("имя без русских букв — без числа имени", () => {
    expect(birthPortrait("Name", "1993-03-10").nameNumber).toBeNull();
  });
});
