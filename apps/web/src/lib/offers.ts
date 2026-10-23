/**
 * Продукты и варианты цен. Каждому человеку для каждого продукта случайно выбирается
 * один из активных вариантов цены; выбор запоминается и дальше не меняется.
 * По показам и оплатам считается, какой вариант лучше продаёт.
 */
import { randomInt } from "node:crypto";
import { and, asc, count, eq, sql, sum } from "drizzle-orm";
import type { Db } from "@/db";
import { offerImpressions, orders, priceVariants, products } from "@/db/schema";

export type Product = typeof products.$inferSelect;
export type PriceVariant = typeof priceVariants.$inferSelect;

export interface Offer {
  product: Product;
  variant: PriceVariant;
}

/** Цена для людей: 2950 ₽, 1499,50 ₽. */
export function formatRub(kopecks: number): string {
  const rub = Math.floor(kopecks / 100);
  const kop = kopecks % 100;
  const whole = rub.toLocaleString("ru-RU");
  return kop === 0 ? `${whole} ₽` : `${whole},${String(kop).padStart(2, "0")} ₽`;
}

/** «2950», «2 950», «1499,50» → копейки. null — не цена. */
export function parseRub(input: string): number | null {
  const s = input.replace(/[\s₽]/g, "").replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const kopecks = Math.round(Number(s) * 100);
  return kopecks > 0 ? kopecks : null;
}

/** Вариант цены для человека: уже показанный или новый случайный из активных. */
async function variantFor(db: Db, leadId: string, product: Product): Promise<PriceVariant | null> {
  const [shown] = await db
    .select({ variant: priceVariants })
    .from(offerImpressions)
    .innerJoin(priceVariants, eq(priceVariants.id, offerImpressions.variantId))
    .where(and(eq(offerImpressions.leadId, leadId), eq(offerImpressions.productId, product.id)));
  // Уже показанную цену держим, даже если вариант потом выключили: человек видел именно её
  if (shown) return shown.variant;

  const active = await db
    .select()
    .from(priceVariants)
    .where(and(eq(priceVariants.productId, product.id), eq(priceVariants.active, true)))
    .orderBy(asc(priceVariants.id));
  if (active.length === 0) return null;
  const picked = active[randomInt(active.length)] as PriceVariant;

  // Если параллельный запрос уже выбрал вариант — берём его, а не свой
  const inserted = await db
    .insert(offerImpressions)
    .values({ leadId, productId: product.id, variantId: picked.id })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) return picked;
  return variantFor(db, leadId, product);
}

/** Предложения для человека: активные продукты по порядку, у каждого — его вариант цены. */
export async function offersForLead(db: Db, leadId: string): Promise<Offer[]> {
  const list = await db
    .select()
    .from(products)
    .where(eq(products.active, true))
    .orderBy(asc(products.sort), asc(products.id));
  const out: Offer[] = [];
  for (const product of list) {
    const variant = await variantFor(db, leadId, product);
    if (variant) out.push({ product, variant });
  }
  return out;
}

/** Предложение конкретного продукта для человека — для оформления заказа. */
export async function offerForLead(db: Db, leadId: string, productId: number): Promise<Offer | null> {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.active, true)));
  if (!product) return null;
  const variant = await variantFor(db, leadId, product);
  return variant ? { product, variant } : null;
}

// --- Для админки ---

export function listProducts(db: Db) {
  return db.select().from(products).orderBy(asc(products.sort), asc(products.id));
}

export async function getProduct(db: Db, id: number) {
  const [product] = await db.select().from(products).where(eq(products.id, id));
  return product ?? null;
}

export function listVariants(db: Db, productId: number) {
  return db
    .select()
    .from(priceVariants)
    .where(eq(priceVariants.productId, productId))
    .orderBy(asc(priceVariants.id));
}

export interface VariantStats {
  variantId: number;
  productId: number;
  productTitle: string;
  label: string;
  amountKopecks: number;
  active: boolean;
  shown: number;
  paid: number;
  revenueKopecks: number;
  /** Доля оплат от показов, 0–1. */
  conversion: number;
}

/** Статистика по каждому варианту цены: показы, оплаты, выручка, конверсия. */
export async function variantStats(db: Db): Promise<VariantStats[]> {
  const shownRows = await db
    .select({ variantId: offerImpressions.variantId, shown: count() })
    .from(offerImpressions)
    .groupBy(offerImpressions.variantId);
  const paidRows = await db
    .select({
      variantId: orders.variantId,
      paid: count(),
      revenue: sum(orders.amountKopecks).mapWith(Number),
    })
    .from(orders)
    .where(eq(orders.status, "paid"))
    .groupBy(orders.variantId);
  const variants = await db
    .select({ v: priceVariants, title: products.title })
    .from(priceVariants)
    .innerJoin(products, eq(products.id, priceVariants.productId))
    .orderBy(asc(products.sort), asc(products.id), asc(priceVariants.id));

  const shown = new Map(shownRows.map((r) => [r.variantId, r.shown]));
  const paid = new Map(paidRows.map((r) => [r.variantId, r]));
  return variants.map(({ v, title }) => {
    const s = shown.get(v.id) ?? 0;
    const p = paid.get(v.id);
    return {
      variantId: v.id,
      productId: v.productId,
      productTitle: title,
      label: v.label,
      amountKopecks: v.amountKopecks,
      active: v.active,
      shown: s,
      paid: p?.paid ?? 0,
      revenueKopecks: p?.revenue ?? 0,
      conversion: s > 0 ? (p?.paid ?? 0) / s : 0,
    };
  });
}

/** Сводка для главной админки. */
export async function dashboardTotals(db: Db) {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${orders.status} = 'pending')`.mapWith(Number),
      paid: sql<number>`count(*) filter (where ${orders.status} = 'paid')`.mapWith(Number),
      revenue: sql<number>`coalesce(sum(${orders.amountKopecks}) filter (where ${orders.status} = 'paid'), 0)`.mapWith(
        Number,
      ),
    })
    .from(orders);
  return row ?? { pending: 0, paid: 0, revenue: 0 };
}
