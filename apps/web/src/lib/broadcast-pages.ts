/** Личная кнопка рассылки: куда ведёт и надпись по умолчанию (без зависимостей — их показывает и форма в браузере). */
export const PERSONAL_PAGES = {
  den: { label: "«Мой день»", button: "Открыть «Мой день»" },
  arhetip: { label: "Тест «Ваш архетип»", button: "Пройти тест «Ваш архетип»" },
  sovmestimost: { label: "Совместимость пары", button: "Узнать совместимость" },
  "da-net": { label: "«Да или нет»", button: "Задать вопрос картам" },
  chat: { label: "Чат с экспертом", button: "Открыть чат с экспертом" },
} as const;

export type PersonalPage = keyof typeof PERSONAL_PAGES;

export const isPersonalPage = (v: unknown): v is PersonalPage => typeof v === "string" && Object.hasOwn(PERSONAL_PAGES, v);
