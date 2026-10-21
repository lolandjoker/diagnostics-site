import { norm360 } from "./angles";

export const SIGNS = [
  "aries", "taurus", "gemini", "cancer", "leo", "virgo",
  "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces",
] as const;

export type Sign = (typeof SIGNS)[number];

export const SIGN_NAMES_RU: Record<Sign, string> = {
  aries: "Овен",
  taurus: "Телец",
  gemini: "Близнецы",
  cancer: "Рак",
  leo: "Лев",
  virgo: "Дева",
  libra: "Весы",
  scorpio: "Скорпион",
  sagittarius: "Стрелец",
  capricorn: "Козерог",
  aquarius: "Водолей",
  pisces: "Рыбы",
};

export interface ZodiacPosition {
  sign: Sign;
  /** Градус внутри знака, 0 ≤ degree < 30. */
  degree: number;
}

export function zodiacPosition(lon: number): ZodiacPosition {
  const l = norm360(lon);
  const idx = Math.min(11, Math.floor(l / 30));
  return { sign: SIGNS[idx] as Sign, degree: l - idx * 30 };
}

/**
 * «15°24′ Овен» — для текстов и проверки глазами.
 * Минуты отбрасываются, а не округляются (как принято в астрологии): так знак в тексте
 * всегда совпадает со знаком в данных — 29°59,9′ Рыб остаётся «29°59′ Рыбы».
 */
export function formatPosition(lon: number): string {
  const { sign, degree } = zodiacPosition(lon);
  const totalMinutes = Math.min(30 * 60 - 1, Math.floor(degree * 60 + 1e-9));
  const d = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${d}°${String(m).padStart(2, "0")}′ ${SIGN_NAMES_RU[sign]}`;
}
