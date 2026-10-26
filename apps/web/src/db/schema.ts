/**
 * Таблицы базы данных. Правило проекта: изменения только добавляют —
 * столбцы и таблицы не удаляются и не переименовываются.
 * После правки схемы: pnpm --filter @diag/web db:generate (создаёт миграцию в drizzle/).
 */
import { sql } from "drizzle-orm";
import {
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
  /** Число отзывов на карточке («347 отзывов») — задаётся в админке, новому — случайное от 200 до 500. */
  reviewsShown: integer("reviews_shown").notNull().default(0),
});

export const expertPhotos = pgTable("expert_photos", {
  expertId: integer("expert_id")
    .primaryKey()
    .references(() => experts.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  data: bytea("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  birthDate: date("birth_date", { mode: "string" }).notNull(),
  /** Раньше — время согласия (галочка в форме); галочку убрали, теперь совпадает со временем заявки. */
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  /** Доставшийся вариант диагностики; null — вариантов не было. */
  variationId: integer("variation_id").references(() => variations.id, { onDelete: "set null" }),
});

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
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id")
    .notNull()
    .unique()
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
});

export const MESSAGE_AUTHORS = ["client", "expert", "admin", "system"] as const;
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];

/**
 * Сообщение чата. author: client — человек, expert — эксперт (expertId — кто именно),
 * admin — админ, system — автоматическое (подробный разбор). productId — предложение продукта.
 */
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
  },
  (t) => [index("reviews_expert_idx").on(t.expertId, t.createdAt)],
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
