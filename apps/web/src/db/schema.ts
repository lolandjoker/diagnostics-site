/**
 * Таблицы базы данных. Правило проекта: изменения только добавляют —
 * столбцы и таблицы не удаляются и не переименовываются.
 * После правки схемы: pnpm --filter @diag/web db:generate (создаёт миграцию в drizzle/).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Двоичные данные (фото). pg отдаёт Buffer, PGlite — Uint8Array; приводим к Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => Buffer.from(v),
});

/** Настройки сайта «ключ → значение» (например, как выбирать вариант диагностики). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Вариант диагностики: способ расчёта + для каждого значения короткий и полный текст.
 * Человеку при заявке достаётся один вариант; по вариантам считается конверсия.
 */
export const variations = pgTable("variations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  method: text("method").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  /** Удалён из админки: новым людям не выдаётся и в списках не виден; у тех, кому уже достался, тексты остаются. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const variationTexts = pgTable(
  "variation_texts",
  {
    variationId: integer("variation_id")
      .notNull()
      .references(() => variations.id, { onDelete: "cascade" }),
    value: integer("value").notNull(),
    shortText: text("short_text").notNull().default(""),
    fullText: text("full_text").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.variationId, t.value] })],
);

/**
 * Эксперт: профиль на сайте + вход в панель. Статус: «в сети» (online — держится, пока не выключат;
 * или onlineUntil — админ включил на срок), «занят» (busy — в сети, но ответит позже), «не в сети».
 */
export const experts = pgTable("experts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** Подробное описание для профиля эксперта; короткое (description) — на карточке и в мини-профиле. */
  about: text("about").notNull().default(""),
  /** Специализации — теги в профиле («Таро, Астрология»), через запятую. */
  tags: text("tags").notNull().default(""),
  login: text("login").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  online: boolean("online").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  /** Админ включил «в сети» до этого времени — независимо от того, открыта ли панель эксперта. */
  onlineUntil: timestamp("online_until", { withTimezone: true }),
  /** «Занят — обратитесь через 10 минут»: в сети, писать можно, но ответит позже. */
  busy: boolean("busy").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  /** Удалён: не входит, не виден в списках и клиентам; его переписка и подпись в старых чатах остаются. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  /**
   * Рейтинг на карточке эксперта в десятых (48 = 4,8). Задаётся в админке, из отзывов не считается.
   * Новому эксперту — случайный от 4,6 до 4,9 (lib/experts.ts).
   */
  rating: integer("rating").notNull().default(48),
  /**
   * Отзывы эксперта с других площадок — задаёт админ, новому эксперту 0. На карточке число отзывов —
   * сумма с отзывами на сайте, в профиле подписано, сколько из них с других площадок.
   */
  reviewsShown: integer("reviews_shown").notNull().default(0),
  /**
   * В архиве: клиент его нигде не видит — ни в списке и профиле, ни его чатов, уведомлений от него нет;
   * войти в панель он не может. Достали из архива — всё возвращается как было.
   */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/** Сертификат эксперта — картинка (JPEG, PNG, WebP) с подписью; виден в профиле эксперта. */
export const expertCertificates = pgTable(
  "expert_certificates",
  {
    id: serial("id").primaryKey(),
    expertId: integer("expert_id")
      .notNull()
      .references(() => experts.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    mime: text("mime").notNull(),
    data: bytea("data").notNull(),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("expert_certificates_expert_idx").on(t.expertId, t.sort)],
);

export const expertPhotos = pgTable("expert_photos", {
  expertId: integer("expert_id")
    .primaryKey()
    .references(() => experts.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  data: bytea("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Дополнительные фото эксперта — листаются в профиле после главного (expert_photos). */
export const expertGalleryPhotos = pgTable(
  "expert_gallery_photos",
  {
    id: serial("id").primaryKey(),
    expertId: integer("expert_id")
      .notNull()
      .references(() => experts.id, { onDelete: "cascade" }),
    mime: text("mime").notNull(),
    data: bytea("data").notNull(),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("expert_gallery_photos_expert_idx").on(t.expertId, t.sort)],
);

/** Тексты сайта, которые правит админ. Ключи и тексты по умолчанию — в lib/texts.ts. */
export const texts = pgTable("texts", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Не используется: продукты, заказы и доп. блоки разбора убраны с сайта; таблица остаётся (правило схемы). */
export const diagnosticBlocks = pgTable("diagnostic_blocks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  method: text("method").notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Не используется: продукты, заказы и доп. блоки разбора убраны с сайта; таблица остаётся (правило схемы). */
export const diagnosticTexts = pgTable(
  "diagnostic_texts",
  {
    blockId: integer("block_id")
      .notNull()
      .references(() => diagnosticBlocks.id, { onDelete: "cascade" }),
    value: integer("value").notNull(),
    body: text("body").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockId, t.value] })],
);

/** Человек, заполнивший форму. id — случайный, по нему открывается страница разбора. */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    birthDate: date("birth_date", { mode: "string" }).notNull(),
    /** Раньше — время согласия (галочка в форме); галочку убрали, теперь совпадает со временем заявки. */
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    /** Доставшийся вариант диагностики; null — вариантов не было. */
    variationId: integer("variation_id").references(() => variations.id, { onDelete: "set null" }),
    /**
     * Заявка из приложения в Telegram-боте: id пользователя Telegram. По нему человек снова попадает
     * в свой чат и получает от бота уведомления об ответах; null — заявка с обычного сайта.
     */
    telegramUserId: bigint("telegram_user_id", { mode: "number" }),
    /** Сколько раз человек менял имя и дату рождения на странице разбора (не больше MAX_LEAD_EDITS). */
    edits: integer("edits").notNull().default(0),
  },
  (t) => [index("leads_telegram_user_idx").on(t.telegramUserId, t.createdAt)],
);

/** Не используется: продукты, заказы и доп. блоки разбора убраны с сайта; таблица остаётся (правило схемы). */
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  delivery: text("delivery").notNull().default(""),
  active: boolean("active").notNull().default(false),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  /** Показывать под разбором. Выключено — продукт предлагает только эксперт в чате. */
  showOnResult: boolean("show_on_result").notNull().default(true),
});

/** Не используется: продукты, заказы и доп. блоки разбора убраны с сайта; таблица остаётся (правило схемы). */
export const priceVariants = pgTable("price_variants", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  label: text("label").notNull().default(""),
  amountKopecks: integer("amount_kopecks").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Не используется: продукты, заказы и доп. блоки разбора убраны с сайта; таблица остаётся (правило схемы). */
export const offerImpressions = pgTable(
  "offer_impressions",
  {
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    variantId: integer("variant_id")
      .notNull()
      .references(() => priceVariants.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.productId] })],
);

export const ORDER_STATUSES = ["pending", "paid", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Не используется: продукты, заказы и доп. блоки разбора убраны с сайта; таблица остаётся (правило схемы). */
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  variantId: integer("variant_id")
    .notNull()
    .references(() => priceVariants.id),
  amountKopecks: integer("amount_kopecks").notNull(),
  email: text("email").notNull(),
  status: text("status", { enum: ORDER_STATUSES }).notNull().default("pending"),
  /** Способ оплаты: пока «manual» — админ подтверждает оплату вручную. */
  provider: text("provider").notNull().default("manual"),
  providerPaymentId: text("provider_payment_id"),
  createdAt: createdAt(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  emailError: text("email_error"),
});

/** Чат человека с выбранным экспертом. Один чат на заявку. */
/**
 * Чат человека с экспертом. У заявки может быть несколько чатов — по одному с каждым экспертом:
 * первый человек начинает сам, следующие появляются, когда его переводят к другому эксперту по заявке.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    expertId: integer("expert_id")
      .notNull()
      .references(() => experts.id),
    createdAt: createdAt(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    /** Когда эксперт чата последний раз открывал переписку — для счётчика непрочитанных. */
    expertReadAt: timestamp("expert_read_at", { withTimezone: true }),
    /** Когда в чат ушёл текст 2 варианта (через 3 минуты после начала чата); null — ещё не ушёл. */
    fullTextSentAt: timestamp("full_text_sent_at", { withTimezone: true }),
    /** Клиент попросил позвонить; сбрасывается, когда эксперт или админ начал звонок. */
    callRequestedAt: timestamp("call_requested_at", { withTimezone: true }),
    /** Когда клиент последний раз открывал этот чат — для счётчика непрочитанных в его списке чатов. */
    clientReadAt: timestamp("client_read_at", { withTimezone: true }),
  },
  (t) => [
    index("conversations_lead_idx").on(t.leadId, t.createdAt),
    uniqueIndex("conversations_lead_expert_idx").on(t.leadId, t.expertId),
  ],
);

export const MESSAGE_AUTHORS = ["client", "expert", "admin", "system"] as const;
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];

/**
 * Сообщение чата. author: client — человек, expert — эксперт (expertId — кто именно),
 * admin — админ, system — автоматическое (подробный разбор). productId — предложение продукта.
 */
/**
 * Оператор чатов: входит по логину и паролю в свою панель /operator и работает только с чатами — читает
 * и отвечает во всех, как админ (клиент видит ответ от эксперта чата). Заводит и выключает админ.
 */
export const operators = pgTable("operators", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  login: text("login").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /** Выключенный не может войти; его прежние сообщения остаются подписанными. */
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  /** Удалён из списка; строка остаётся — по ней подписаны его сообщения. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    author: text("author", { enum: MESSAGE_AUTHORS }).notNull(),
    expertId: integer("expert_id").references(() => experts.id),
    body: text("body").notNull().default(""),
    productId: integer("product_id").references(() => products.id),
    createdAt: createdAt(),
    /** author = admin, но написал оператор чатов — какой; null — сам админ. */
    operatorId: integer("operator_id").references(() => operators.id),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.id)],
);

/** Фото в сообщении чата: JPEG, PNG или WebP, одно на сообщение. */
export const messagePhotos = pgTable("message_photos", {
  messageId: integer("message_id")
    .primaryKey()
    .references(() => messages.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  data: bytea("data").notNull(),
  createdAt: createdAt(),
});

/**
 * Отзыв об эксперте: от клиента из чата (один на чат, клиент может поправить) или добавленный в админке
 * (без чата). Виден на карточке эксперта с именем автора; админ и эксперты могут скрыть или удалить.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    /** Чат, из которого клиент оставил отзыв; null — отзыв добавлен в админке. */
    conversationId: uuid("conversation_id")
      .unique()
      .references(() => conversations.id, { onDelete: "cascade" }),
    expertId: integer("expert_id")
      .notNull()
      .references(() => experts.id),
    /** Имя автора: клиента на момент отзыва (как он ввёл его в форме) или заданное в админке. */
    authorName: text("author_name").notNull(),
    /** Звёзды 1–5. */
    stars: integer("stars").notNull(),
    body: text("body").notNull().default(""),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Сотрудник по переписке убедился, что автор — живой человек, а не бот: на карточке отметка
     * «Проверенный пользователь». Только у отзывов из чата (у добавленных в админке проверять некого).
     */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (t) => [index("reviews_expert_idx").on(t.expertId, t.createdAt)],
);

export const EXPERT_CHANGE_STATUSES = ["pending", "approved", "declined"] as const;

/**
 * Не используется: раньше клиент оставлял заявку перейти к другому эксперту, теперь пишет любому
 * эксперту сам. Таблица остаётся (правило схемы).
 */
export const expertChangeRequests = pgTable(
  "expert_change_requests",
  {
    id: serial("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    fromExpertId: integer("from_expert_id")
      .notNull()
      .references(() => experts.id),
    toExpertId: integer("to_expert_id")
      .notNull()
      .references(() => experts.id),
    status: text("status", { enum: EXPERT_CHANGE_STATUSES }).notNull().default("pending"),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    index("expert_change_conversation_idx").on(t.conversationId, t.createdAt),
    uniqueIndex("expert_change_one_pending_idx")
      .on(t.conversationId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const CALL_STATUSES = ["ringing", "active", "ended", "missed", "declined"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

/**
 * Голосовой звонок в чате (через браузер). Звонит эксперт (expertId) или админ, клиент принимает.
 * ringing → active → ended; ringing → missed (не ответили) / declined (отклонили).
 * В чате одновременно может идти только один звонок (уникальный индекс по открытым).
 * clientSeenAt / staffSeenAt — когда сторона последний раз опрашивала звонок: пропала — звонок завершается.
 */
export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    caller: text("caller", { enum: ["expert", "admin"] }).notNull(),
    expertId: integer("expert_id").references(() => experts.id),
    status: text("status", { enum: CALL_STATUSES }).notNull().default("ringing"),
    createdAt: createdAt(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    clientSeenAt: timestamp("client_seen_at", { withTimezone: true }),
    staffSeenAt: timestamp("staff_seen_at", { withTimezone: true }),
  },
  (t) => [
    index("calls_conversation_idx").on(t.conversationId, t.createdAt),
    uniqueIndex("calls_one_open_idx")
      .on(t.conversationId)
      .where(sql`${t.status} in ('ringing', 'active')`),
  ],
);

/** «Рукопожатие» браузеров при звонке: offer от сотрудника, answer от клиента (SDP). Звук сюда не идёт. */
export const callSignals = pgTable(
  "call_signals",
  {
    id: serial("id").primaryKey(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    side: text("side", { enum: ["client", "staff"] }).notNull(),
    kind: text("kind", { enum: ["offer", "answer"] }).notNull(),
    sdp: text("sdp").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("call_signals_call_idx").on(t.callId, t.id)],
);

/**
 * Воронка: шаги, которые человек прошёл на сайте (lib/funnel.ts). До заявки — по анонимному id браузера
 * (cookie vid, без личных данных), после — по заявке. Каждый шаг считается один раз: на браузер или на заявку.
 */
export const funnelEvents = pgTable(
  "funnel_events",
  {
    id: serial("id").primaryKey(),
    visitorId: text("visitor_id").notNull(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("funnel_events_visitor_step_idx").on(t.visitorId, t.step).where(sql`${t.leadId} is null`),
    uniqueIndex("funnel_events_lead_step_idx").on(t.leadId, t.step).where(sql`${t.leadId} is not null`),
    index("funnel_events_step_created_idx").on(t.step, t.createdAt),
  ],
);
