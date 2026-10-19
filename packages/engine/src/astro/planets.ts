import { Equatorial } from "astronomia/coord";
import vsop87Bearth from "astronomia/data/vsop87Bearth";
import vsop87Bjupiter from "astronomia/data/vsop87Bjupiter";
import vsop87Bmars from "astronomia/data/vsop87Bmars";
import vsop87Bmercury from "astronomia/data/vsop87Bmercury";
import vsop87Bneptune from "astronomia/data/vsop87Bneptune";
import vsop87Bsaturn from "astronomia/data/vsop87Bsaturn";
import vsop87Buranus from "astronomia/data/vsop87Buranus";
import vsop87Bvenus from "astronomia/data/vsop87Bvenus";
import { position as ellipticPosition } from "astronomia/elliptic";
import { position as moonPosition } from "astronomia/moonposition";
import { meanObliquity, nutation } from "astronomia/nutation";
import { Planet } from "astronomia/planetposition";
import { astrometric as plutoAstrometric } from "astronomia/pluto";
import { apparentVSOP87 } from "astronomia/solar";
import { DEG, norm360, signedDiff } from "./angles";

export const BODIES = [
  "sun", "moon", "mercury", "venus", "mars",
  "jupiter", "saturn", "uranus", "neptune", "pluto",
] as const;

export type Body = (typeof BODIES)[number];

export interface BodyPosition {
  /** Эклиптическая долгота, градусы [0, 360): тропический зодиак, равноденствие даты. */
  lon: number;
  /** Скорость по долготе, градусов в сутки. Отрицательная — ретроградное движение. */
  speed: number;
  retrograde: boolean;
}

const earth = new Planet(vsop87Bearth);
const planets: Record<"mercury" | "venus" | "mars" | "jupiter" | "saturn" | "uranus" | "neptune", Planet> = {
  mercury: new Planet(vsop87Bmercury),
  venus: new Planet(vsop87Bvenus),
  mars: new Planet(vsop87Bmars),
  jupiter: new Planet(vsop87Bjupiter),
  saturn: new Planet(vsop87Bsaturn),
  uranus: new Planet(vsop87Buranus),
  neptune: new Planet(vsop87Bneptune),
};

/** Наклон эклиптики J2000 и общая прецессия по долготе — для перевода Плутона в координаты даты. */
const OBLIQUITY_J2000 = 23.4392911 * DEG;

function trueObliquity(jde: number): number {
  return meanObliquity(jde) + nutation(jde)[1];
}

/** Видимая геоцентрическая долгота тела, градусы. */
export function bodyLongitude(body: Body, jde: number): number {
  switch (body) {
    case "sun":
      return norm360(apparentVSOP87(earth, jde).lon / DEG);
    case "moon":
      return norm360((moonPosition(jde).lon + nutation(jde)[0]) / DEG);
    case "pluto": {
      // Астрометрические координаты J2000 → эклиптика J2000 → прецессия к дате + нутация
      const { ra, dec } = plutoAstrometric(jde, earth);
      const ecl2000 = new Equatorial(ra, dec).toEcliptic(OBLIQUITY_J2000);
      const t = (jde - 2_451_545.0) / 36_525;
      const precession = (5029.0966 * t + 1.11113 * t * t) / 3600;
      return norm360(ecl2000.lon / DEG + precession + nutation(jde)[0] / DEG);
    }
    default: {
      const { ra, dec } = ellipticPosition(planets[body], earth, jde);
      return norm360(new Equatorial(ra, dec).toEcliptic(trueObliquity(jde)).lon / DEG);
    }
  }
}

/** Положение тела со скоростью: долгота считается за полсуток до и после. */
export function bodyPosition(body: Body, jde: number): BodyPosition {
  const lon = bodyLongitude(body, jde);
  const speed = signedDiff(bodyLongitude(body, jde - 0.5), bodyLongitude(body, jde + 0.5));
  const canRetro = body !== "sun" && body !== "moon";
  return { lon, speed, retrograde: canRetro && speed < 0 };
}

export function allPositions(jde: number): Record<Body, BodyPosition> {
  const out = {} as Record<Body, BodyPosition>;
  for (const b of BODIES) out[b] = bodyPosition(b, jde);
  return out;
}

export { trueObliquity };
