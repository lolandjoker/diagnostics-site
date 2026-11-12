/**
 * Рассылки — данные без зависимостей (их показывает и форма в браузере): куда (CHANNELS), кому (AUDIENCES),
 * личная кнопка (PERSONAL_PAGES), готовые рассылки под каждый квиз (BROADCAST_TEMPLATES), лимиты серии и файлов.
 * Отбор получателей и отправка — lib/broadcasts.ts.
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

/** Куда уходит системная рассылка: в Telegram-бот, на почту (указали почту и не отписались) или туда и туда. */
export const CHANNELS = {
  telegram: "Telegram",
  email: "Почта",
  both: "Telegram и почта",
} as const;

export type Channels = keyof typeof CHANNELS;

export const isChannels = (v: unknown): v is Channels => typeof v === "string" && Object.hasOwn(CHANNELS, v);

/** Есть ли в выборе этот канал. */
export const hasTelegram = (c: Channels) => c !== "email";
export const hasEmail = (c: Channels) => c !== "telegram";

/** Получателей по каналам: в Telegram — людей с ботом, на почту — адресов. */
export interface ChannelCount {
  telegram: number;
  email: number;
}

/** Тема письма — до стольких символов. */
export const MAX_SUBJECT = 150;

/** Кому рассылать (заблокированных нет никогда): в Telegram — подключившим бота, на почту — указавшим почту. */
export const AUDIENCES = {
  all: "Всем",
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
  /** Тема письма, если рассылка уходит и на почту. */
  subject: string;
}

/** Готовые рассылки: шаблон заполняет форму целиком — останется проверить пробой и отправить. */
export const BROADCAST_TEMPLATES: Record<string, BroadcastTemplate> = {
  archetype: {
    subject: "Подарок для вас: тест «Ваш архетип» ✨",
    title: "Ваш архетип",
    audience: "no_archetype",
    gift: true,
    button: "arhetip",
    label: "Забрать подарок",
    body: "**У нас для вас подарок** ✨\n\nМы подготовили бесплатный тест **«Ваш архетип»** — 5 вопросов о вас, и вы узнаете, какая карта Таро описывает ваш характер: ваша сила, как вы любите и что мешает двигаться вперёд.\n\nВ конце — красивая картинка с вашим результатом, её можно выложить в сторис 🌙",
  },
  compat: {
    subject: "Насколько вы совпадаете с любимым человеком? 💞",
    title: "Совместимость",
    audience: "no_compat",
    gift: true,
    button: "sovmestimost",
    label: "Узнать совместимость",
    body: "**Насколько вы совпадаете с любимым человеком?** 💞\n\nВведите его дату рождения — и узнайте вашу совместимость по знакам зодиака и числам судьбы: общий процент, чувства, быт и страсть.\n\nЭто бесплатно и займёт минуту. А если захочется разобрать вашу пару подробнее — эксперт на связи 🤍",
  },
  yesno: {
    subject: "Есть вопрос? Спросите у карт 🃏",
    title: "Да или нет",
    audience: "no_yesno",
    gift: false,
    button: "da-net",
    label: "Задать вопрос картам",
    body: "**Есть вопрос, который не даёт покоя?** 🃏\n\nСформулируйте его так, чтобы можно было ответить «да» или «нет», — и вытяните одну карту. Она ответит и подскажет, что делать дальше.\n\nБесплатно, один вопрос в день 🤍",
  },
  card: {
    subject: "Ваша карта дня уже ждёт ✨",
    title: "Карта дня",
    audience: "no_card",
    gift: false,
    button: "den",
    label: "Вытянуть карту дня",
    body: "**Ваша карта дня уже ждёт** ✨\n\nКаждый день — новая карта с расшифровкой лично для вас: что главное сегодня, в любви, в делах и деньгах, и совет дня.\n\nВыберите одну из пяти — доверьтесь первому порыву 🌙",
  },
  chat: {
    subject: "Эксперт ответил вам и ждёт продолжения",
    title: "Эксперт ждёт",
    audience: "silent",
    gift: false,
    button: "chat",
    label: "Открыть чат",
    body: "**Эксперт ответил вам — и ждёт продолжения** 🔮\n\nВ вашем чате есть ответ эксперта. Если вопрос ещё актуален — напишите пару слов прямо в чат, и мы продолжим с того места, где остановились 🤍",
  },
};

export const MAX_BROADCAST_MESSAGES = 5;
/** Подпись к фото и видео — до 1024 символов у Telegram; с запасом на значок и «/stop». Длиннее — текст отдельным сообщением. */
export const MAX_CAPTION = 980;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** Всех файлов рассылки вместе: Bot API принимает загрузку до 50 МБ. */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
export const MAX_FILTER_HOURS = 24 * 365;
/** Пауза между сообщениями серии одному человеку: Telegram не любит очередь сообщений в один чат. */
export const SERIES_GAP_MS = 400;

const MEDIA_TYPES: Record<string, "photo" | "video"> = {
  "image/jpeg": "photo",
  "image/png": "photo",
  "image/webp": "photo",
  "video/mp4": "video",
  "video/quicktime": "video",
};

/** Фото или видео по типу файла; другое — null. */
export const mediaKind = (type: string): "photo" | "video" | null => MEDIA_TYPES[type] ?? null;

/** Какие файлы можно приложить (поле выбора файла). */
export const MEDIA_ACCEPT = Object.keys(MEDIA_TYPES).join(",");
