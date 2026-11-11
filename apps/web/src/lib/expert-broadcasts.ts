/**
 * Рассылка от экспертов — массовое сообщение, которое каждый получает в свой чат с экспертом: на сайте оно
 * стоит в переписке от имени эксперта этого чата, а клиентам с Telegram приходит в бот обычной доставкой чата
 * (плашка эксперта, «Ответить на сайте», ответ из бота возвращается в тот же чат). Это не системная рассылка
 * бота (lib/broadcasts.ts: подарки, квизы, /stop) — здесь пишет эксперт.
 *
 * - Кому: те же «Кому» и условия по часам, что у системной рассылки (подключившие Telegram), плюс фильтр
 *   «клиентам эксперта». Чат — самый свежий чат человека (с выбранным экспертом, если он задан); эксперт
 *   в архиве или удалён — такие чаты не берём.
 * - Серия до MAX_BROADCAST_MESSAGES сообщений; к каждому фото или видео. Файл хранится один раз (chat_media)
 *   и в Telegram грузится один раз — дальше по file_id. {имя} в тексте — имя человека из заявки.
 * - Сообщения помечены (messages.broadcast_id): сотрудники видят «рассылка». Они automatic — не считаются
 *   ответом эксперта: клиент, который ждал ответа, остаётся в «Без ответа».
 * - Отправка в фоне, по одному человеку: Telegram получает не больше BROADCAST_PER_SECOND сообщений в секунду.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { broadcasts, chatMedia, conversations, experts, leads } from "@/db/schema";
import { notifyClient } from "./bot-delivery";
import {
  type Audience,
  BROADCAST_PER_SECOND,
  type BroadcastFilters,
  type BroadcastMessage,
  SERIES_GAP_MS,
  broadcastRecipients,
  partsRecord,
} from "./broadcasts";
import { postMessage } from "./chat";

export interface ExpertBroadcastInput {
  audience: Audience;
  filters?: BroadcastFilters;
  /** Только клиентам этого эксперта; не задан — всем, каждому от эксперта его чата. */
  expertId?: number | undefined;
  messages: BroadcastMessage[];
}

export interface ChatTarget {
  telegramUserId: number;
  conversationId: string;
  expertId: number;
  name: string;
}

/** Самый свежий чат каждого человека (с этим экспертом, если задан) — у эксперта не в архиве и не удалённого. */
export async function chatTargets(db: Db, telegramUserIds: number[], expertId?: number): Promise<ChatTarget[]> {
  const best = new Map<number, ChatTarget & { at: number }>();
  for (let i = 0; i < telegramUserIds.length; i += 500) {
    const part = telegramUserIds.slice(i, i + 500);
    const rows = await db
      .select({
        tg: leads.telegramUserId,
        name: leads.name,
        conversationId: conversations.id,
        expertId: conversations.expertId,
        at: conversations.lastMessageAt,
      })
      .from(conversations)
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .innerJoin(experts, eq(experts.id, conversations.expertId))
      .where(
        and(
          inArray(leads.telegramUserId, part),
          isNull(experts.archivedAt),
          isNull(experts.deletedAt),
          expertId !== undefined ? eq(conversations.expertId, expertId) : undefined,
        ),
      );
    for (const r of rows) {
      if (r.tg === null) continue;
      const prev = best.get(r.tg);
      if (!prev || r.at.getTime() > prev.at) {
        best.set(r.tg, { telegramUserId: r.tg, name: r.name, conversationId: r.conversationId, expertId: r.expertId, at: r.at.getTime() });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.telegramUserId - b.telegramUserId).map(({ at: _at, ...t }) => t);
}

/** Кому уйдёт рассылка: «Кому» и условия, затем — у кого есть подходящий чат. */
export async function expertBroadcastTargets(db: Db, input: Omit<ExpertBroadcastInput, "messages">, now = new Date()): Promise<ChatTarget[]> {
  const people = await broadcastRecipients(db, input.audience, input.filters, now);
  return chatTargets(db, people, input.expertId);
}

/** {имя} в тексте — первое слово имени из заявки. */
export const withName = (body: string, name: string) => body.replace(/\{имя\}/gi, name.trim().split(/\s+/)[0] ?? "");

/** Файлы серии — в общее хранилище, по одному разу. */
async function storeMedia(db: Db, list: BroadcastMessage[]): Promise<(string | undefined)[]> {
  const ids: (string | undefined)[] = [];
  for (const m of list) {
    if (!m.media) {
      ids.push(undefined);
      continue;
    }
    const [row] = await db
      .insert(chatMedia)
      .values({ kind: m.media.kind, mime: m.media.type, name: m.media.name, size: m.media.data.length, data: m.media.data })
      .returning({ id: chatMedia.id });
    ids.push(row!.id);
  }
  return ids;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Серия в один чат: сообщения от эксперта чата, каждое — в Telegram по очереди. Всё записалось — true. */
async function sendToChat(db: Db, t: ChatTarget, list: BroadcastMessage[], mediaIds: (string | undefined)[], broadcastId: number | null) {
  for (const [i, m] of list.entries()) {
    const res = await postMessage(db, t.conversationId, {
      author: "expert",
      expertId: t.expertId,
      body: withName(m.body, t.name),
      automatic: true,
      quiet: true,
      ...(mediaIds[i] && { mediaId: mediaIds[i] }),
      ...(broadcastId !== null && { broadcastId }),
    });
    if (!res.ok) return false;
    // Ждём доставку в Telegram: следующее сообщение — только после него (порядок и лимиты Telegram)
    await notifyClient(db, t.conversationId, { kind: "message", messageId: res.id });
    if (i < list.length - 1) await sleep(SERIES_GAP_MS);
  }
  return true;
}

/**
 * Проба: вся серия в свежий чат этого Telegram ID (с выбранным экспертом, если задан). Сообщения настоящие —
 * останутся в том чате (их можно удалить в чате), в историю рассылок не попадают.
 */
export async function testExpertBroadcast(db: Db, telegramUserId: number, input: ExpertBroadcastInput): Promise<"ok" | "no-chat" | "failed"> {
  const [target] = await chatTargets(db, [telegramUserId], input.expertId);
  if (!target) return "no-chat";
  return (await sendToChat(db, target, input.messages, await storeMedia(db, input.messages), null)) ? "ok" : "failed";
}

/** Начать: запись в истории сразу, отправка — в фоне. */
export async function startExpertBroadcast(db: Db, input: ExpertBroadcastInput, now = new Date()): Promise<{ id: number; total: number }> {
  const targets = await expertBroadcastTargets(db, input, now);
  const record = { body: "", buttonText: "", buttonUrl: "", gift: false, messages: input.messages };
  const [row] = await db
    .insert(broadcasts)
    .values({
      kind: "chat",
      body: input.messages.find((m) => m.body.trim())?.body.trim() ?? "",
      parts: partsRecord(record),
      audience: input.audience,
      expertId: input.expertId ?? null,
      registeredHours: input.filters?.registeredHours ?? null,
      silentHours: input.filters?.silentHours ?? null,
      total: targets.length,
    })
    .returning({ id: broadcasts.id });
  const id = row!.id;
  const mediaIds = await storeMedia(db, input.messages);
  void runExpertBroadcast(db, id, targets, input.messages, mediaIds);
  return { id, total: targets.length };
}

export async function runExpertBroadcast(
  db: Db,
  id: number,
  targets: ChatTarget[],
  list: BroadcastMessage[],
  mediaIds: (string | undefined)[],
): Promise<void> {
  let sent = 0;
  let failed = 0;
  const save = (finished: boolean) =>
    db
      .update(broadcasts)
      .set({ sent, failed, ...(finished && { finishedAt: new Date() }) })
      .where(sql`${broadcasts.id} = ${id}`);
  try {
    for (const [i, t] of targets.entries()) {
      if (await sendToChat(db, t, list, mediaIds, id)) sent++;
      else failed++;
      if ((i + 1) % 10 === 0) await save(false);
      await sleep(1000 / BROADCAST_PER_SECOND);
    }
  } catch (err) {
    console.warn(`Рассылка от экспертов ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
  await save(true);
}
