import { assertValidBirthDate, dateDigitSum, digitSum } from "../date";
import type { BirthDate } from "../date";
import { nameLetters, PYTHAGOREAN_RU, VOWELS_RU } from "./letters";
import type { LetterTable } from "./letters";
import { reduceToDigit } from "./reduce";
import type { ReduceOptions } from "./reduce";

export { reduceToDigit, MASTER_NUMBERS } from "./reduce";
export type { ReduceOptions } from "./reduce";
export { PYTHAGOREAN_RU, VOWELS_RU, nameLetters } from "./letters";
export type { LetterTable } from "./letters";

export interface NameOptions extends ReduceOptions {
  table?: LetterTable;
  vowels?: ReadonlySet<string>;
}

/** Число жизненного пути: сумма всех цифр даты, свёрнутая. 15.03.1990 → 28 → 1. */
export function lifePathNumber(d: BirthDate, opts: ReduceOptions = {}): number {
  assertValidBirthDate(d);
  return reduceToDigit(dateDigitSum(d), opts);
}

/** Число дня рождения: день, свёрнутый. 29 → 11, 30 → 3. */
export function birthdayNumber(d: BirthDate, opts: ReduceOptions = {}): number {
  assertValidBirthDate(d);
  return reduceToDigit(d.day, opts);
}

/** Сумма значений отобранных букв; null — если ни одна буква не подошла. */
function sumLetters(
  name: string,
  opts: NameOptions,
  keep: (letter: string) => boolean,
): number | null {
  const table = opts.table ?? PYTHAGOREAN_RU;
  let sum = 0;
  let count = 0;
  for (const letter of nameLetters(name, table)) {
    if (keep(letter)) {
      sum += table[letter] ?? 0;
      count++;
    }
  }
  return count > 0 ? sum : null;
}

function assertHasLetters(name: string, table: LetterTable): void {
  if (nameLetters(name, table).length === 0) {
    throw new Error("В имени нет ни одной буквы из таблицы");
  }
}

/** Число судьбы (выражения): сумма всех букв имени. «Анна» → 14 → 5. */
export function expressionNumber(name: string, opts: NameOptions = {}): number {
  assertHasLetters(name, opts.table ?? PYTHAGOREAN_RU);
  return reduceToDigit(sumLetters(name, opts, () => true) ?? 0, opts);
}

/**
 * Число души: сумма гласных имени. «Анна» → 2.
 * null — в имени нет гласных: число не определено, трактовка не показывается.
 */
export function soulNumber(name: string, opts: NameOptions = {}): number | null {
  assertHasLetters(name, opts.table ?? PYTHAGOREAN_RU);
  const vowels = opts.vowels ?? VOWELS_RU;
  const sum = sumLetters(name, opts, (l) => vowels.has(l));
  return sum === null ? null : reduceToDigit(sum, opts);
}

/**
 * Число личности: сумма согласных имени (Ь, Ъ, Й считаются согласными). «Анна» → 12 → 3.
 * null — в имени нет согласных (например, «Ия»).
 */
export function personalityNumber(name: string, opts: NameOptions = {}): number | null {
  assertHasLetters(name, opts.table ?? PYTHAGOREAN_RU);
  const vowels = opts.vowels ?? VOWELS_RU;
  const sum = sumLetters(name, opts, (l) => !vowels.has(l));
  return sum === null ? null : reduceToDigit(sum, opts);
}

/**
 * Число личного года: день + месяц + цифры указанного года, свёрнуто до 1–9
 * (управляющие числа здесь не сохраняются). 15.03 в 2026 → 19 → 1.
 */
export function personalYearNumber(d: BirthDate, year: number): number {
  assertValidBirthDate(d);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new Error("Год для личного года должен быть между 1900 и 2200");
  }
  return reduceToDigit(digitSum(d.day) + digitSum(d.month) + digitSum(year), {
    keepMaster: false,
  });
}

/** Число архетипа 1–12: сумма всех цифр даты по модулю 12, остаток 0 — это 12. 15.03.1990 → 28 → 4. */
export function archetypeNumber(d: BirthDate): number {
  assertValidBirthDate(d);
  const k = dateDigitSum(d) % 12;
  return k === 0 ? 12 : k;
}

export interface NumerologyProfile {
  lifePath: number;
  birthday: number;
  expression: number;
  soul: number | null;
  personality: number | null;
  personalYear: number;
}

/** Полный нумерологический профиль за один вызов. */
export function numerologyProfile(
  d: BirthDate,
  name: string,
  currentYear: number,
  opts: NameOptions = {},
): NumerologyProfile {
  return {
    lifePath: lifePathNumber(d, opts),
    birthday: birthdayNumber(d, opts),
    expression: expressionNumber(name, opts),
    soul: soulNumber(name, opts),
    personality: personalityNumber(name, opts),
    personalYear: personalYearNumber(d, currentYear),
  };
}
