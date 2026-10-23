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
    default: "Введите имя и дату рождения — разбор будет готов сразу.",
  },
  { key: "home.button", group: "Главная", label: "Кнопка формы", default: "Получить разбор" },
  {
    key: "home.consent",
    group: "Главная",
    label: "Согласие под формой",
    default: "Я согласен(на) на обработку персональных данных",
  },
  // Разбор
  { key: "result.title", group: "Разбор", label: "Заголовок", default: "{name}, ваш разбор", hint: "{name}" },
  { key: "result.intro", group: "Разбор", label: "Текст перед блоками", default: "", hint: "{name}" },
  { key: "result.offers_title", group: "Разбор", label: "Заголовок раздела с продуктами", default: "Что дальше" },
  { key: "result.buy_button", group: "Разбор", label: "Кнопка покупки", default: "Купить" },
  // Заказ и оплата
  { key: "order.title", group: "Заказ", label: "Заголовок страницы заказа", default: "Оформление заказа" },
  {
    key: "order.email_hint",
    group: "Заказ",
    label: "Пояснение к полю почты",
    default: "На эту почту придёт ваш заказ после оплаты.",
  },
  { key: "order.button", group: "Заказ", label: "Кнопка перехода к оплате", default: "Перейти к оплате" },
  {
    key: "order.pending",
    group: "Заказ",
    label: "Как оплатить (пока оплата подтверждается вручную)",
    default: "Заказ № {order} создан. Инструкция по оплате появится здесь.",
    hint: "{order}, {product}",
  },
  { key: "order.paid_title", group: "Заказ", label: "Заголовок после оплаты", default: "Оплата получена" },
  {
    key: "order.paid",
    group: "Заказ",
    label: "Текст после оплаты",
    default: "Спасибо! Мы отправили «{product}» на вашу почту.",
    hint: "{product}, {order}",
  },
  // Мессенджеры (показываются после оплаты; пустая ссылка — кнопки нет)
  { key: "links.title", group: "Мессенджеры", label: "Заголовок блока", default: "Мы на связи" },
  { key: "links.telegram", group: "Мессенджеры", label: "Ссылка Telegram", default: "", url: true },
  { key: "links.whatsapp", group: "Мессенджеры", label: "Ссылка WhatsApp", default: "", url: true },
  { key: "links.max", group: "Мессенджеры", label: "Ссылка MAX", default: "", url: true },
  // Письмо после оплаты (к нему добавляется «Что получает человек» из продукта)
  { key: "email.subject", group: "Письмо", label: "Тема", default: "Ваш заказ: {product}", hint: "{product}, {order}" },
  { key: "email.intro", group: "Письмо", label: "Начало письма", default: "Здравствуйте! Спасибо за заказ.", hint: "{product}, {order}" },
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
