/**
 * Рассылки — данные без зависимостей (их показывает и форма в браузере): кому (AUDIENCES), личная кнопка
 * (PERSONAL_PAGES) и готовые рассылки под каждый квиз (BROADCAST_TEMPLATES). Отбор получателей — lib/broadcasts.ts.
 */
export const PERSONAL_PAGES = {
  den: { label: "«Мой день»", button: "Открыть «Мой день»" },
  arhetip: { label: "Тест «Ваш архетип»", button: "Пройти тест «Ваш архетип»" },
  sovmestimost: { label: "Совместимость пары", button: "Узнать совместимость" },
  "da-net": { label: "«Да или нет»", button: "Задать вопрос картам" },
  chat: { label: "Чат с экспертом", button: "Открыть чат с экспертом" },
} as const;

export type PersonalPage = keyof typeof PERSONAL_PAGES;

export const isPersonalPage = (v: unknown): v is PersonalPage => typeof v === "string" && Object.hasOwn(PERSONAL_PAGES, v);

/** Кому рассылать (все — подключившие Telegram; заблокированных нет никогда). */
export const AUDIENCES = {
  all: "Всем, кто подключил Telegram",
  silent: "Не ответили нам в чате — последнее сообщение наше, клиент молчит",
  never: "Ни разу не написали в чат",
  no_archetype: "Не проходили тест «Ваш архетип»",
  no_compat: "Не проходили совместимость",
  no_yesno: "Не задавали вопрос «Да или нет»",
  no_card: "Ни разу не тянули карту дня",
  no_quiz: "Не прошли ни одного квиза",
} as const;

export type Audience = keyof typeof AUDIENCES;

export const isAudience = (v: unknown): v is Audience => typeof v === "string" && Object.hasOwn(AUDIENCES, v);

export interface BroadcastTemplate {
  title: string;
  audience: Audience;
  body: string;
  gift: boolean;
  button: PersonalPage;
  label: string;
}

/** Готовые рассылки: шаблон заполняет форму целиком — останется проверить пробой и отправить. */
export const BROADCAST_TEMPLATES: Record<string, BroadcastTemplate> = {
  archetype: {
    title: "Ваш архетип",
    audience: "no_archetype",
    gift: true,
    button: "arhetip",
    label: "Забрать подарок",
    body: "**У нас для вас подарок** ✨\n\nМы подготовили бесплатный тест **«Ваш архетип»** — 5 вопросов о вас, и вы узнаете, какая карта Таро описывает ваш характер: ваша сила, как вы любите и что мешает двигаться вперёд.\n\nВ конце — красивая картинка с вашим результатом, её можно выложить в сторис 🌙",
  },
  compat: {
    title: "Совместимость",
    audience: "no_compat",
    gift: true,
    button: "sovmestimost",
    label: "Узнать совместимость",
    body: "**Насколько вы совпадаете с любимым человеком?** 💞\n\nВведите его дату рождения — и узнайте вашу совместимость по знакам зодиака и числам судьбы: общий процент, чувства, быт и страсть.\n\nЭто бесплатно и займёт минуту. А если захочется разобрать вашу пару подробнее — эксперт на связи 🤍",
  },
  yesno: {
    title: "Да или нет",
    audience: "no_yesno",
    gift: false,
    button: "da-net",
    label: "Задать вопрос картам",
    body: "**Есть вопрос, который не даёт покоя?** 🃏\n\nСформулируйте его так, чтобы можно было ответить «да» или «нет», — и вытяните одну карту. Она ответит и подскажет, что делать дальше.\n\nБесплатно, один вопрос в день 🤍",
  },
  card: {
    title: "Карта дня",
    audience: "no_card",
    gift: false,
    button: "den",
    label: "Вытянуть карту дня",
    body: "**Ваша карта дня уже ждёт** ✨\n\nКаждый день — новая карта с расшифровкой лично для вас: что главное сегодня, в любви, в делах и деньгах, и совет дня.\n\nВыберите одну из пяти — доверьтесь первому порыву 🌙",
  },
  chat: {
    title: "Эксперт ждёт",
    audience: "silent",
    gift: false,
    button: "chat",
    label: "Открыть чат",
    body: "**Эксперт ответил вам — и ждёт продолжения** 🔮\n\nВ вашем чате есть ответ эксперта. Если вопрос ещё актуален — напишите пару слов прямо в чат, и мы продолжим с того места, где остановились 🤍",
  },
};
