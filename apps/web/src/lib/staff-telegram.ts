/**
 * Telegram сотрудников: уведомления о новых сообщениях клиентов и ответ клиенту прямо из Telegram.
 *
 * Привязка. Сотрудник (админ, эксперт или оператор) в своей панели жмёт «Подключить Telegram» — сайт
 * создаёт одноразовый код (живёт STAFF_LINK_MS, в базе — только хеш) и ссылку t.me/<бот>?start=st_<код>.
 * Бот по коду привязывает аккаунт Telegram к этому сотруднику и сразу гасит код: перехваченная или старая
 * ссылка не сработает. Отвязать — в панели или /stop в боте.
 *
 * Уведомления. Клиент написал — уведомление получают: эксперт этого чата, все операторы и админ (у кого
 * привязан Telegram). Выключенным, удалённым и экспертам из архива — нет. Если чат прямо сейчас открыт
 * у сотрудника на сайте — не дублируем.
 *
 * Ответ. Ответ (свайп «Ответить») на уведомление уходит клиенту в этот чат от имени сотрудника: эксперт —
 * как эксперт, оператор — как «Оператор: имя» (клиент видит эксперта чата), админ — как админ. Права
 * проверяются в момент ответа.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, experts, leads, messagePhotos, messages, operators, staffNotices, staffTelegram } from "@/db/schema";
import { splitExpertName } from "./bot-card";
import { em } from "./bot-emoji";
import { type IncomingMessage, type InboxResult, downloadPhoto } from "./bot-inbox";
import { markExpertRead, postMessage } from "./chat";
import { type TelegramConfig, botCall, esc, keyboard, sentId, telegramConfig } from "./telegram";

export type StaffKind = "admin" | "expert" | "operator";
export interface StaffRef {
  kind: StaffKind;
  /** id эксперта или оператора; у админа — 0. */
  staffId: number;
}

export const STAFF_LINK_MS = 15 * 60 * 1000;
export const STAFF_START_PREFIX = "st_";
/** Сотрудник смотрел этот чат совсем недавно — уведомление не нужно. */
const STAFF_ACTIVE_MS = 10_000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Одноразовый код привязки (24 символа: буквы, цифры, - и _ — Telegram пропускает такие в start). */
export async function createStaffLinkToken(db: Db, ref: StaffRef, now: Date): Promise<string> {
  const token = randomBytes(18).toString("base64url");
  const values = { tokenHash: hashToken(token), tokenExpiresAt: new Date(now.getTime() + STAFF_LINK_MS) };
  await db
    .insert(staffTelegram)
    .values({ kind: ref.kind, staffId: ref.staffId, ...values })
    .onConflictDoUpdate({ target: [staffTelegram.kind, staffTelegram.staffId], set: values });
  return token;
}

/** Сотрудник ещё работает: не выключен, не удалён, эксперт не в архиве. */
async function staffActive(db: Db, ref: StaffRef): Promise<boolean> {
  if (ref.kind === "admin") return true;
  if (ref.kind === "expert") {
    const [e] = await db.select({ active: experts.active, archivedAt: experts.archivedAt, deletedAt: experts.deletedAt }).from(experts).where(eq(experts.id, ref.staffId));
    return !!e && e.active && !e.archivedAt && !e.deletedAt;
  }
  const [o] = await db.select({ active: operators.active, deletedAt: operators.deletedAt }).from(operators).where(eq(operators.id, ref.staffId));
  return !!o && o.active && !o.deletedAt;
}

async function staffName(db: Db, ref: StaffRef): Promise<string> {
  if (ref.kind === "admin") return "администратор";
  if (ref.kind === "expert") {
    const [e] = await db.select({ name: experts.name }).from(experts).where(eq(experts.id, ref.staffId));
    return `эксперт ${splitExpertName(e?.name ?? "").name}`;
  }
  const [o] = await db.select({ name: operators.name }).from(operators).where(eq(operators.id, ref.staffId));
  return `оператор ${o?.name ?? ""}`.trim();
}

/** /start st_<код>: привязать Telegram к сотруднику. Возвращает ответ бота (HTML) или null — код не наш. */
export async function consumeStaffLink(
  db: Db,
  code: string,
  tg: { id: number; name: string },
  now: Date,
): Promise<string | null> {
  if (!code.startsWith(STAFF_START_PREFIX)) return null;
  const token = code.slice(STAFF_START_PREFIX.length);
  if (!/^[\w-]{20,40}$/.test(token)) return "Ссылка не подошла — создайте новую в панели на сайте.";
  const [row] = await db.select().from(staffTelegram).where(eq(staffTelegram.tokenHash, hashToken(token)));
  if (!row || !row.tokenExpiresAt || row.tokenExpiresAt.getTime() < now.getTime()) {
    return "Ссылка устарела или уже использована — создайте новую в панели на сайте.";
  }
  const ref = { kind: row.kind, staffId: row.staffId };
  if (!(await staffActive(db, ref))) return "Этот сотрудник выключен — подключить Telegram нельзя.";
  // Код одноразовый: гасим в том же UPDATE, где привязываем
  const [linked] = await db
    .update(staffTelegram)
    .set({ telegramUserId: tg.id, telegramName: tg.name.slice(0, 64), linkedAt: now, tokenHash: null, tokenExpiresAt: null })
    .where(and(eq(staffTelegram.id, row.id), eq(staffTelegram.tokenHash, hashToken(token))))
    .returning({ id: staffTelegram.id });
  if (!linked) return "Ссылка уже использована — создайте новую в панели на сайте.";
  return (
    `${em("check")}<b>Telegram подключён</b> — ${esc(await staffName(db, ref))}.\n\n` +
    "Сюда будут приходить новые сообщения клиентов. Чтобы ответить клиенту, ответьте на уведомление (свайп влево) — " +
    "ответ уйдёт в чат на сайте. Отключить — в панели на сайте или /stop."
  );
}

export interface StaffTelegramStatus {
  connected: boolean;
  name: string;
}

export async function staffTelegramStatus(db: Db, ref: StaffRef): Promise<StaffTelegramStatus> {
  const [row] = await db
    .select({ tg: staffTelegram.telegramUserId, name: staffTelegram.telegramName })
    .from(staffTelegram)
    .where(and(eq(staffTelegram.kind, ref.kind), eq(staffTelegram.staffId, ref.staffId)));
  return { connected: !!row?.tg, name: row?.name ?? "" };
}

export async function unlinkStaff(db: Db, ref: StaffRef): Promise<void> {
  await db
    .update(staffTelegram)
    .set({ telegramUserId: null, telegramName: "", linkedAt: null, tokenHash: null, tokenExpiresAt: null })
    .where(and(eq(staffTelegram.kind, ref.kind), eq(staffTelegram.staffId, ref.staffId)));
}

/** /stop в боте: отвязать этот Telegram от всех сотрудников. */
export async function unlinkStaffTelegramUser(db: Db, telegramUserId: number): Promise<number> {
  const rows = await db
    .update(staffTelegram)
    .set({ telegramUserId: null, telegramName: "", linkedAt: null })
    .where(eq(staffTelegram.telegramUserId, telegramUserId))
    .returning({ id: staffTelegram.id });
  return rows.length;
}

const chatPath = (kind: StaffKind, conversationId: string) =>
  kind === "admin" ? `/admin/chats/${conversationId}` : kind === "expert" ? `/expert/chat/${conversationId}` : `/operator/chat/${conversationId}`;

/** Порядок, если один Telegram привязан к нескольким ролям: от чьего имени он ответит. */
const KIND_ORDER: Record<StaffKind, number> = { expert: 0, operator: 1, admin: 2 };

/** Клиент написал — уведомить сотрудников в Telegram. Ошибки не мешают чату. */
export async function notifyStaff(db: Db, conversationId: string, messageId: number, now = new Date()): Promise<void> {
  const cfg = telegramConfig();
  if (!cfg) return;
  try {
    const [row] = await db
      .select({ body: messages.body, leadName: leads.name, expertId: conversations.expertId, expertName: experts.name, expertReadAt: conversations.expertReadAt })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .innerJoin(experts, eq(experts.id, conversations.expertId))
      .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)));
    if (!row) return;
    // Чат открыт у сотрудника на сайте — он и так видит сообщение
    if (row.expertReadAt && now.getTime() - row.expertReadAt.getTime() < STAFF_ACTIVE_MS) return;
    const [photo] = await db.select({ id: messagePhotos.messageId }).from(messagePhotos).where(eq(messagePhotos.messageId, messageId));

    const links = await db
      .select()
      .from(staffTelegram)
      .where(
        and(
          isNotNull(staffTelegram.telegramUserId),
          or(inArray(staffTelegram.kind, ["admin", "operator"]), and(eq(staffTelegram.kind, "expert"), eq(staffTelegram.staffId, row.expertId))),
        ),
      );
    // Один Telegram — одно уведомление
    const byUser = new Map<number, (typeof links)[number]>();
    for (const l of links.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])) {
      if (l.telegramUserId && !byUser.has(l.telegramUserId) && (await staffActive(db, l))) byUser.set(l.telegramUserId, l);
    }
    const body = row.body.trim();
    const text =
      `${em("chat")}<b>${esc(row.leadName)}</b> → ${esc(splitExpertName(row.expertName).name)}\n` +
      `${body ? esc(body.length > 3000 ? `${body.slice(0, 3000)}…` : body) : ""}${photo ? `${body ? "\n" : ""}<i>[фото]</i>` : ""}\n\n` +
      "<i>Ответьте на это сообщение — ответ уйдёт клиенту.</i>";
    for (const [chatId, link] of byUser) {
      const id = sentId(
        await botCall(cfg.token, "sendMessage", {
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...keyboard([{ text: "Открыть чат", url: `${cfg.siteUrl}${chatPath(link.kind, conversationId)}`, icon: "chat" }]),
        }),
      );
      if (id !== null) await db.insert(staffNotices).values({ chatId, messageId: id, conversationId, staffLinkId: link.id }).onConflictDoNothing();
    }
  } catch (err) {
    console.warn(`Уведомление сотрудникам: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Ответ сотрудника на уведомление → клиенту в чат. handled: false — это не ответ на уведомление
 * (дальше разбирается как сообщение клиента или команда).
 */
export async function handleStaffReply(db: Db, cfg: TelegramConfig, msg: IncomingMessage, now = new Date()): Promise<InboxResult> {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const replyTo = msg.reply_to_message?.message_id;
  if (typeof chatId !== "number" || typeof userId !== "number" || typeof replyTo !== "number") return { handled: false };
  const [notice] = await db
    .select({ conversationId: staffNotices.conversationId, link: staffTelegram })
    .from(staffNotices)
    .innerJoin(staffTelegram, eq(staffTelegram.id, staffNotices.staffLinkId))
    .where(and(eq(staffNotices.chatId, chatId), eq(staffNotices.messageId, replyTo), eq(staffTelegram.telegramUserId, userId)));
  if (!notice) return { handled: false };
  const ref = { kind: notice.link.kind, staffId: notice.link.staffId };
  if (!(await staffActive(db, ref))) return { handled: true, reply: "Ваш доступ выключен — ответ не отправлен." };

  const text = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : "";
  const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
  if (!hasPhoto && text.trim() === "") return { handled: true, reply: "Клиенту можно отправить текст или фото." };
  const photo = hasPhoto ? await downloadPhoto(cfg, msg.photo) : null;
  if (hasPhoto && !photo) return { handled: true, reply: "Не получилось передать фото — отправьте его в чате на сайте." };

  const [c] = await db
    .select({ leadName: leads.name, archivedAt: experts.archivedAt })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .where(eq(conversations.id, notice.conversationId));
  if (!c) return { handled: true, reply: "Чат не найден — возможно, заявку удалили." };
  if (c.archivedAt) return { handled: true, reply: "Эксперт этого чата в архиве — клиент чат не видит." };

  const res = await postMessage(db, notice.conversationId, {
    ...(ref.kind === "expert"
      ? { author: "expert" as const, expertId: ref.staffId }
      : ref.kind === "operator"
        ? { author: "admin" as const, operatorId: ref.staffId }
        : { author: "admin" as const }),
    body: text,
    ...(photo && { photo }),
  });
  if (!res.ok) return { handled: true, reply: esc(res.error) };
  await markExpertRead(db, notice.conversationId, now);
  return { handled: true, reply: `${em("check")}Отправлено клиенту <b>${esc(c.leadName)}</b>.` };
}
