/**
 * Таблицы базы данных. Правило проекта: изменения только добавляют —
 * столбцы и таблицы не удаляются и не переименовываются.
 * После правки схемы: pnpm --filter @diag/web db:generate (создаёт миграцию в drizzle/).
 */
import {
  boolean,
  date,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

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
