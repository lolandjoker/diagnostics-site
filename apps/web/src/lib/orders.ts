/**
 * Заказы. Цена берётся только на сервере — из варианта, показанного этому человеку.
 * Оплата пока подтверждается вручную в админке; после подтверждения уходит письмо
 * с тем, что указано в продукте («Что получает человек»).
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { orders, priceVariants, products } from "@/db/schema";
import type { Mailer } from "./mail";
import { offerForLead } from "./offers";
import { fillTemplate, getTexts } from "./texts";
import { isUuid } from "./leads";

export type Order = typeof orders.$inferSelect;

const emailSchema = z.email({ error: "Проверьте адрес почты" }).max(200, { error: "Адрес почты слишком длинный" });

export type CreateOrderResult = { ok: true; order: Order } | { ok: false; error: string };

export async function createOrder(
  db: Db,
  input: { leadId: string; productId: number; email: string },
): Promise<CreateOrderResult> {
  const email = emailSchema.safeParse(input.email.trim().toLowerCase());
  if (!email.success) return { ok: false, error: email.error.issues[0]?.message ?? "Проверьте адрес почты" };
  if (!isUuid(input.leadId)) return { ok: false, error: "Заказ не найден" };

  const offer = await offerForLead(db, input.leadId, input.productId);
  if (!offer) return { ok: false, error: "Этот продукт сейчас недоступен" };

  const [order] = await db
    .insert(orders)
    .values({
      leadId: input.leadId,
      productId: offer.product.id,
      variantId: offer.variant.id,
      amountKopecks: offer.variant.amountKopecks,
      email: email.data,
    })
    .returning();
  return { ok: true, order: order as Order };
}

/** Короткий номер заказа для людей: первые 8 символов id. */
export function orderNumber(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export async function getOrderWithProduct(db: Db, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({ order: orders, product: products })
    .from(orders)
    .innerJoin(products, eq(products.id, orders.productId))
    .where(eq(orders.id, id));
  return row ?? null;
}

/** Отправляет письмо с заказом и записывает результат в заказ. */
export async function sendOrderEmail(db: Db, orderId: string, mailer: Mailer | null): Promise<boolean> {
  const row = await getOrderWithProduct(db, orderId);
  if (!row || row.order.status !== "paid") return false;
  if (!mailer) {
    await db.update(orders).set({ emailError: "Почта не настроена (SMTP_URL, MAIL_FROM)" }).where(eq(orders.id, orderId));
    return false;
  }
  const t = await getTexts(db, ["email.subject", "email.intro"]);
  const vars = { product: row.product.title, order: orderNumber(row.order.id) };
  try {
    await mailer({
      to: row.order.email,
      subject: fillTemplate(t["email.subject"], vars),
      text: [fillTemplate(t["email.intro"], vars), row.product.delivery, `Номер заказа: ${vars.order}`]
        .filter((part) => part.trim() !== "")
        .join("\n\n"),
    });
    await db.update(orders).set({ emailSentAt: new Date(), emailError: null }).where(eq(orders.id, orderId));
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(orders).set({ emailError: message.slice(0, 500) }).where(eq(orders.id, orderId));
    return false;
  }
}

/** Отмечает заказ оплаченным (только из «ожидает оплаты») и отправляет письмо. */
export async function markPaid(db: Db, orderId: string, mailer: Mailer | null): Promise<boolean> {
  if (!isUuid(orderId)) return false;
  const updated = await db
    .update(orders)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.status, "pending")))
    .returning({ id: orders.id });
  if (updated.length === 0) return false;
  await sendOrderEmail(db, orderId, mailer);
  return true;
}

export async function cancelOrder(db: Db, orderId: string): Promise<boolean> {
  if (!isUuid(orderId)) return false;
  const updated = await db
    .update(orders)
    .set({ status: "cancelled" })
    .where(and(eq(orders.id, orderId), eq(orders.status, "pending")))
    .returning({ id: orders.id });
  return updated.length > 0;
}

/** Последние заказы для админки. */
export function listOrders(db: Db, limit = 200) {
  return db
    .select({ order: orders, productTitle: products.title, variantLabel: priceVariants.label })
    .from(orders)
    .innerJoin(products, eq(products.id, orders.productId))
    .innerJoin(priceVariants, eq(priceVariants.id, orders.variantId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}
