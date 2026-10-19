/** Таблица соответствия букв числам. Ключи — заглавные буквы. */
export type LetterTable = Readonly<Record<string, number>>;

/**
 * Стандартная русская таблица по Пифагору: буквы алфавита по порядку
 * получают значения 1–9 по кругу. Меняется в админке (см. документ, раздел 3.2).
 */
export const PYTHAGOREAN_RU: LetterTable = {
  А: 1, Б: 2, В: 3, Г: 4, Д: 5, Е: 6, Ё: 7, Ж: 8, З: 9,
  И: 1, Й: 2, К: 3, Л: 4, М: 5, Н: 6, О: 7, П: 8, Р: 9,
  С: 1, Т: 2, У: 3, Ф: 4, Х: 5, Ц: 6, Ч: 7, Ш: 8, Щ: 9,
  Ъ: 1, Ы: 2, Ь: 3, Э: 4, Ю: 5, Я: 6,
};

/** Гласные русского алфавита — для числа души. */
export const VOWELS_RU: ReadonlySet<string> = new Set([
  "А", "Е", "Ё", "И", "О", "У", "Ы", "Э", "Ю", "Я",
]);

/**
 * Приводит имя к списку букв из таблицы: верхний регистр, всё лишнее
 * (пробелы, дефисы, цифры, латиница) отбрасывается.
 */
export function nameLetters(name: string, table: LetterTable = PYTHAGOREAN_RU): string[] {
  return Array.from(name.toUpperCase()).filter((ch) => ch in table);
}
