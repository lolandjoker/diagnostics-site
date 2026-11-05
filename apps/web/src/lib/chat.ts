/**
 * Чат человека с экспертом. Человек входит без регистрации: доступ к чату — по случайному id
 * его заявки в адресе. У заявки может быть несколько чатов — по одному с каждым экспертом: написать
 * можно любому, без заявок; «текущий» — с последним сообщением. Пишут: клиент, любой эксперт, админ.
 * Ответил другой эксперт — клиент видит его имя. Сообщения админа клиент видит от имени эксперта
 * чата (имя и фото); подпись «Администратор» видят только эксперты и админ.
 * К сообщению можно приложить фото (JPEG, PNG или WebP до MAX_CHAT_PHOTO_BYTES).
 */
import { and, asc, desc, eq, gt, isNull, lte, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, experts, leads, messagePhotos, messages, operators } from "@/db/schema";
import type { MessageAuthor } from "@/db/schema";
import { detectImageMime, expertPhotoUrls, expertStatus, getExpert, isOnline, listExperts } from "./experts";
import type { Lead } from "./leads";
import { notifyClient } from "./bot-delivery";
import { notifyStaff } from "./staff-telegram";
import { fillTemplate, getTexts } from "./texts";

export type Conversation = typeof conversations.$inferSelect;

export const MAX_MESSAGE_LENGTH = 4000;
export const CLIENT_MESSAGES_PER_MINUTE = 20;
/** Через сколько после начала чата эксперт «начинает печатать» приветствие. */
export const GREETING_TYPING_MS = 2_000;
/** Через сколько после начала чата приходит приветствие эксперта (chat.greeting). */
export const GREETING_DELAY_MS = 17_000;
/** Через сколько после начала чата в него приходит подробная диагностика эксперта: 3 минуты после приветствия. */
export const FULL_TEXT_DELAY_MS = GREETING_DELAY_MS + 3 * 60 * 1000;
/** Фото в чате. Браузер перед отправкой уменьшает снимок, так что обычно выходит меньше 1 МБ. */
export const MAX_CHAT_PHOTO_BYTES = 5 * 1024 * 1024;

/** Чаты с экспертами из архива клиент не видит — ни в списке, ни по ссылке. */
const visibleToClient = and(
  eq(experts.id, conversations.expertId),
  isNull(experts.archivedAt),
);

/**
 * Текущий чат заявки — где последнее сообщение (после перевода — чат с новым экспертом); null — чата нет.
 * Чаты с экспертами из архива не в счёт.
 */
export async function conversationForLead(db: Db, leadId: string): Promise<Conversation | null> {
  const [row] = await db
    .select({ c: conversations })
    .from(conversations)
    .innerJoin(experts, visibleToClient)
    .where(eq(conversations.leadId, leadId))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.createdAt))
    .limit(1);
  return row?.c ?? null;
}

/** Чат заявки по его id (только если он этой заявки) или текущий, если id не задан. */
export async function leadConversation(db: Db, leadId: string, conversationId?: string | null): Promise<Conversation | null> {
  if (!conversationId) return conversationForLead(db, leadId);
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return null;
  const [row] = await db
    .select({ c: conversations })
    .from(conversations)
    .innerJoin(experts, visibleToClient)
    .where(and(eq(conversations.id, conversationId), eq(conversations.leadId, leadId)));
  return row?.c ?? null;
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
    .innerJoin(experts, visibleToClient)
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

/** Эксперты, которых может выбрать человек: работают и не в архиве. */
export async function selectableExperts(db: Db, now: Date) {
  const all = (await listExperts(db)).filter((e) => e.active && !e.archivedAt);
  return all.map((e) => ({ ...e, isOnline: isOnline(e, now), status: expertStatus(e, now) }));
}

export type StartResult = { ok: true; conversation: Conversation } | { ok: false; error: string };

/**
 * Человек выбрал эксперта: открывается чат с ним (уже был — тот же). Писать можно любому эксперту,
 * у каждого свой чат в списке переписок. Первый чат — только с экспертом в сети. Сценарий чата, куда
 * придёт подробная диагностика: через 2 с эксперт «печатает…», через 17 с — его приветствие, снова
 * «печатает…», через FULL_TEXT_DELAY_MS — диагностика. Она одна на человека: получил в одном чате —
 * в других уже не придёт, и приветствия там нет (см. deliverDueFullTexts).
 * За клиента ничего не пишем: в пустом чате ему показываются подсказки-вопросы (chat.suggestions).
 */
export async function startConversation(db: Db, lead: Lead, expertId: number, now: Date): Promise<StartResult> {
  const withExpert = async () =>
    (
      await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.leadId, lead.id), eq(conversations.expertId, expertId)))
    )[0];
  const expert = await getExpert(db, expertId);
  // Эксперт в архиве: ни нового чата, ни старого — клиент его не видит
  if (!expert || expert.archivedAt) return { ok: false, error: "Эксперт не найден" };
  const existing = await withExpert();
  if (existing) return { ok: true, conversation: existing };
  if (!expert.active || expert.deletedAt) return { ok: false, error: "Эксперт не найден" };
  // Первый чат — первый вообще, считая скрытые чаты с экспертами из архива
  const [earlier] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.leadId, lead.id)).limit(1);
  const first = !earlier;
  if (first && !isOnline(expert, now)) return { ok: false, error: "Этот эксперт сейчас не в сети — выберите другого" };

  const [created] = await db
    .insert(conversations)
    .values({ leadId: lead.id, expertId: expert.id })
    .onConflictDoNothing()
    .returning();
  // Двойной клик: чат уже создан параллельным запросом
  if (!created) {
    const again = await withExpert();
    return again ? { ok: true, conversation: again } : { ok: false, error: "Не удалось открыть чат" };
  }
  return { ok: true, conversation: created };
}

/** Человек уже получил подробную диагностику — в любом своём чате (сообщение «Подробный разбор»). */
export async function leadGotFullText(db: Db, leadId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(conversations.leadId, leadId), eq(messages.author, "system")))
    .limit(1);
  return !!row;
}

/**
 * Чат, в который придёт подробная диагностика человека: самый ранний из ждущих её чатов с экспертом,
 * у которого она заполнена (так же выбирает deliverDueFullTexts). null — не придёт ни в один.
 */
async function fullTextTarget(db: Db, leadId: string): Promise<string | null> {
  if (await leadGotFullText(db, leadId)) return null;
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .where(and(eq(conversations.leadId, leadId), isNull(conversations.fullTextSentAt), ne(experts.fullText, "")))
    .orderBy(asc(conversations.createdAt), asc(conversations.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * «Печатает…» всё время, пока идёт отсчёт до подробной диагностики: через GREETING_TYPING_MS после начала
 * чата и до её отправки (приветствие приходит посередине). Только в том чате, куда она придёт:
 * одна диагностика на человека (fullTextTarget).
 */
export async function fullTextTyping(
  db: Db,
  c: Pick<Conversation, "id" | "leadId" | "createdAt" | "fullTextSentAt">,
  now: Date,
): Promise<boolean> {
  if (c.fullTextSentAt || now.getTime() < c.createdAt.getTime() + GREETING_TYPING_MS) return false;
  return (await fullTextTarget(db, c.leadId)) === c.id;
}

/**
 * Приветствие эксперта (chat.greeting) через GREETING_DELAY_MS — в чат, куда придёт подробная диагностика.
 * Каждый чат отмечается одним UPDATE — два опроса не отправят приветствие дважды.
 */
async function deliverDueGreetings(db: Db, now: Date, leadId: string | undefined): Promise<void> {
  const due = await db
    .update(conversations)
    .set({ greetingSentAt: now })
    .where(
      and(
        isNull(conversations.greetingSentAt),
        lte(conversations.createdAt, new Date(now.getTime() - GREETING_DELAY_MS)),
        leadId === undefined ? undefined : eq(conversations.leadId, leadId),
      ),
    )
    .returning({ id: conversations.id, leadId: conversations.leadId, expertId: conversations.expertId });
  if (due.length === 0) return;
  const greeting = (await getTexts(db, ["chat.greeting"]))["chat.greeting"].trim();
  if (!greeting) return;
  for (const c of due) {
    if ((await fullTextTarget(db, c.leadId)) !== c.id) continue;
    const [lead] = await db.select({ name: leads.name }).from(leads).where(eq(leads.id, c.leadId));
    if (!lead) continue;
    await postMessage(db, c.id, { author: "expert", expertId: c.expertId, automatic: true, body: fillTemplate(greeting, { name: lead.name }) });
  }
}

/**
 * Сначала приветствия, которым пора (deliverDueGreetings). Потом
 * отправляет подробную диагностику эксперта в его чаты, которым уже FULL_TEXT_DELAY_MS, — сообщением с подписью
 * «Подробный разбор», а не от имени эксперта. Вызывается при каждом опросе чата и списка чатов,
 * поэтому сообщение появляется вовремя без фоновых задач. Каждый чат отмечается одним UPDATE —
 * два одновременных опроса не отправят текст дважды. Диагностика одна на человека: приходит в самый ранний
 * чат с экспертом, у которого она заполнена, в остальные — нет. conversationId — проверить только чаты
 * этого человека (все сразу: иначе, сидя в другом чате, он получил бы её не туда).
 */
export async function deliverDueFullTexts(db: Db, now: Date, conversationId?: string): Promise<void> {
  let leadId: string | undefined;
  if (conversationId !== undefined) {
    const [c] = await db.select({ leadId: conversations.leadId }).from(conversations).where(eq(conversations.id, conversationId));
    if (!c) return;
    leadId = c.leadId;
  }
  await deliverDueGreetings(db, now, leadId);
  const due = await db
    .update(conversations)
    .set({ fullTextSentAt: now })
    .where(
      and(
        isNull(conversations.fullTextSentAt),
        lte(conversations.createdAt, new Date(now.getTime() - FULL_TEXT_DELAY_MS)),
        leadId === undefined ? undefined : eq(conversations.leadId, leadId),
      ),
    )
    .returning({
      id: conversations.id,
      leadId: conversations.leadId,
      expertId: conversations.expertId,
      createdAt: conversations.createdAt,
    });

  // Созрели сразу несколько чатов одного человека — диагностика уходит в тот, что открыт раньше
  due.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime() || x.id.localeCompare(y.id));
  for (const c of due) {
    const [lead] = await db.select({ name: leads.name }).from(leads).where(eq(leads.id, c.leadId));
    const [expert] = await db.select({ fullText: experts.fullText }).from(experts).where(eq(experts.id, c.expertId));
    // Одна диагностика на человека: уже получил в другом чате — в этот не отправляем
    if (lead && expert?.fullText && !(await leadGotFullText(db, c.leadId))) {
      const sent = await postMessage(db, c.id, { author: "system", body: fillTemplate(expert.fullText, { name: lead.name }) });
      if (sent.ok) void notifyClient(db, c.id, { kind: "fullText", messageId: sent.id });
    }
  }
}

/** operatorId — для author = admin: написал оператор чатов (подпись у сотрудников — его имя). */
/** automatic — сообщение отправил сайт от имени эксперта (приветствие); viaTelegram — клиент ответил из бота. */
export type PostInput = {
  author: MessageAuthor;
  body?: string;
  expertId?: number;
  operatorId?: number;
  photo?: Buffer;
  automatic?: boolean;
  viaTelegram?: boolean;
};
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
        operatorId: input.author === "admin" ? (input.operatorId ?? null) : null,
        automatic: input.automatic ?? false,
        viaTelegram: input.author === "client" && input.viaTelegram === true,
      })
      .returning({ id: messages.id });
    const messageId = (m as { id: number }).id;
    if (photo !== undefined && photoMime) {
      await tx.insert(messagePhotos).values({ messageId, mime: photoMime, data: photo });
    }
    await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
    return messageId;
  });
  // Клиенту из Telegram-бота — ответ эксперта в бот (не ждём: чат не должен тормозить из-за Telegram)
  if (input.author === "expert" || input.author === "admin") {
    void notifyClient(db, conversationId, { kind: "message", messageId: id });
  }
  // Сотрудникам с привязанным Telegram — новое сообщение клиента
  if (input.author === "client") void notifyStaff(db, conversationId, id);
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
  /** Сотрудникам: сообщение админа написал оператор чатов — какой (у клиента всегда null). */
  operatorId: number | null;
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
    .select({ m: messages, expertName: experts.name, operatorName: operators.name, photoId: messagePhotos.messageId })
    .from(messages)
    .leftJoin(experts, eq(experts.id, messages.expertId))
    .leftJoin(operators, eq(operators.id, messages.operatorId))
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
  for (const { m, expertName, operatorName, photoId } of rows) {
    // Для клиента сообщение админа неотличимо от сообщения эксперта чата
    const asExpert = viewer === "client" && m.author === "admin";
    const author = asExpert ? "expert" : m.author;
    const expertId = asExpert ? conversation.expertId : m.expertId;
    const authorName =
      author === "client"
        ? clientName + (viewer === "staff" && m.viaTelegram ? " · из Telegram" : "")
        : author === "expert"
          ? ((asExpert ? chatExpert?.name : expertName) ?? "Эксперт") +
            // Сотрудники видят, что это приветствие сайта, а не эксперт сам написал
            (viewer === "staff" && m.automatic ? " · автоприветствие" : "")
          : author === "admin"
            ? operatorName
              ? `Оператор: ${operatorName}`
              : t["chat.admin_name"]
            : t["chat.system_name"];
    const view: MessageView = {
      id: m.id,
      author,
      authorName,
      expertId,
      avatar: author === "expert" && expertId !== null ? (avatars.get(expertId) ?? null) : null,
      operatorId: viewer === "staff" ? m.operatorId : null,
      // Продукты убраны с сайта; старые предложения продукта в переписке — пометкой
      body: m.productId !== null && m.body === "" ? "Предложение продукта (больше не действует)" : m.body,
      createdAt: m.createdAt.toISOString(),
    };
    if (photoId !== null) view.photo = `/api/chat/${conversation.leadId}/photo/${m.id}`;
    out.push(view);
  }
  return out;
}

/** Сотрудники прочитали чат: его открыл эксперт этого чата, админ или оператор чатов. */
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
    .select({
      leadName: leads.name,
      birthDate: leads.birthDate,
      expertName: experts.name,
      expertArchived: sql<boolean>`${experts.archivedAt} is not null`.mapWith(Boolean),
    })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .where(eq(conversations.id, conversation.id));
  return row ?? null;
}
