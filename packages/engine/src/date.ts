/** Дата рождения. Год — четырёхзначный. */
export interface BirthDate {
  day: number;
  month: number;
  year: number;
}

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

/**
 * Проверяет, что дата существует в календаре и попадает в допустимый диапазон.
 * Бросает ошибку с понятным текстом — она показывается в форме.
 */
export function assertValidBirthDate(d: BirthDate): void {
  const { day, month, year } = d;
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    throw new Error("Дата рождения должна состоять из целых чисел");
  }
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new Error(`Год рождения должен быть между ${MIN_YEAR} и ${MAX_YEAR}`);
  }
  if (month < 1 || month > 12) {
    throw new Error("Месяц рождения должен быть от 1 до 12");
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  const exists =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  if (day < 1 || !exists) {
    throw new Error("Такой даты не существует");
  }
}

/** Сумма цифр числа: 1990 → 19. Отрицательные и дробные не принимаются. */
export function digitSum(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error("Сумма цифр считается только для целых неотрицательных чисел");
  }
  let sum = 0;
  let x = n;
  while (x > 0) {
    sum += x % 10;
    x = Math.floor(x / 10);
  }
  return sum;
}

/** Сумма всех цифр даты: 15.03.1990 → 1+5+0+3+1+9+9+0 = 28. */
export function dateDigitSum(d: BirthDate): number {
  return digitSum(d.day) + digitSum(d.month) + digitSum(d.year);
}
