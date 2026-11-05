/** Нумерология и дата по Москве — без зависимостей, для сайта и бота. */
const digits = (n: number) => String(n).split("").reduce((s, d) => s + Number(d), 0);
const reduce = (n: number) => {
  let x = n;
  while (x > 9) x = digits(x);
  return x;
};

/** Личный день: личный год (день + месяц рождения + год) → личный месяц (+ месяц) → день (+ число). */
export function personalDay(birthDate: string, today: string): number {
  const [, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const year = reduce(reduce(bd) + reduce(bm) + reduce(y));
  const month = reduce(year + m);
  return reduce(month + d);
}

const moscow = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });

/** Дата (ГГГГ-ММ-ДД) и час по Москве. */
export function moscowNow(now: Date): { date: string; hour: number } {
  const parts = Object.fromEntries(moscow.formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

