/**
 * Таблицы базы данных. Правило проекта: изменения только добавляют —
 * столбцы и таблицы не удаляются и не переименовываются.
 * После правки схемы: pnpm --filter @diag/web db:generate (создаёт миграцию в drizzle/).
 */
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

/** Эксперт: профиль на сайте + вход в панель. Онлайн — если включил статус и заходил в панель недавно. */
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
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
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

/** Блок бесплатного разбора: заголовок + способ расчёта числа (lib/diagnostic.ts). */
export const diagnosticBlocks = pgTable("diagnostic_blocks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  method: text("method").notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Текст блока для конкретного значения: «архетип 4 → такой-то текст». */
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
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  /** Доставшийся вариант диагностики; null — вариантов не было. */
  variationId: integer("variation_id").references(() => variations.id, { onDelete: "set null" }),
});

/** Продукт (курс, отчёт). delivery — что человек получает письмом после оплаты. */
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

/** Вариант цены продукта. Каждому человеку случайно показывается один из активных вариантов. */
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

/** Какой вариант цены показан человеку. Один раз выбран — дальше не меняется. */
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
