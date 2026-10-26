/** Постраничный показ списков (отзывы на карточке эксперта). */

/** Номера страниц для кнопок: первая, последняя и соседние с текущей; пропуски — null («…»). */
export function pageNumbers(current: number, total: number): (number | null)[] {
  const want = new Set([1, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...want].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (const p of sorted) {
    const prev = out.at(-1);
    if (typeof prev === "number" && p - prev > 1) out.push(null);
    out.push(p);
  }
  return out;
}
