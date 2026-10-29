/**
 * Тексты сайта, которые правит админ. Здесь — список ключей и тексты по умолчанию;
 * в базе хранятся только изменённые админом значения.
 * Подстановки в фигурных скобках: {name}, {product}, {order} — см. fillTemplate.
 */
import { inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { texts } from "@/db/schema";

export interface TextDef {
  key: string;
  group: string;
  label: string;
  default: string;
  /** Ссылка: значение проверяется, принимается только https:// */
  url?: boolean;
  /** Подсказка админу: какие подстановки работают в этом тексте. */
  hint?: string;
}

export const TEXT_DEFS = [
  // Главная
  { key: "home.title", group: "Главная", label: "Заголовок", default: "Ваш разбор по дате рождения" },
  {
    key: "home.subtitle",
    group: "Главная",
    label: "Подзаголовок",
    default: "Введите имя и дату рождения — мы подготовим ваш разбор.",
  },
  { key: "home.button", group: "Главная", label: "Кнопка формы", default: "Получить разбор" },
  // Разбор
  { key: "result.title", group: "Разбор", label: "Заголовок", default: "{name}, ваш разбор", hint: "{name}" },
  { key: "result.intro", group: "Разбор", label: "Текст под заголовком", default: "", hint: "{name}" },
  { key: "result.expert_title", group: "Разбор", label: "Заголовок блока «написать эксперту»", default: "Хотите подробнее?" },
  {
    key: "result.expert_text",
    group: "Разбор",
    label: "Текст блока «написать эксперту»",
    default: "Напишите эксперту — он ответит на ваши вопросы в чате.",
    hint: "{name}",
  },
  { key: "result.expert_button", group: "Разбор", label: "Кнопка «написать эксперту»", default: "Написать эксперту" },
  // Выбор эксперта и чат
  { key: "experts.title", group: "Эксперты и чат", label: "Заголовок выбора эксперта", default: "Выберите эксперта" },
  {
    key: "experts.none_online",
    group: "Эксперты и чат",
    label: "Если никого нет в сети",
    default: "Сейчас никого нет в сети. Загляните чуть позже.",
  },
  { key: "experts.choose", group: "Эксперты и чат", label: "Кнопка выбора эксперта", default: "Написать" },
  {
    key: "experts.busy",
    group: "Эксперты и чат",
    label: "Статус «занят» (видит клиент; писать эксперту можно; лучше без рода — подходит и экспертам, и эксперткам)",
    default: "на консультации — ответит через 10 минут",
  },
  {
    key: "chat.suggestions",
    group: "Эксперты и чат",
    label: "Подсказки-вопросы в чате: клиент нажимает — вопрос отправляется (по одному в строке; пусто — без подсказок)",
    default:
      "Здравствуйте, расскажите подробней про мою диагностику.\nЧто меня ждёт в отношениях?\nКак сложится с работой и деньгами?",
  },
  { key: "chat.title", group: "Эксперты и чат", label: "Заголовок чата", default: "Чат с экспертом {expert}", hint: "{expert}" },
  { key: "chat.placeholder", group: "Эксперты и чат", label: "Подсказка в поле сообщения", default: "Сообщение" },
  { key: "chat.send", group: "Эксперты и чат", label: "Кнопка отправки", default: "Отправить" },
  { key: "chat.client_name", group: "Эксперты и чат", label: "Подпись сообщений клиента (видит клиент)", default: "Вы" },
  { key: "chat.admin_name", group: "Эксперты и чат", label: "Подпись сообщений админа (видят эксперты и админ; клиент видит имя эксперта чата)", default: "Администратор" },
  {
    key: "chat.system_name",
    group: "Эксперты и чат",
    label: "Подпись подробного разбора в чате",
    default: "Подробный разбор",
  },
  // Документы и подвал
  { key: "legal.offer", group: "Документы", label: "Публичная оферта", default: "Текст оферты пока не заполнен." },
  {
    key: "legal.privacy",
    group: "Документы",
    label: "Политика обработки персональных данных",
    default: "Текст политики пока не заполнен.",
  },
  { key: "footer.text", group: "Документы", label: "Текст в подвале", default: "" },
] as const satisfies readonly TextDef[];

export type TextKey = (typeof TEXT_DEFS)[number]["key"];

const DEFS_BY_KEY = new Map<string, TextDef>(TEXT_DEFS.map((d) => [d.key, d]));

export function isTextKey(key: string): key is TextKey {
  return DEFS_BY_KEY.has(key);
}

export function textDef(key: TextKey): TextDef {
  return DEFS_BY_KEY.get(key) as TextDef;
}

/** Тексты по ключам: значение из базы или текст по умолчанию. */
export async function getTexts<K extends TextKey>(db: Db, keys: readonly K[]): Promise<Record<K, string>> {
  const rows = keys.length
    ? await db.select().from(texts).where(inArray(texts.key, keys as unknown as string[]))
    : [];
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<K, string>;
  for (const k of keys) out[k] = stored.get(k) ?? textDef(k).default;
  return out;
}

export async function getAllTexts(db: Db): Promise<Record<TextKey, string>> {
  return getTexts(db, TEXT_DEFS.map((d) => d.key));
}

/** Ссылка безопасна для href: только https://. */
export function isSafeUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Сохраняет тексты. Возвращает ошибку по первому неверному значению или null. */
export async function saveTexts(db: Db, values: Partial<Record<TextKey, string>>): Promise<string | null> {
  const entries = Object.entries(values) as [TextKey, string][];
  for (const [key, value] of entries) {
    const def = textDef(key);
    if (def.url && value !== "" && !isSafeUrl(value)) {
      return `«${def.label}»: ссылка должна начинаться с https://`;
    }
    if (value.length > 50_000) return `«${def.label}»: текст слишком длинный`;
  }
  for (const [key, value] of entries) {
    await db
      .insert(texts)
      .values({ key, value })
      .onConflictDoUpdate({ target: texts.key, set: { value, updatedAt: sql`now()` } });
  }
  return null;
}

/** Подставляет значения вместо {name}, {product}, {order}. Неизвестные подстановки остаются как есть. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? (vars[k] as string) : m));
}
