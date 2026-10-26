/** Ввод даты рождения в форме на главной (без календаря). */

/**
 * Дата вручную в виде ДД.ММ.ГГГГ: точки подставляются сами, вводить можно одни цифры.
 * «1.5.1990» тоже понимаем — однозначные день и месяц перед точкой дополняются нулём.
 */
export function maskBirthDate(raw: string): string {
  const padded = raw.replace(/^(\d)\D/, "0$1.").replace(/^(\d\d)\D+(\d)\D/, "$1.0$2.");
  const d = padded.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`;
}
