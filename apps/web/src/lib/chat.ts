/**
 * Чат человека с экспертом. Человек входит без регистрации: доступ к чату — по случайному id
 * его заявки в адресе. Пишут: клиент, любой эксперт, админ (подписан «Администратор»).
 * Подписи у сообщений — настоящие: ответил другой эксперт — клиент видит его имя.
 * К сообщению можно приложить фото (JPEG, PNG или WebP до MAX_CHAT_PHOTO_BYTES).
 */
import { and, asc, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, experts, leads, messagePhotos, messages, products } from "@/db/schema";
import type { MessageAuthor } from "@/db/schema";
import { detectImageMime, expertPhotoUrls, getExpert, isOnline, listExperts } from "./experts";
import type { Lead } from "./leads";
import { formatRub, offerForLead } from "./offers";
import { fillTemplate, getTexts } from "./texts";
import { variationFor } from "./variations";

export type Conversation = typeof conversations.$inferSelect;

export const MAX_MESSAGE_LENGTH = 4000;
export const CLIENT_MESSAGES_PER_MINUTE = 20;
/** Через сколько после начала чата в него приходит текст 2 варианта. */
export const FULL_TEXT_DELAY_MS = 3 * 60 * 1000;
/** Фото в чате. Браузер перед отправкой уменьшает снимок, так что обычно выходит меньше 1 МБ. */
export const MAX_CHAT_PHOTO_BYTES = 5 * 1024 * 1024;

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
 * Человек выбрал эксперта: создаётся чат. Текст 2 варианта приходит в него через FULL_TEXT_DELAY_MS
 * (см. deliverDueFullTexts). Повторный выбор — в тот же чат.
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
  return { ok: true, conversation: created };
}

/**
 * Отправляет текст 2 варианта в чаты, которым уже FULL_TEXT_DELAY_MS, — сообщением с подписью
 * «Подробный разбор», а не от имени эксперта. Вызывается при каждом опросе чата и списка чатов,
 * поэтому сообщение появляется вовремя без фоновых задач. Каждый чат отмечается одним UPDATE —
 * два одновременных опроса не отправят текст дважды. conversationId — проверить только этот чат.
 */
export async function deliverDueFullTexts(db: Db, now: Date, conversationId?: string): Promise<void> {
  const due = await db
    .update(conversations)
    .set({ fullTextSentAt: now })
    .where(
      and(
        isNull(conversations.fullTextSentAt),
        lte(conversations.createdAt, new Date(now.getTime() - FULL_TEXT_DELAY_MS)),
        conversationId === undefined ? undefined : eq(conversations.id, conversationId),
      ),
    )
    .returning({ id: conversations.id, leadId: conversations.leadId });

  for (const c of due) {
    const [lead] = await db
      .select({ name: leads.name, variationId: leads.variationId })
      .from(leads)
      .where(eq(leads.id, c.leadId));
    const texts = lead ? await variationFor(db, lead.variationId) : null;
    if (lead && texts?.fullText) {
      await postMessage(db, c.id, { author: "system", body: fillTemplate(texts.fullText, { name: lead.name }) });
    }
  }
}

export type PostInput = { author: MessageAuthor; body?: string; expertId?: number; productId?: number; photo?: Buffer };
export type PostResult = { ok: true; id: number } | { ok: false; error: string };

export async function postMessage(db: Db, conversationId: string, input: PostInput): Promise<PostResult> {
  const body = (input.body ?? "").replace(/\r\n/g, "\n").trim();
  const photo = input.photo;
  if (input.productId === undefined && photo === undefined && body === "") return { ok: false, error: "Пустое сообщение" };
  if (body.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `Сообщение длиннее ${MAX_MESSAGE_LENGTH} символов` };
  const photoMime = photo === undefined ? null : detectImageMime(photo);
  if (photo !== undefined) {
    if (photo.length > MAX_CHAT_PHOTO_BYTES) return { ok: false, error: "Фото больше 5 МБ" };
    if (!photoMime) return { ok: false, error: "Фото должно быть в формате JPEG, PNG или WebP" };
  }

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

  // Сообщение и фото — одной транзакцией: опрос чата не увидит сообщение без его фото
  const id = await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(messages)
      .values({
        conversationId,
        author: input.author,
        body,
        expertId: input.expertId ?? null,
        productId: input.productId ?? null,
      })
      .returning({ id: messages.id });
    const messageId = (m as { id: number }).id;
    if (photo !== undefined && photoMime) {
      await tx.insert(messagePhotos).values({ messageId, mime: photoMime, data: photo });
    }
    await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
    return messageId;
  });
  return { ok: true, id };
}

/** Фото сообщения — только из чата этой заявки (адрес фото знает тот, кто знает адрес чата). */
export async function getMessagePhoto(db: Db, leadId: string, messageId: number) {
  const [p] = await db
    .select({ mime: messagePhotos.mime, data: messagePhotos.data })
    .from(messagePhotos)
    .innerJoin(messages, eq(messages.id, messagePhotos.messageId))
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messagePhotos.messageId, messageId), eq(conversations.leadId, leadId)));
  return p ?? null;
}

export interface MessageView {
  id: number;
  author: MessageAuthor;
  authorName: string;
  /** Какой эксперт написал (для author = expert), иначе null. */
  expertId: number | null;
  /** Фото эксперта, написавшего сообщение; null — фото нет или пишет не эксперт. */
  avatar: string | null;
  body: string;
  /** Адрес приложенного фото. */
  photo?: string;
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
    .select({ m: messages, expertName: experts.name, photoId: messagePhotos.messageId })
    .from(messages)
    .leftJoin(experts, eq(experts.id, messages.expertId))
    .leftJoin(messagePhotos, eq(messagePhotos.messageId, messages.id))
    .where(and(eq(messages.conversationId, conversation.id), gt(messages.id, afterId)))
    .orderBy(asc(messages.id))
    .limit(500);
  if (rows.length === 0) return [];

  const t = await getTexts(db, ["chat.admin_name", "chat.system_name", "chat.client_name"]);
  const avatars = await expertPhotoUrls(db);
  const [lead] = await db.select({ name: leads.name }).from(leads).where(eq(leads.id, conversation.leadId));
  const clientName = viewer === "client" ? t["chat.client_name"] : (lead?.name ?? "Клиент");

  const out: MessageView[] = [];
  for (const { m, expertName, photoId } of rows) {
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
      avatar: m.author === "expert" && m.expertId !== null ? (avatars.get(m.expertId) ?? null) : null,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    };
    if (photoId !== null) view.photo = `/api/chat/${conversation.leadId}/photo/${m.id}`;
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
      lastMessage: sql<string>`coalesce((select case when m.product_id is not null then '[предложение продукта]'
          when m.body = '' and exists (select 1 from ${messagePhotos} p where p.message_id = m.id) then '[фото]'
          else left(m.body, 120) end
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
