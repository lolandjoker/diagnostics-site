/**
 * Чат человека с экспертом. Человек входит без регистрации: доступ к чату — по случайному id
 * его заявки в адресе. Пишут: клиент, любой эксперт, админ (подписан «Администратор»).
 * Подписи у сообщений — настоящие: ответил другой эксперт — клиент видит его имя.
 */
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, experts, leads, messages, products } from "@/db/schema";
import type { MessageAuthor } from "@/db/schema";
import { parseIsoDate } from "./diagnostic";
import { getExpert, isOnline, listExperts } from "./experts";
import type { Lead } from "./leads";
import { formatRub, offerForLead } from "./offers";
import { fillTemplate, getTexts } from "./texts";
import { variationFor } from "./variations";

export type Conversation = typeof conversations.$inferSelect;

export const MAX_MESSAGE_LENGTH = 4000;
export const CLIENT_MESSAGES_PER_MINUTE = 20;

export async function conversationForLead(db: Db, leadId: string): Promise<Conversation | null> {
  const [c] = await db.select().from(conversations).where(eq(conversations.leadId, leadId));
  return c ?? null;
}

export async function getConversation(db: Db, id: string): Promise<Conversation | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [c] = await db.select().from(conversations).where(eq(conversations.id, id));
  return c ?? null;
}

/** Эксперты, которых может выбрать человек: онлайн; если онлайн никого — никого. */
export async function selectableExperts(db: Db, now: Date) {
  const all = (await listExperts(db)).filter((e) => e.active);
  return all.map((e) => ({ ...e, isOnline: isOnline(e, now) }));
}

export type StartResult = { ok: true; conversation: Conversation } | { ok: false; error: string };

/**
 * Человек выбрал эксперта: создаётся чат, и в него сразу приходит подробный разбор по его варианту
 * — сообщением с подписью «Подробный разбор», а не от имени эксперта. Повторный выбор — в тот же чат.
 */
export async function startConversation(db: Db, lead: Lead, expertId: number, now: Date): Promise<StartResult> {
  const existing = await conversationForLead(db, lead.id);
  if (existing) return { ok: true, conversation: existing };

  const expert = await getExpert(db, expertId);
  if (!expert || !expert.active) return { ok: false, error: "Эксперт не найден" };
  if (!isOnline(expert, now)) return { ok: false, error: "Этот эксперт сейчас не в сети — выберите другого" };

  const [created] = await db
    .insert(conversations)
    .values({ leadId: lead.id, expertId: expert.id })
    .onConflictDoNothing()
    .returning();
  // Двойной клик: чат уже создан параллельным запросом
  if (!created) {
    const again = await conversationForLead(db, lead.id);
    return again ? { ok: true, conversation: again } : { ok: false, error: "Не удалось открыть чат" };
  }

  const result = await variationFor(db, lead.variationId, {
    birth: parseIsoDate(lead.birthDate),
    name: lead.name,
    year: now.getUTCFullYear(),
  });
  if (result?.fullText) {
    await postMessage(db, created.id, { author: "system", body: fillTemplate(result.fullText, { name: lead.name }) });
  }
  return { ok: true, conversation: created };
}

export type PostInput = { author: MessageAuthor; body?: string; expertId?: number; productId?: number };
export type PostResult = { ok: true; id: number } | { ok: false; error: string };

export async function postMessage(db: Db, conversationId: string, input: PostInput): Promise<PostResult> {
  const body = (input.body ?? "").replace(/\r\n/g, "\n").trim();
  if (input.productId === undefined && body === "") return { ok: false, error: "Пустое сообщение" };
  if (body.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `Сообщение длиннее ${MAX_MESSAGE_LENGTH} символов` };

  if (input.author === "client") {
    const [recent] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.author, "client"),
          gt(messages.createdAt, sql`now() - interval '1 minute'`),
        ),
      );
    if ((recent?.n ?? 0) >= CLIENT_MESSAGES_PER_MINUTE) return { ok: false, error: "Слишком много сообщений, подождите минуту" };
  }

  const [m] = await db
    .insert(messages)
    .values({
      conversationId,
      author: input.author,
      body,
      expertId: input.expertId ?? null,
      productId: input.productId ?? null,
    })
    .returning({ id: messages.id });
  await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
  return { ok: true, id: (m as { id: number }).id };
}

export interface MessageView {
  id: number;
  author: MessageAuthor;
  authorName: string;
  /** Какой эксперт написал (для author = expert), иначе null. */
  expertId: number | null;
  body: string;
  createdAt: string;
  /** Предложение продукта: что показать и куда ведёт «Купить». null — продукт уже недоступен. */
  offer?: { title: string; description: string; price: string; url: string } | null;
}

/**
 * Сообщения чата после afterId. viewer: client — человек («Вы» вместо его имени);
 * staff — эксперты и админ (видят имя человека).
 */
export async function messageViews(
  db: Db,
  conversation: Conversation,
  afterId: number,
  viewer: "client" | "staff",
): Promise<MessageView[]> {
  const rows = await db
    .select({ m: messages, expertName: experts.name })
    .from(messages)
    .leftJoin(experts, eq(experts.id, messages.expertId))
    .where(and(eq(messages.conversationId, conversation.id), gt(messages.id, afterId)))
    .orderBy(asc(messages.id))
    .limit(500);
  if (rows.length === 0) return [];

  const t = await getTexts(db, ["chat.admin_name", "chat.system_name", "chat.client_name"]);
  const [lead] = await db.select({ name: leads.name }).from(leads).where(eq(leads.id, conversation.leadId));
  const clientName = viewer === "client" ? t["chat.client_name"] : (lead?.name ?? "Клиент");

  const out: MessageView[] = [];
  for (const { m, expertName } of rows) {
    const authorName =
      m.author === "client"
        ? clientName
        : m.author === "expert"
          ? (expertName ?? "Эксперт")
          : m.author === "admin"
            ? t["chat.admin_name"]
            : t["chat.system_name"];
    const view: MessageView = {
      id: m.id,
      author: m.author,
      authorName,
      expertId: m.expertId,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    };
    if (m.productId !== null) {
      const offer = await offerForLead(db, conversation.leadId, m.productId);
      view.offer = offer
        ? {
            title: offer.product.title,
            description: offer.product.description,
            price: formatRub(offer.variant.amountKopecks),
            url: `/razbor/${conversation.leadId}/zakaz/${offer.product.id}`,
          }
        : null;
    }
    out.push(view);
  }
  return out;
}

export async function markExpertRead(db: Db, conversationId: string, now: Date): Promise<void> {
  await db.update(conversations).set({ expertReadAt: now }).where(eq(conversations.id, conversationId));
}

export interface InboxItem {
  id: string;
  leadName: string;
  expertId: number;
  expertName: string;
  lastMessageAt: string;
  lastMessage: string;
  /** Сообщений клиента, которые эксперт этого чата ещё не открывал. */
  unread: number;
}

/** Все чаты, свежие сверху. Эксперт видит все и может ответить в любом. */
export async function inbox(db: Db, limit = 300): Promise<InboxItem[]> {
  const rows = await db
    .select({
      c: conversations,
      leadName: leads.name,
      expertName: experts.name,
      unread: sql<number>`(select count(*) from ${messages} m where m.conversation_id = ${conversations.id}
        and m.author = 'client' and (${conversations.expertReadAt} is null or m.created_at > ${conversations.expertReadAt}))`.mapWith(
        Number,
      ),
      lastMessage: sql<string>`coalesce((select case when m.product_id is not null then '[предложение продукта]' else left(m.body, 120) end
        from ${messages} m where m.conversation_id = ${conversations.id} order by m.id desc limit 1), '')`,
    })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.c.id,
    leadName: r.leadName,
    expertId: r.c.expertId,
    expertName: r.expertName,
    lastMessageAt: r.c.lastMessageAt.toISOString(),
    lastMessage: r.lastMessage,
    unread: r.unread,
  }));
}

/** Шапка чата для сотрудников: кто клиент, какой эксперт, что видит клиент. */
export async function conversationHeader(db: Db, conversation: Conversation) {
  const [row] = await db
    .select({ leadName: leads.name, birthDate: leads.birthDate, expertName: experts.name })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .where(eq(conversations.id, conversation.id));
  return row ?? null;
}

/** Продукты, которые эксперт может предложить в чате: все включённые. */
export function offerableProducts(db: Db) {
  return db
    .select({ id: products.id, title: products.title })
    .from(products)
    .where(eq(products.active, true))
    .orderBy(asc(products.sort), asc(products.id));
}
