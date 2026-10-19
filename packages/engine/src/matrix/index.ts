import { assertValidBirthDate, digitSum } from "../date";
import type { BirthDate } from "../date";

/** Старших арканов 22; энергии матрицы — числа от 1 до 22. */
export const ARCANA_COUNT = 22;

/** Сворачивает число до 1–22 суммированием цифр: 37 → 10, 47 → 11, 22 → 22. */
export function reduce22(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error("Энергия матрицы считается только для целых неотрицательных чисел");
  }
  let x = n;
  while (x > ARCANA_COUNT) x = digitSum(x);
  return x;
}

/**
 * Матрица судьбы по дате рождения (метод Н. Ладини, 22 аркана).
 * Точки схемы: A — слева (день), B — сверху (месяц), C — справа (год),
 * D — снизу, E — центр. F, G, H, I — диагональ (родовые энергии).
 * Состав и названия дополнительных точек калибруются по примеру владельца.
 */
export interface DestinyMatrix {
  /** День рождения, свёрнутый до 22 — личные качества, «кто я». */
  a: number;
  /** Месяц — талант, «что я умею». */
  b: number;
  /** Сумма цифр года — зона роста. */
  c: number;
  /** A + B + C — кармическая задача. */
  d: number;
  /** A + B + C + D — центр, зона комфорта. */
  e: number;
  /** A + B — диагональ, верх-лево. */
  f: number;
  /** B + C — диагональ, верх-право. */
  g: number;
  /** C + D — диагональ, низ-право. */
  h: number;
  /** D + A — диагональ, низ-лево. */
  i: number;
  /** B + D — «небо», духовная линия. */
  sky: number;
  /** A + C — «земля», материальная линия. */
  earth: number;
  /** небо + земля — личное предназначение. */
  personalPurpose: number;
  /** (F + H) + (G + I) — социальное предназначение. */
  socialPurpose: number;
  /** личное + социальное — духовное предназначение. */
  spiritualPurpose: number;
}

export function destinyMatrix(d: BirthDate): DestinyMatrix {
  assertValidBirthDate(d);

  const a = reduce22(d.day);
  const b = d.month;
  const c = reduce22(digitSum(d.year));
  const dd = reduce22(a + b + c);
  const e = reduce22(a + b + c + dd);

  const f = reduce22(a + b);
  const g = reduce22(b + c);
  const h = reduce22(c + dd);
  const i = reduce22(dd + a);

  const sky = reduce22(b + dd);
  const earth = reduce22(a + c);
  const personalPurpose = reduce22(sky + earth);

  const maleLine = reduce22(f + h);
  const femaleLine = reduce22(g + i);
  const socialPurpose = reduce22(maleLine + femaleLine);

  const spiritualPurpose = reduce22(personalPurpose + socialPurpose);

  return {
    a, b, c, d: dd, e,
    f, g, h, i,
    sky, earth,
    personalPurpose, socialPurpose, spiritualPurpose,
  };
}
