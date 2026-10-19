import { digitSum } from "../date";

/** Управляющие (мастер-) числа: по умолчанию не сворачиваются до одной цифры. */
export const MASTER_NUMBERS: readonly number[] = [11, 22, 33];

export interface ReduceOptions {
  /** Оставлять 11, 22, 33 как есть. По умолчанию — да. */
  keepMaster?: boolean;
}

/**
 * Сворачивает число до одной цифры суммированием цифр: 28 → 10 → 1.
 * С keepMaster (по умолчанию) останавливается на 11, 22, 33: 29 → 11.
 */
export function reduceToDigit(n: number, opts: ReduceOptions = {}): number {
  const keepMaster = opts.keepMaster ?? true;
  let x = n;
  while (x > 9) {
    if (keepMaster && MASTER_NUMBERS.includes(x)) return x;
    x = digitSum(x);
  }
  return x;
}
