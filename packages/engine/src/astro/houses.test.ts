import { DEG, atan2D, cosD, norm360, separation, sinD, tanD } from "./angles";
import { anglesFromRamc, computeHouses, houseOf, localSiderealDeg } from "./houses";
import { trueObliquity } from "./planets";
import { julianDayUT, julianEphemerisDay } from "./time";

const EPS = 23.4393; // наклон эклиптики около 2000 года

describe("звёздное время", () => {
  it("2000-01-01 12:00 UT в Гринвиче ≈ 280,46° (18ч41м50с)", () => {
    expect(separation(localSiderealDeg(2_451_545.0, 0), 280.46)).toBeLessThan(0.01);
  });

  it("восточная долгота прибавляется", () => {
    expect(separation(localSiderealDeg(2_451_545.0, 37.6), norm360(280.46 + 37.6))).toBeLessThan(0.01);
  });
});

describe("асцендент и MC", () => {
  it("на экваторе при RAMC = 0: MC = 0° Овна, ASC = 0° Рака", () => {
    const a = anglesFromRamc(0, 0, EPS);
    expect(separation(a.mc, 0)).toBeLessThan(1e-9);
    expect(separation(a.asc, 90)).toBeLessThan(1e-9);
  });

  it("на экваторе при RAMC = 90: MC = 0° Рака, ASC = 0° Весов", () => {
    const a = anglesFromRamc(90, 0, EPS);
    expect(separation(a.mc, 90)).toBeLessThan(1e-9);
    expect(separation(a.asc, 180)).toBeLessThan(1e-9);
  });

  it("таблицы домов Рафаэля, Лондон 51°32′, звёздное время 0ч: ASC ≈ 26°36′ Рака", () => {
    const a = anglesFromRamc(0, 51 + 32 / 60, 23 + 27 / 60);
    expect(separation(a.asc, 116.6)).toBeLessThan(0.1);
  });

  it("асцендент — восходящая точка: на горизонте и на востоке, в том числе за полярным кругом", () => {
    for (let ramc = 0; ramc < 360; ramc += 7.5) {
      for (const lat of [-85, -75, -60, 0, 55.75, 66, 68.97, 70, 80, 89]) {
        const { asc } = anglesFromRamc(ramc, lat, EPS);
        const ra = atan2D(sinD(asc) * cosD(EPS), cosD(asc));
        const dec = Math.asin(sinD(EPS) * sinD(asc)) / DEG;
        const hourAngle = norm360(ramc - ra);
        const altitude = Math.asin(sinD(lat) * sinD(dec) + cosD(lat) * cosD(dec) * cosD(hourAngle)) / DEG;
        expect(Math.abs(altitude)).toBeLessThan(1e-6); // на горизонте
        expect(hourAngle).toBeGreaterThan(180); // восточная половина неба — точка восходит
      }
    }
  });

  it.each([
    // Справочные значения Swiss Ephemeris 2.10 (Мошье), посчитаны отдельно
    ["Москва 15.03.1990 11:30 UT", 55.7558, 37.6173, Date.UTC(1990, 2, 15, 11, 30), 135.6414, 24.7526],
    ["Мурманск 15.03.1990 04:00 UT", 68.97, 33.08, Date.UTC(1990, 2, 15, 4), 32.685, 265.9466],
    ["Норильск 01.06.2000 12:00 UT", 69.35, 88.2, Date.UTC(2000, 5, 1, 12), 213.7533, 156.7377],
    ["80° с. ш. 01.06.2000 06:00 UT", 80, 0, Date.UTC(2000, 5, 1, 6), 154.1794, 338.392],
    ["75° ю. ш. 01.06.2000 18:00 UT", -75, 0, Date.UTC(2000, 5, 1, 18), 321.3412, 158.9179],
  ])("%s: ASC и MC совпадают со Swiss Ephemeris (до 0,001°)", (_n, lat, lon, ms, asc, mc) => {
    const ramc = localSiderealDeg(julianDayUT(ms), lon);
    const a = anglesFromRamc(ramc, lat, trueObliquity(julianEphemerisDay(ms)) / DEG);
    expect(separation(a.asc, asc)).toBeLessThan(0.001);
    expect(separation(a.mc, mc)).toBeLessThan(0.001);
  });

  it("асцендент всегда в восточной половине: от MC до MC+180°", () => {
    for (let ramc = 0; ramc < 360; ramc += 15) {
      for (const lat of [-80, -60, -30, 0, 30, 55.75, 66, 70, 80]) {
        const a = anglesFromRamc(ramc, lat, EPS);
        const d = norm360(a.asc - a.mc);
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThan(180);
      }
    }
  });
});

/**
 * Независимая проверка Плацидуса: ищем куспид не итерацией, а делением отрезка пополам
 * по определению — точка эклиптики, часовой угол которой равен заданной доле её полудуги.
 */
function placidusByBisection(ramc: number, lat: number, eps: number, house: 11 | 12 | 2 | 3): number {
  const { asc, mc } = anglesFromRamc(ramc, lat, eps);
  const [from, to] = house === 11 || house === 12 ? [mc, asc] : [asc, norm360(mc + 180)];
  const span = norm360(to - from);
  const f = (x: number): number => {
    const lon = norm360(from + x);
    const ra = atan2D(sinD(lon) * cosD(eps), cosD(lon));
    const dec = Math.asin(sinD(eps) * sinD(lon)) / DEG;
    const sda = Math.acos(Math.max(-1, Math.min(1, -tanD(lat) * tanD(dec)))) / DEG;
    const hourAngleEast = norm360(ra - ramc); // 0 на MC, растёт к востоку
    const target =
      house === 11 ? sda / 3 :
      house === 12 ? (2 * sda) / 3 :
      house === 2 ? sda + (180 - sda) / 3 :
      sda + (2 * (180 - sda)) / 3;
    return hourAngleEast - target;
  };
  let lo = 1e-6;
  let hi = span - 1e-6;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return norm360(from + (lo + hi) / 2);
}

describe("дома Плацидуса", () => {
  it("совпадают с независимым расчётом делением пополам (до 0,001°)", () => {
    for (let ramc = 5; ramc < 360; ramc += 20) {
      for (const lat of [-45, -10, 0.5, 30, 45, 55.75, 64]) {
        const h = computeHouses(ramc, lat, EPS);
        expect(h.system).toBe("placidus");
        const pairs: [number, 11 | 12 | 2 | 3][] = [[10, 11], [11, 12], [1, 2], [2, 3]];
        for (const [idx, house] of pairs) {
          expect(separation(h.cusps[idx] ?? NaN, placidusByBisection(ramc, lat, EPS, house))).toBeLessThan(0.001);
        }
      }
    }
  });

  it("таблицы Рафаэля, Лондон, звёздное время 0ч: 11 — 9° Тельца, 12 — 22° Близнецов, 2 — 12° Льва, 3 — 3° Девы (±1°)", () => {
    const h = computeHouses(0, 51 + 32 / 60, 23 + 27 / 60);
    expect(separation(h.cusps[10] ?? NaN, 39)).toBeLessThan(1);
    expect(separation(h.cusps[11] ?? NaN, 82)).toBeLessThan(1);
    expect(separation(h.cusps[1] ?? NaN, 132)).toBeLessThan(1);
    expect(separation(h.cusps[2] ?? NaN, 153)).toBeLessThan(1);
  });

  it("1-й = ASC, 10-й = MC, противоположные куспиды отличаются на 180°, порядок — по кругу", () => {
    const h = computeHouses(123.4, 55.75, EPS);
    expect(h.cusps[0]).toBe(h.asc);
    expect(h.cusps[9]).toBe(h.mc);
    for (let k = 0; k < 6; k++) {
      expect(Math.abs(separation(h.cusps[k] ?? NaN, h.cusps[k + 6] ?? NaN) - 180)).toBeLessThan(1e-9);
    }
    let total = 0;
    for (let k = 0; k < 12; k++) {
      const span = norm360((h.cusps[(k + 1) % 12] ?? 0) - (h.cusps[k] ?? 0));
      expect(span).toBeGreaterThan(0);
      total += span;
    }
    expect(total).toBeCloseTo(360, 6);
  });

  it("за полярным кругом — равнодомная система от асцендента", () => {
    const h = computeHouses(200, 69, EPS); // Мурманск
    expect(h.system).toBe("equal");
    for (let k = 0; k < 12; k++) {
      expect(separation(h.cusps[k] ?? NaN, norm360(h.asc + 30 * k))).toBeLessThan(1e-9);
    }
  });

  it("широта вне −90…90 — ошибка", () => {
    expect(() => computeHouses(0, 91, EPS)).toThrow("Широта");
  });
});

describe("houseOf", () => {
  const cusps = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  it.each([[0, 1], [29.99, 1], [30, 2], [359, 12], [185, 7]])("%f° → дом %i", (lon, house) => {
    expect(houseOf(lon, cusps)).toBe(house);
  });

  it("дом через 0° Овна", () => {
    const shifted = cusps.map((c) => norm360(c + 345)); // 1-й дом начинается с 345°
    expect(houseOf(350, shifted)).toBe(1);
    expect(houseOf(5, shifted)).toBe(1);
    expect(houseOf(16, shifted)).toBe(2);
  });
});
