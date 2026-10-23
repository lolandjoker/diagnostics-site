// Описания типов для тех частей библиотеки astronomia (MIT), которые мы используем.
// У самой библиотеки типов нет. Все углы — в радианах, время — юлианские дни.

declare module "astronomia/planetposition" {
  export class Planet {
    constructor(data: object);
    name: string;
    position(jde: number): { lon: number; lat: number; range: number };
  }
  const _default: { Planet: typeof Planet };
  export default _default;
}

declare module "astronomia/solar" {
  import type { Planet } from "astronomia/planetposition";
  export function apparentVSOP87(earth: Planet, jde: number): { lon: number; lat: number; range: number };
}

declare module "astronomia/moonposition" {
  export function position(jde: number): { lon: number; lat: number; range: number };
}

declare module "astronomia/elliptic" {
  import type { Planet } from "astronomia/planetposition";
  export function position(planet: Planet, earth: Planet, jde: number): { ra: number; dec: number };
}

declare module "astronomia/pluto" {
  import type { Planet } from "astronomia/planetposition";
  export function astrometric(jde: number, earth: Planet): { ra: number; dec: number };
}

declare module "astronomia/nutation" {
  /** [Δψ, Δε] — нутация в долготе и наклоне, радианы. */
  export function nutation(jde: number): [number, number];
  export function meanObliquity(jde: number): number;
}

declare module "astronomia/sidereal" {
  /** Истинное звёздное время в Гринвиче, секунды [0, 86400). */
  export function apparent(jd: number): number;
}

declare module "astronomia/deltat" {
  /** ΔT = TT − UT, секунды, для десятичного года. */
  export function deltaT(decimalYear: number): number;
}

declare module "astronomia/coord" {
  export class Equatorial {
    constructor(ra: number, dec: number);
    toEcliptic(obliquity: number): { lon: number; lat: number };
  }
}

declare module "astronomia/data/vsop87Bearth" { const d: object; export default d; }
declare module "astronomia/data/vsop87Bmercury" { const d: object; export default d; }
declare module "astronomia/data/vsop87Bvenus" { const d: object; export default d; }
declare module "astronomia/data/vsop87Bmars" { const d: object; export default d; }
declare module "astronomia/data/vsop87Bjupiter" { const d: object; export default d; }
declare module "astronomia/data/vsop87Bsaturn" { const d: object; export default d; }
declare module "astronomia/data/vsop87Buranus" { const d: object; export default d; }
declare module "astronomia/data/vsop87Bneptune" { const d: object; export default d; }
