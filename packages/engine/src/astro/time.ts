import { deltaT } from "astronomia/deltat";

/** Местное время рождения, как его ввёл человек. */
export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      throw new Error(`Неизвестный часовой пояс: ${timeZone}`);
    }
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * Смещение часового пояса от UTC в миллисекундах в момент utcMs.
 * Учитывает историю поясов (летнее время, декретное время, смены поясов) —
 * данные IANA, встроенные в Node.js.
 */
export function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Переводит местное время в момент UTC (миллисекунды).
 * Несуществующее время (перевод часов вперёд) сдвигается вперёд на величину перевода;
 * неоднозначное (перевод назад) — берётся более позднее, по зимнему времени.
 */
export function localToUtcMs(t: LocalDateTime, timeZone: string): number {
  const asIfUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute);
  const DAY = 86_400_000;
  // Смещение до и после возможного перевода часов в окрестности этой даты
  const before = zoneOffsetMs(asIfUtc - DAY, timeZone);
  const after = zoneOffsetMs(asIfUtc + DAY, timeZone);
  const candidates = [asIfUtc - before, asIfUtc - after];
  const valid = candidates.filter((u) => zoneOffsetMs(u, timeZone) === asIfUtc - u);
  if (valid.length > 0) return Math.max(...valid); // при двух вариантах — более поздний (зимнее время)
  return asIfUtc - before; // время попало в «дыру» перевода вперёд → сдвиг вперёд
}

/** Юлианский день (шкала UT) по моменту UTC. */
export function julianDayUT(utcMs: number): number {
  return utcMs / 86_400_000 + 2_440_587.5;
}

/** Юлианский эфемеридный день (шкала TT): UT + ΔT. */
export function julianEphemerisDay(utcMs: number): number {
  const jd = julianDayUT(utcMs);
  const decimalYear = 2000 + (jd - 2_451_545.0) / 365.25;
  return jd + deltaT(decimalYear) / 86_400;
}
