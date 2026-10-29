/**
 * Портрет по дате рождения для шапки разбора — всё действительно посчитано, а не выбрано наугад:
 * - Солнце и Луна — по положению на небе в день рождения (движок @diag/engine, эфемериды VSOP87).
 *   Время рождения неизвестно, поэтому смотрим начало и конец суток по Москве: если за этот день
 *   светило перешло в другой знак, показываем оба («Дева → Весы»), а не угадываем один.
 * - Стихия — стихия знака Солнца.
 * - Число жизненного пути — из цифр даты; число имени — из букв имени (только кириллица).
 */
import {
  SIGN_NAMES_RU,
  bodyLongitude,
  expressionNumber,
  julianEphemerisDay,
  lifePathNumber,
  localToUtcMs,
  zodiacPosition,
} from "@diag/engine";
import type { Body, Sign } from "@diag/engine";
import { parseIsoDate } from "./leads";

/** Знаки — как текст, а не эмодзи (U+FE0E): иначе на телефонах они цветные и в рамочках. */
const GLYPHS: Record<Sign, string> = {
  aries: "♈︎",
  taurus: "♉︎",
  gemini: "♊︎",
  cancer: "♋︎",
  leo: "♌︎",
  virgo: "♍︎",
  libra: "♎︎",
  scorpio: "♏︎",
  sagittarius: "♐︎",
  capricorn: "♑︎",
  aquarius: "♒︎",
  pisces: "♓︎",
};

export type Element = "fire" | "earth" | "air" | "water";

const ELEMENT_OF: Record<Sign, Element> = {
  aries: "fire",
  leo: "fire",
  sagittarius: "fire",
  taurus: "earth",
  virgo: "earth",
  capricorn: "earth",
  gemini: "air",
  libra: "air",
  aquarius: "air",
  cancer: "water",
  scorpio: "water",
  pisces: "water",
};

const ELEMENTS: Record<Element, { key: Element; name: string; hint: string }> = {
  fire: { key: "fire", name: "Огонь", hint: "энергия, смелость, порыв" },
  earth: { key: "earth", name: "Земля", hint: "надёжность, терпение, практичность" },
  air: { key: "air", name: "Воздух", hint: "идеи, общение, лёгкость" },
  water: { key: "water", name: "Вода", hint: "чувства, интуиция, глубина" },
};

const NUMBER_HINTS: Record<number, string> = {
  1: "лидерство и самостоятельность",
  2: "партнёрство и чуткость",
  3: "творчество и самовыражение",
  4: "опора, порядок, труд",
  5: "свобода и перемены",
  6: "забота, семья, ответственность",
  7: "поиск смысла, мудрость",
  8: "сила, достижения, достаток",
  9: "служение и завершение циклов",
  11: "интуиция и вдохновение",
  22: "большие замыслы и созидание",
  33: "любовь и наставничество",
};

export interface SignPlacement {
  /** Один знак или два, если светило сменило знак в день рождения. */
  signs: Sign[];
  label: string;
  glyphs: string;
}

export interface BirthPortrait {
  sun: SignPlacement;
  moon: SignPlacement;
  element: { key: Element; name: string; hint: string };
  lifePath: { value: number; hint: string };
  /** null — в имени нет русских букв (например, латиница): число имени не считаем. */
  nameNumber: { value: number; hint: string } | null;
}

/** Знак светила в начале и в конце дня рождения по Москве. */
function placement(body: Body, iso: string): SignPlacement {
  const { year, month, day } = parseIsoDate(iso);
  const at = (hour: number, minute: number) =>
    zodiacPosition(
      bodyLongitude(body, julianEphemerisDay(localToUtcMs({ year, month, day, hour, minute }, "Europe/Moscow"))),
    ).sign;
  const start = at(0, 0);
  const end = at(23, 59);
  const signs = start === end ? [start] : [start, end];
  return {
    signs,
    label: signs.map((s) => SIGN_NAMES_RU[s]).join(" → "),
    glyphs: signs.map((s) => GLYPHS[s]).join(" "),
  };
}

export function birthPortrait(name: string, birthIso: string): BirthPortrait {
  const date = parseIsoDate(birthIso);
  const sun = placement("sun", birthIso);
  // Стихия — знака Солнца; в день смены знака — того, в который Солнце перешло
  const element = ELEMENTS[ELEMENT_OF[sun.signs.at(-1) as Sign]];
  const life = lifePathNumber(date);
  let nameNumber: BirthPortrait["nameNumber"] = null;
  try {
    const n = expressionNumber(name);
    nameNumber = { value: n, hint: NUMBER_HINTS[n] ?? "" };
  } catch {
    // В имени нет русских букв
  }
  return {
    sun,
    moon: placement("moon", birthIso),
    element,
    lifePath: { value: life, hint: NUMBER_HINTS[life] ?? "" },
    nameNumber,
  };
}
