/**
 * Смена эксперта по заявке клиента. Клиент, у которого уже есть чат, не начинает новый сам, а оставляет
 * заявку на другого эксперта. Админ или эксперт переводит — у клиента появляется чат с новым экспертом
 * (или открывается прежний с ним), новый эксперт здоровается, а в старом чате клиенту сообщают о переводе;
 * все чаты остаются в списке у клиента. Или отклоняет.
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
  const [already] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.leadId, conversation.leadId), eq(conversations.expertId, toExpertId)));
  if (already) return { ok: false, error: "С этим экспертом у вас уже есть чат — откройте его в списке переписок" };
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
  const [old] = await db
    .select({ leadId: conversations.leadId, clientName: leads.name })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .where(eq(conversations.id, req.conversationId));
  const [toExpert] = await db.select({ name: experts.name }).from(experts).where(eq(experts.id, req.toExpertId));
  if (!old || !toExpert) return { ok: false, error: "Чат или эксперт не найден" };

  // Чат с новым экспертом: прежний, если уже был, иначе новый. Текст 2 варианта в него не приходит —
  // он уже был в первом чате (fullTextSentAt сразу).
  const findChat = async () =>
    (
      await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.leadId, old.leadId), eq(conversations.expertId, req.toExpertId)))
    )[0];
  let chat = await findChat();
  if (!chat) {
    await db
      .insert(conversations)
      .values({ leadId: old.leadId, expertId: req.toExpertId, createdAt: now, fullTextSentAt: now })
      .onConflictDoNothing();
    chat = await findChat();
  }
  if (!chat) return { ok: false, error: "Не удалось открыть чат с новым экспертом" };

  // В старом чате — от его эксперта (сообщение админа клиент видит от эксперта чата)
  await postMessage(db, req.conversationId, {
    author: "admin",
    body: `Вас перевели к эксперту ${toExpert.name} — чат с новым экспертом уже в списке ваших переписок.`,
  });
  await postMessage(db, chat.id, {
    author: "expert",
    expertId: req.toExpertId,
    body: `${old.clientName ? `${old.clientName}, здравствуйте` : "Здравствуйте"}! Теперь с вами работаю я — ${toExpert.name}. Расскажите, с каким вопросом пришли, — начнём.`,
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
