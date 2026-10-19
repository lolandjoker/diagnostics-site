import { separation } from "./angles";
import type { Body } from "./planets";

export const ASPECTS = {
  conjunction: 0,
  sextile: 60,
  square: 90,
  trine: 120,
  opposition: 180,
} as const;

export type AspectType = keyof typeof ASPECTS;

/** Орбисы по умолчанию, градусы. Для Солнца и Луны добавляется LUMINARY_BONUS. */
export const DEFAULT_ORBS: Record<AspectType, number> = {
  conjunction: 8,
  opposition: 8,
  trine: 7,
  square: 7,
  sextile: 5,
};

export const LUMINARY_BONUS = 2;

export interface Aspect {
  a: Body;
  b: Body;
  type: AspectType;
  /** Отклонение от точного аспекта, градусы. */
  orb: number;
}

export interface AspectOptions {
  orbs?: Partial<Record<AspectType, number>>;
  luminaryBonus?: number;
}

/** Мажорные аспекты между всеми парами тел. Каждой паре — не больше одного аспекта, самого точного. */
export function findAspects(
  longitudes: Partial<Record<Body, number>>,
  opts: AspectOptions = {},
): Aspect[] {
  const orbs = { ...DEFAULT_ORBS, ...opts.orbs };
  const bonus = opts.luminaryBonus ?? LUMINARY_BONUS;
  const bodies = Object.keys(longitudes) as Body[];
  const result: Aspect[] = [];

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i] as Body;
      const b = bodies[j] as Body;
      const sep = separation(longitudes[a] ?? 0, longitudes[b] ?? 0);
      const lum = a === "sun" || a === "moon" || b === "sun" || b === "moon" ? bonus : 0;
      let best: Aspect | null = null;
      for (const [type, angle] of Object.entries(ASPECTS) as [AspectType, number][]) {
        const orb = Math.abs(sep - angle);
        if (orb <= orbs[type] + lum && (!best || orb < best.orb)) best = { a, b, type, orb };
      }
      if (best) result.push(best);
    }
  }
  return result.sort((x, y) => x.orb - y.orb);
}
