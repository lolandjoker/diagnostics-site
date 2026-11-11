/**
 * Период «Сводки»: готовые (сегодня, вчера, 7 и 30 дней, всё время) и свой — с даты по дату включительно
 * (?from=2026-11-02&to=2026-11-08; один день — from = to). Дни — по Москве.
 * Период — [since, until): since включительно, until — не включая (полночь после последнего дня); null — без границы.
 */
import { type SQL, and, gte, lt } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

const DAY = 86_400_000;
const MSK = 3 * 3_600_000;

export interface Period {
  since: Date | null;
  until: Date | null;
}

/** Условие «в периоде» для столбца времени; без границ — undefined (без условия). */
export function within(column: AnyPgColumn, since: Date | null, until: Date | null = null): SQL | undefined {
  return and(since ? gte(column, since) : undefined, until ? lt(column, until) : undefined);
}

/** Полночь по Москве дня YYYY-MM-DD; не дата — null. */
export function mskDayStart(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = Date.UTC(y, mo - 1, d);
  const back = new Date(utc);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return new Date(utc - MSK);
}

/** День по Москве: YYYY-MM-DD. */
export const mskDay = (at: Date) => new Date(at.getTime() + MSK).toISOString().slice(0, 10);

/** Полночь по Москве сегодняшнего дня. */
export const mskToday = (now: Date) => new Date(Math.floor((now.getTime() + MSK) / DAY) * DAY - MSK);

/** Свой период по датам (включительно); перепутаны местами — меняем; не даты — null. */
export function customPeriod(from: string | undefined, to: string | undefined): (Period & { from: string; to: string }) | null {
  const a = from ? mskDayStart(from) : null;
  const b = to ? mskDayStart(to) : null;
  if (!a && !b) return null;
  let start = a ?? b!;
  let end = b ?? a!;
  if (end < start) [start, end] = [end, start];
  return { since: start, until: new Date(end.getTime() + DAY), from: mskDay(start), to: mskDay(end) };
}
