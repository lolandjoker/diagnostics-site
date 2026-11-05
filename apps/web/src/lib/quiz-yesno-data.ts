/** «Да или нет» — подписи ответов и длина вопроса (без зависимостей: их показывает и страница в браузере). */
export type YesNo = "yes" | "no" | "maybe";

export const ANSWER_LABEL: Record<YesNo, string> = { yes: "Да", no: "Нет", maybe: "Пока не ясно" };

export const QUESTION_MIN = 5;
export const QUESTION_MAX = 200;
