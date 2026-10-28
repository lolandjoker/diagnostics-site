/**
 * Чат человека с экспертом. Человек входит без регистрации: доступ к чату — по случайному id
 * его заявки в адресе. У заявки может быть несколько чатов — по одному с каждым экспертом: написать
 * можно любому, без заявок; «текущий» — с последним сообщением. Пишут: клиент, любой эксперт, админ.
 * Ответил другой эксперт — клиент видит его имя. Сообщения админа клиент видит от имени эксперта
 * чата (имя и фото); подпись «Администратор» видят только эксперты и админ.
 * К сообщению можно приложить фото (JPEG, PNG или WebP до MAX_CHAT_PHOTO_BYTES).
 */
import { and, asc, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, experts, leads, messagePhotos, messages } from "@/db/schema";
import type { MessageAuthor } from "@/db/schema";
import { detectImageMime, expertPhotoUrls, expertStatus, getExpert, isOnline, listExperts } from "./experts";
import type { Lead } from "./leads";
import { notifyClient } from "./telegram";
import { fillTemplate, getTexts } from "./texts";
import { variationFor } from "./variations";

export type Conversation = typeof conversations.$inferSelect;

export const MAX_MESSAGE_LENGTH = 4000;
export const CLIENT_MESSAGES_PER_MINUTE = 20;
/** Через сколько после начала чата в него приходит текст 2 варианта. */
export const FULL_TEXT_DELAY_MS = 3 * 60 * 1000;
/** За сколько до текста 2 у клиента появляется «печатает…» — будто подробный разбор набирают. */
export const FULL_TEXT_TYPING_MS = 20_000;
/** Фото в чате. Браузер перед отправкой уменьшает снимок, так что обычно выходит меньше 1 МБ. */
export const MAX_CHAT_PHOTO_BYTES = 5 * 1024 * 1024;

/** Текущий чат заявки — где последнее сообщение (после перевода — чат с новым экспертом); null — чата нет. */
export async function conversationForLead(db: Db, leadId: string): Promise<Conversation | null> {
  const [c] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.leadId, leadId))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.createdAt))
    .limit(1);
  return c ?? null;
}

/** Чат заявки по его id (только если он этой заявки) или текущий, если id не задан. */
export async function leadConversation(db: Db, leadId: string, conversationId?: string | null): Promise<Conversation | null> {
  if (!conversationId) return conversationForLead(db, leadId);
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return null;
  const [c] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.leadId, leadId)));
  return c ?? null;
}

/** Клиент открыл чат — его сообщения больше не «непрочитанные» в списке чатов. */
export async function markClientRead(db: Db, conversationId: string, now: Date): Promise<void> {
  await db.update(conversations).set({ clientReadAt: now }).where(eq(conversations.id, conversationId));
}

export interface ClientChatItem {
  id: string;
  expertId: number;
  expertName: string;
  expertPhoto: string | null;
  lastMessage: string;
  lastMessageAt: string;
  /** Сообщений эксперта (и админа, и разбора), которые клиент ещё не видел. */
  unread: number;
}

/** Чаты клиента для списка слева: свежие сверху. */
export async function clientChats(db: Db, leadId: string): Promise<ClientChatItem[]> {
  const rows = await db
    .select({
      c: conversations,
      expertName: experts.name,
      unread: sql<number>`(select count(*) from ${messages} m where m.conversation_id = ${conversations.id}
        and m.author <> 'client' and (${conversations.clientReadAt} is null or m.created_at > ${conversations.clientReadAt}))`.mapWith(
        Number,
      ),
      lastMessage: sql<string>`coalesce((select case when m.product_id is not null then 'Предложение продукта'
          when m.body = '' and exists (select 1 from ${messagePhotos} p where p.message_id = m.id) then 'Фото'
          else left(m.body, 120) end
        from ${messages} m where m.conversation_id = ${conversations.id} order by m.id desc limit 1), '')`,
    })
    .from(conversations)
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .where(eq(conversations.leadId, leadId))
    .orderBy(desc(conversations.lastMessageAt));
  const photos = await expertPhotoUrls(db);
  return rows.map((r) => ({
    id: r.c.id,
    expertId: r.c.expertId,
    expertName: r.expertName,
    expertPhoto: photos.get(r.c.expertId) ?? null,
    lastMessage: r.lastMessage,
    lastMessageAt: r.c.lastMessageAt.toISOString(),
    unread: r.unread,
  }));
}

export async function getConversation(db: Db, id: string): Promise<Conversation | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [c] = await db.select().from(conversations).where(eq(conversations.id, id));
  return c ?? null;
}

/** Эксперты, которых может выбрать человек: онлайн; если онлайн никого — никого. */
export async function selectableExperts(db: Db, now: Date) {
  const all = (await listExperts(db)).filter((e) => e.active);
  return all.map((e) => ({ ...e, isOnline: isOnline(e, now), status: expertStatus(e, now) }));
}

export type StartResult = { ok: true; conversation: Conversation } | { ok: false; error: string };

/**
 * Человек выбрал эксперта: открывается чат с ним (уже был — тот же). Писать можно любому эксперту,
 * у каждого свой чат в списке переписок. Первый чат — только с экспертом в сети, начинается
 * сообщением клиента «расскажите подробнее» (текст chat.first_message), и в него через
 * FULL_TEXT_DELAY_MS приходит текст 2 варианта (см. deliverDueFullTexts); в следующие — уже нет.
 */
export async function startConversation(db: Db, lead: Lead, expertId: number, now: Date): Promise<StartResult> {
  const withExpert = async () =>
    (
      await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.leadId, lead.id), eq(conversations.expertId, expertId)))
    )[0];
  const existing = await withExpert();
  if (existing) return { ok: true, conversation: existing };

  const expert = await getExpert(db, expertId);
  if (!expert || !expert.active || expert.deletedAt) return { ok: false, error: "Эксперт не найден" };
  const first = !(await conversationForLead(db, lead.id));
  if (first && !isOnline(expert, now)) return { ok: false, error: "Этот эксперт сейчас не в сети — выберите другого" };

  const [created] = await db
    .insert(conversations)
    .values({ leadId: lead.id, expertId: expert.id, ...(first ? {} : { fullTextSentAt: now }) })
    .onConflictDoNothing()
    .returning();
  // Двойной клик: чат уже создан параллельным запросом
  if (!created) {
    const again = await withExpert();
    return again ? { ok: true, conversation: again } : { ok: false, error: "Не удалось открыть чат" };
  }
  // Первый чат начинается с вопроса клиента о его разборе — эксперт видит, с чего начать
  if (first) {
    const { "chat.first_message": body } = await getTexts(db, ["chat.first_message"]);
    if (body.trim() !== "") {
      await db.insert(messages).values({ conversationId: created.id, author: "client", body: body.trim(), createdAt: now });
      await db.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, created.id));
    }
  }
  return { ok: true, conversation: created };
}

/** Текст 2 ещё не пришёл, но придёт в ближайшие FULL_TEXT_TYPING_MS — показываем «печатает…». */
export function fullTextTyping(c: Pick<Conversation, "createdAt" | "fullTextSentAt">, now: Date): boolean {
  if (c.fullTextSentAt) return false;
  return now.getTime() >= c.createdAt.getTime() + FULL_TEXT_DELAY_MS - FULL_TEXT_TYPING_MS;
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
      void notifyClient(db, c.id, { kind: "fullText" });
    }
  }
}

export type PostInput = { author: MessageAuthor; body?: string; expertId?: number; photo?: Buffer };
export type PostResult = { ok: true; id: number } | { ok: false; error: string };

export async function postMessage(db: Db, conversationId: string, input: PostInput): Promise<PostResult> {
  const body = (input.body ?? "").replace(/\r\n/g, "\n").trim();
  const photo = input.photo;
  if (photo === undefined && body === "") return { ok: false, error: "Пустое сообщение" };
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
      })
      .returning({ id: messages.id });
    const messageId = (m as { id: number }).id;
    if (photo !== undefined && photoMime) {
      await tx.insert(messagePhotos).values({ messageId, mime: photoMime, data: photo });
    }
    await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
    return messageId;
  });
  // Клиенту из Telegram-бота — уведомление об ответе (не ждём: чат не должен тормозить из-за Telegram)
  if (input.author === "expert" || input.author === "admin") {
    void notifyClient(db, conversationId, { kind: "message", expertId: input.expertId ?? null, body });
  }
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
}

/**
 * Сообщения чата после afterId. viewer: client — человек («Вы» вместо его имени, сообщения админа —
 * от эксперта чата); staff — эксперты и админ (видят имя человека и подпись админа).
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
  const chatExpert = viewer === "client" ? await getExpert(db, conversation.expertId) : null;

  const out: MessageView[] = [];
  for (const { m, expertName, photoId } of rows) {
    // Для клиента сообщение админа неотличимо от сообщения эксперта чата
    const asExpert = viewer === "client" && m.author === "admin";
    const author = asExpert ? "expert" : m.author;
    const expertId = asExpert ? conversation.expertId : m.expertId;
    const authorName =
      author === "client"
        ? clientName
        : author === "expert"
          ? ((asExpert ? chatExpert?.name : expertName) ?? "Эксперт")
          : author === "admin"
            ? t["chat.admin_name"]
            : t["chat.system_name"];
    const view: MessageView = {
      id: m.id,
      author,
      authorName,
      expertId,
      avatar: author === "expert" && expertId !== null ? (avatars.get(expertId) ?? null) : null,
      // Продукты убраны с сайта; старые предложения продукта в переписке — пометкой
      body: m.productId !== null && m.body === "" ? "Предложение продукта (больше не действует)" : m.body,
      createdAt: m.createdAt.toISOString(),
    };
    if (photoId !== null) view.photo = `/api/chat/${conversation.leadId}/photo/${m.id}`;
    out.push(view);
  }
  return out;
}

/** Сотрудники прочитали чат: его открыл эксперт этого чата или админ. */
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
  /** Сообщений клиента, которые ещё не читали ни эксперт этого чата, ни админ. */
  unread: number;
  /** Клиент попросил позвонить, а звонка ещё не было. */
  callRequested: boolean;
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
    callRequested: r.c.callRequestedAt !== null,
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
