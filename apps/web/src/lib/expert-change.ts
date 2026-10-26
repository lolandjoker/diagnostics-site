/**
 * Смена эксперта по заявке клиента. У заявки один чат, поэтому клиент, который уже пишет эксперту,
 * не начинает новый чат, а оставляет заявку на другого. Админ или эксперт переводит — у чата
 * меняется эксперт, переписка остаётся, новый эксперт здоровается сообщением — или отклоняет.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, expertChangeRequests, experts, leads } from "@/db/schema";
import { postMessage } from "./chat";
import type { Conversation } from "./chat";

export type ExpertChangeRequest = typeof expertChangeRequests.$inferSelect;
export type ChangeResult = { ok: true } | { ok: false; error: string };

/** Последняя заявка чата (любого статуса) — клиенту показать, что с ней. */
export async function latestExpertChange(db: Db, conversationId: string): Promise<ExpertChangeRequest | null> {
  const [r] = await db
    .select()
    .from(expertChangeRequests)
    .where(eq(expertChangeRequests.conversationId, conversationId))
    .orderBy(desc(expertChangeRequests.createdAt), desc(expertChangeRequests.id))
    .limit(1);
  return r ?? null;
}

/** Открытая заявка чата с именами экспертов — для сотрудников в чате. */
export async function pendingExpertChange(db: Db, conversationId: string) {
  const [r] = await db
    .select({ id: expertChangeRequests.id, toExpertId: expertChangeRequests.toExpertId, toName: experts.name })
    .from(expertChangeRequests)
    .innerJoin(experts, eq(experts.id, expertChangeRequests.toExpertId))
    .where(and(eq(expertChangeRequests.conversationId, conversationId), eq(expertChangeRequests.status, "pending")));
  return r ?? null;
}

/** Клиент просит перейти к эксперту toExpertId. Открытая заявка уже есть — меняем в ней эксперта. */
export async function requestExpertChange(db: Db, conversation: Conversation, toExpertId: number, now: Date): Promise<ChangeResult> {
  if (toExpertId === conversation.expertId) return { ok: false, error: "Это и так ваш эксперт" };
  const [target] = await db
    .select({ id: experts.id })
    .from(experts)
    .where(and(eq(experts.id, toExpertId), eq(experts.active, true), isNull(experts.deletedAt)));
  if (!target) return { ok: false, error: "Эксперт не найден" };
  const updated = await db
    .update(expertChangeRequests)
    .set({ toExpertId, createdAt: now })
    .where(and(eq(expertChangeRequests.conversationId, conversation.id), eq(expertChangeRequests.status, "pending")))
    .returning({ id: expertChangeRequests.id });
  if (updated.length === 0) {
    // Две заявки одновременно — вторая упрётся в уникальный индекс открытых; это не ошибка для клиента
    await db
      .insert(expertChangeRequests)
      .values({ conversationId: conversation.id, fromExpertId: conversation.expertId, toExpertId, createdAt: now })
      .onConflictDoNothing();
  }
  return { ok: true };
}

/** Перевести клиента к эксперту из заявки: у чата новый эксперт, он здоровается в чате. */
export async function approveExpertChange(db: Db, requestId: number, now: Date): Promise<ChangeResult> {
  const [req] = await db
    .update(expertChangeRequests)
    .set({ status: "approved", decidedAt: now })
    .where(and(eq(expertChangeRequests.id, requestId), eq(expertChangeRequests.status, "pending")))
    .returning();
  if (!req) return { ok: false, error: "Заявка уже обработана" };
  await db.update(conversations).set({ expertId: req.toExpertId, expertReadAt: null }).where(eq(conversations.id, req.conversationId));
  const [row] = await db
    .select({ expertName: experts.name, clientName: leads.name })
    .from(conversations)
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .where(eq(conversations.id, req.conversationId));
  await postMessage(db, req.conversationId, {
    author: "expert",
    expertId: req.toExpertId,
    body: `${row?.clientName ? `${row.clientName}, здравствуйте` : "Здравствуйте"}! Теперь с вами работаю я — ${row?.expertName ?? "ваш новый эксперт"}. Переписку я вижу, продолжим здесь.`,
  });
  return { ok: true };
}

export async function declineExpertChange(db: Db, requestId: number, now: Date): Promise<ChangeResult> {
  const done = await db
    .update(expertChangeRequests)
    .set({ status: "declined", decidedAt: now })
    .where(and(eq(expertChangeRequests.id, requestId), eq(expertChangeRequests.status, "pending")))
    .returning({ id: expertChangeRequests.id });
  return done.length > 0 ? { ok: true } : { ok: false, error: "Заявка уже обработана" };
}
