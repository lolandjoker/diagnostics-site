import { assertValidBirthDate } from "../date";
import { findAspects } from "./aspects";
import type { Aspect, AspectOptions } from "./aspects";
import { computeHouses, houseOf, localSiderealDeg } from "./houses";
import type { HouseSystem, Houses } from "./houses";
import { BODIES, allPositions, bodyLongitude, trueObliquity } from "./planets";
import type { Body, BodyPosition } from "./planets";
import { zodiacPosition } from "./signs";
import type { ZodiacPosition } from "./signs";
import { julianDayUT, julianEphemerisDay, localToUtcMs } from "./time";

export interface ChartInput {
  year: number;
  month: number;
  day: number;
  /** Время рождения; если не указано — карта строится на полдень, без домов и асцендента. */
  time?: { hour: number; minute: number };
  /** Часовой пояс IANA, например «Europe/Moscow» (берётся из базы городов). */
  timeZone: string;
  /** Широта, градусы; север — положительная. */
  latitude: number;
  /** Долгота, градусы; восток — положительная. */
  longitude: number;
  houseSystem?: HouseSystem;
  aspects?: AspectOptions;
}

export interface ChartBody extends BodyPosition, ZodiacPosition {
  /** Дом 1–12; null, если время рождения неизвестно. */
  house: number | null;
}

export interface NatalChart {
  utc: string;
  timeKnown: boolean;
  bodies: Record<Body, ChartBody>;
  /** null, если время рождения неизвестно. */
  houses: Houses | null;
  aspects: Aspect[];
  /**
   * Время неизвестно и Луна за этот день сменила знак — знак Луны может отличаться.
   * В разборе это показывается пометкой.
   */
  moonSignUncertain: boolean;
}

function assertCoordinates(lat: number, lon: number): void {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("Широта должна быть от −90 до 90");
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error("Долгота должна быть от −180 до 180");
}

function assertTime(t: { hour: number; minute: number }): void {
  if (!Number.isInteger(t.hour) || t.hour < 0 || t.hour > 23) throw new Error("Час должен быть от 0 до 23");
  if (!Number.isInteger(t.minute) || t.minute < 0 || t.minute > 59) throw new Error("Минуты должны быть от 0 до 59");
}

/** Натальная карта: положения планет, знаки, дома (если известно время) и аспекты. */
export function natalChart(input: ChartInput): NatalChart {
  const { year, month, day, timeZone, latitude, longitude } = input;
  assertValidBirthDate({ day, month, year });
  assertCoordinates(latitude, longitude);
  if (input.time) assertTime(input.time);

  const timeKnown = input.time !== undefined;
  const local = { year, month, day, hour: input.time?.hour ?? 12, minute: input.time?.minute ?? 0 };
  const utcMs = localToUtcMs(local, timeZone);
  const jde = julianEphemerisDay(utcMs);
  const positions = allPositions(jde);

  let houses: Houses | null = null;
  if (timeKnown) {
    const ramc = localSiderealDeg(julianDayUT(utcMs), longitude);
    houses = computeHouses(ramc, latitude, trueObliquity(jde) / (Math.PI / 180), input.houseSystem);
  }

  const bodies = {} as Record<Body, ChartBody>;
  const lons = {} as Record<Body, number>;
  for (const b of BODIES) {
    const p = positions[b];
    lons[b] = p.lon;
    bodies[b] = { ...p, ...zodiacPosition(p.lon), house: houses ? houseOf(p.lon, houses.cusps) : null };
  }

  let moonSignUncertain = false;
  if (!timeKnown) {
    const startJde = julianEphemerisDay(localToUtcMs({ ...local, hour: 0, minute: 0 }, timeZone));
    const endJde = julianEphemerisDay(localToUtcMs({ ...local, hour: 23, minute: 59 }, timeZone));
    moonSignUncertain =
      zodiacPosition(bodyLongitude("moon", startJde)).sign !==
      zodiacPosition(bodyLongitude("moon", endJde)).sign;
  }

  return {
    utc: new Date(utcMs).toISOString(),
    timeKnown,
    bodies,
    houses,
    aspects: findAspects(lons, input.aspects),
    moonSignUncertain,
  };
}
