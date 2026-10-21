import { apparent as apparentSiderealSeconds } from "astronomia/sidereal";
import { DEG, atan2D, cosD, norm360, sinD, tanD } from "./angles";

export type HouseSystem = "placidus" | "equal";

/** Выше этой широты (по модулю) Плацидус не определён — переходим на равнодомную систему. */
export const PLACIDUS_MAX_LATITUDE = 66;

export interface Angles {
  /** Прямое восхождение середины неба (местное звёздное время), градусы. */
  ramc: number;
  /** Асцендент, градусы эклиптики. */
  asc: number;
  /** Середина неба (MC), градусы эклиптики. */
  mc: number;
}

export interface Houses extends Angles {
  system: HouseSystem;
  /** Куспиды домов 1–12, градусы. cusps[0] — 1-й дом (= асцендент), cusps[9] — 10-й (= MC). */
  cusps: number[];
}

/** Местное истинное звёздное время, градусы. Восточная долгота — положительная. */
export function localSiderealDeg(jdUT: number, longitudeEast: number): number {
  return norm360(apparentSiderealSeconds(jdUT) / 240 + longitudeEast);
}

/** Асцендент и MC по звёздному времени, широте и наклону эклиптики (все в градусах). */
export function anglesFromRamc(ramc: number, latitude: number, obliquity: number): Angles {
  const mc = atan2D(sinD(ramc), cosD(ramc) * cosD(obliquity));
  let asc = atan2D(
    cosD(ramc),
    -(sinD(ramc) * cosD(obliquity) + tanD(latitude) * sinD(obliquity)),
  );
  // За полярным кругом формула иногда даёт заходящую точку (десцендент).
  // Асцендент — восходящая точка, она всегда лежит в пределах 180° после MC.
  if (norm360(asc - mc) > 180) asc = norm360(asc + 180);
  return { ramc, asc, mc };
}

/** Долгота точки эклиптики с заданным прямым восхождением. */
function eclipticLonFromRa(ra: number, obliquity: number): number {
  return atan2D(sinD(ra), cosD(ra) * cosD(obliquity));
}

/**
 * Куспид Плацидуса: точка эклиптики, прошедшая долю `fraction` своей полудуги.
 * above=true — дневная полудуга от MC (дома 11, 12), false — ночная от IC (дома 2, 3).
 */
function placidusCusp(
  ramc: number,
  latitude: number,
  obliquity: number,
  fraction: number,
  above: boolean,
): number {
  let lon = eclipticLonFromRa(ramc + (above ? 0 : 90) + 90 * fraction, obliquity);
  for (let i = 0; i < 100; i++) {
    const dec = Math.asin(sinD(obliquity) * sinD(lon)) / DEG;
    const x = Math.max(-1, Math.min(1, -tanD(latitude) * tanD(dec)));
    const diurnal = Math.acos(x) / DEG;
    const ra = above
      ? ramc + fraction * diurnal
      : ramc + 180 - (1 - fraction) * (180 - diurnal);
    const next = eclipticLonFromRa(ra, obliquity);
    if (Math.abs(norm360(next - lon + 180) - 180) < 1e-9) return next;
    lon = next;
  }
  return lon;
}

/**
 * Дома гороскопа. По умолчанию — Плацидус; на широтах выше 66° — равнодомная
 * система от асцендента (Плацидус там не определён).
 */
export function computeHouses(
  ramc: number,
  latitude: number,
  obliquity: number,
  system: HouseSystem = "placidus",
): Houses {
  if (latitude < -90 || latitude > 90) throw new Error("Широта должна быть от −90 до 90");
  const angles = anglesFromRamc(ramc, latitude, obliquity);
  const useSystem: HouseSystem =
    system === "placidus" && Math.abs(latitude) > PLACIDUS_MAX_LATITUDE ? "equal" : system;

  const cusps = new Array<number>(12);
  if (useSystem === "equal") {
    for (let k = 0; k < 12; k++) cusps[k] = norm360(angles.asc + 30 * k);
  } else {
    cusps[0] = angles.asc;
    cusps[9] = angles.mc;
    cusps[10] = placidusCusp(ramc, latitude, obliquity, 1 / 3, true); // 11
    cusps[11] = placidusCusp(ramc, latitude, obliquity, 2 / 3, true); // 12
    cusps[1] = placidusCusp(ramc, latitude, obliquity, 1 / 3, false); // 2
    cusps[2] = placidusCusp(ramc, latitude, obliquity, 2 / 3, false); // 3
    for (let k = 3; k <= 8; k++) cusps[k] = norm360((cusps[k - 6 < 0 ? k + 6 : k - 6] ?? 0) + 180);
  }
  return { ...angles, system: useSystem, cusps };
}

/** Номер дома (1–12), в котором находится точка с долготой lon. */
export function houseOf(lon: number, cusps: readonly number[]): number {
  for (let k = 0; k < 12; k++) {
    const start = cusps[k] ?? 0;
    const end = cusps[(k + 1) % 12] ?? 0;
    const span = norm360(end - start);
    if (norm360(lon - start) < span) return k + 1;
  }
  return 12;
}
