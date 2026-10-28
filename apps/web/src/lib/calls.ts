/**
 * Голосовые звонки в чате — через интернет в браузере (WebRTC), без сотовой связи.
 * Звонит эксперт или админ; клиент может только попросить звонок. Звонок админа клиент видит
 * от эксперта чата — как и его сообщения.
 *
 * Сервер звук не передаёт: через опрос он только пересылает «рукопожатие» браузеров
 * (offer от сотрудника, answer от клиента). Звук идёт напрямую между браузерами, а если напрямую
 * нельзя (мобильный интернет, офисные сети) — через TURN-сервер coturn (сервис turn в docker-compose).
 * Доступ к TURN — временный пароль на каждый звонок (iceServers), общий секрет — TURN_SECRET.
 *
 * Итог звонка пишется в чат сообщением от того, кто звонил: «Звонок · 3:12», «Пропущенный звонок».
 */
import { createHmac } from "node:crypto";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { callSignals, calls, conversations } from "@/db/schema";
import type { CallStatus } from "@/db/schema";
import { postMessage } from "./chat";
import type { Conversation } from "./chat";
import { notifyClient } from "./telegram";

export type Call = typeof calls.$inferSelect;
export type CallSide = "client" | "staff";
export type CallCaller = { caller: "expert"; expertId: number } | { caller: "admin" };

/** Не ответили за это время — пропущенный звонок. */
export const RING_TIMEOUT_MS = 45_000;
/** Сторона не опрашивала звонок дольше (закрыла вкладку, пропала связь) — звонок завершается. */
export const SEEN_TIMEOUT_MS = 20_000;
/** Повторная просьба позвонить раньше этого срока не создаёт нового сообщения в чате. */
export const CALL_REQUEST_COOLDOWN_MS = 10 * 60_000;
export const MAX_SDP_LENGTH = 20_000;
/** Сколько действует временный пароль к TURN. */
const TURN_CREDENTIAL_TTL_S = 4 * 60 * 60;

const OPEN: CallStatus[] = ["ringing", "active"];
const isOpen = (c: Call) => OPEN.includes(c.status);

export interface CallView {
  id: string;
  status: CallStatus;
  answeredAt: string | null;
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface CallPoll {
  call: CallView | null;
  /** Сигналы другой стороны после after. */
  signals: { id: number; kind: "offer" | "answer"; sdp: string }[];
  /** Пока звонок открыт — адреса STUN/TURN с временным паролем. */
  iceServers: IceServer[];
  callRequested: boolean;
}

const view = (c: Call): CallView => ({ id: c.id, status: c.status, answeredAt: c.answeredAt?.toISOString() ?? null });

/**
 * STUN/TURN для браузера. Пароль — по схеме TURN REST API: username = «срок:метка»,
 * credential = HMAC-SHA1(TURN_SECRET, username) — coturn проверяет его тем же секретом.
 * Без TURN_SECRET (разработка) — пусто: звонок работает только в одной сети.
 */
export function iceServers(
  label: string,
  now: Date,
  env: Record<string, string | undefined> = process.env,
): IceServer[] {
  const secret = env.TURN_SECRET;
  const host = env.TURN_HOST ?? env.SITE_DOMAIN;
  if (!secret || !host) return [];
  const username = `${Math.floor(now.getTime() / 1000) + TURN_CREDENTIAL_TTL_S}:${label}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return [
    { urls: [`stun:${host}:3478`] },
    { urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`], username, credential },
  ];
}

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

async function getCall(db: Db, conversationId: string, callId: string): Promise<Call | null> {
  if (!/^[0-9a-f-]{36}$/i.test(callId)) return null;
  const [c] = await db
    .select()
    .from(calls)
    .where(and(eq(calls.id, callId), eq(calls.conversationId, conversationId)));
  return c ?? null;
}

async function openCall(db: Db, conversationId: string): Promise<Call | null> {
  const [c] = await db
    .select()
    .from(calls)
    .where(and(eq(calls.conversationId, conversationId), inArray(calls.status, OPEN)))
    .orderBy(desc(calls.createdAt))
    .limit(1);
  return c ?? null;
}

/**
 * Закрывает звонок, если он ещё открыт, и пишет итог в чат от того, кто звонил.
 * Закрытие — одним условным UPDATE: два одновременных запроса не напишут итог дважды.
 */
async function finish(db: Db, call: Call, status: "ended" | "missed" | "declined", now: Date): Promise<void> {
  const [done] = await db
    .update(calls)
    .set({ status, endedAt: now })
    .where(and(eq(calls.id, call.id), inArray(calls.status, OPEN)))
    .returning();
  if (!done) return;
  const body =
    status === "declined"
      ? "📞 Звонок отклонён"
      : done.answeredAt
        ? `📞 Звонок · ${duration(now.getTime() - done.answeredAt.getTime())}`
        : "📞 Пропущенный звонок";
  await postMessage(
    db,
    call.conversationId,
    done.caller === "expert" && done.expertId !== null
      ? { author: "expert", expertId: done.expertId, body }
      : { author: "admin", body },
  );
}

/** Просроченный звонок закрывается: не ответили вовремя или одна из сторон пропала. */
async function expire(db: Db, call: Call, now: Date): Promise<Call> {
  if (!isOpen(call)) return call;
  const gone = (t: Date | null) => t !== null && now.getTime() - t.getTime() > SEEN_TIMEOUT_MS;
  let to: "ended" | "missed" | null = null;
  if (call.status === "ringing" && (now.getTime() - call.createdAt.getTime() > RING_TIMEOUT_MS || gone(call.staffSeenAt))) {
    to = "missed";
  }
  if (call.status === "active" && (gone(call.clientSeenAt) || gone(call.staffSeenAt))) to = "ended";
  if (!to) return call;
  await finish(db, call, to, now);
  return (await getCall(db, call.conversationId, call.id)) ?? call;
}

/**
 * Опрос звонка. callId — следить за конкретным звонком (чтобы увидеть, что он закончился);
 * без него — открытый звонок чата, если есть. Отмечает, что сторона на связи.
 */
export async function pollCall(
  db: Db,
  conversation: Conversation,
  side: CallSide,
  opts: { callId?: string | null; after: number },
  now: Date,
): Promise<CallPoll> {
  let call = opts.callId ? await getCall(db, conversation.id, opts.callId) : await openCall(db, conversation.id);
  if (call) call = await expire(db, call, now);
  if (call && isOpen(call)) {
    await db
      .update(calls)
      .set(side === "client" ? { clientSeenAt: now } : { staffSeenAt: now })
      .where(eq(calls.id, call.id));
  }
  const signals = call
    ? await db
        .select({ id: callSignals.id, kind: callSignals.kind, sdp: callSignals.sdp })
        .from(callSignals)
        .where(
          and(
            eq(callSignals.callId, call.id),
            eq(callSignals.side, side === "client" ? "staff" : "client"),
            gt(callSignals.id, opts.after),
          ),
        )
        .orderBy(asc(callSignals.id))
    : [];
  const [fresh] = await db
    .select({ callRequestedAt: conversations.callRequestedAt })
    .from(conversations)
    .where(eq(conversations.id, conversation.id));
  return {
    call: call ? view(call) : null,
    signals,
    iceServers: call && isOpen(call) ? iceServers(call.id, now) : [],
    callRequested: (fresh?.callRequestedAt ?? null) !== null,
  };
}

export type CallResult = { ok: true; call: CallView } | { ok: false; error: string };

/** Эксперт или админ звонит клиенту. Просьба клиента о звонке при этом считается выполненной. */
export async function startCall(db: Db, conversation: Conversation, by: CallCaller, now: Date): Promise<CallResult> {
  const existing = await openCall(db, conversation.id);
  if (existing && isOpen(await expire(db, existing, now))) return { ok: false, error: "В этом чате уже идёт звонок" };
  const [created] = await db
    .insert(calls)
    .values({
      conversationId: conversation.id,
      caller: by.caller,
      expertId: by.caller === "expert" ? by.expertId : null,
      staffSeenAt: now,
      createdAt: now,
    })
    // Два сотрудника нажали одновременно — второй упрётся в уникальный индекс открытых звонков
    .onConflictDoNothing()
    .returning();
  if (!created) return { ok: false, error: "В этом чате уже идёт звонок" };
  await db.update(conversations).set({ callRequestedAt: null }).where(eq(conversations.id, conversation.id));
  // Клиенту из Telegram — «эксперт звонит» (не ждём: звонок не должен тормозить из-за Telegram)
  void notifyClient(db, conversation.id, { kind: "call", expertId: by.caller === "expert" ? by.expertId : null }, now);
  return { ok: true, call: view(created) };
}

/** Клиент принял или отклонил входящий звонок. */
export async function answerCall(
  db: Db,
  conversation: Conversation,
  callId: string,
  accept: boolean,
  now: Date,
): Promise<CallResult> {
  const found = await getCall(db, conversation.id, callId);
  const call = found && (await expire(db, found, now));
  if (!call || call.status !== "ringing") return { ok: false, error: "Звонок уже завершён" };
  if (!accept) {
    await finish(db, call, "declined", now);
  } else {
    const [active] = await db
      .update(calls)
      .set({ status: "active", answeredAt: now, clientSeenAt: now })
      .where(and(eq(calls.id, call.id), eq(calls.status, "ringing")))
      .returning();
    if (!active) return { ok: false, error: "Звонок уже завершён" };
  }
  const after = await getCall(db, conversation.id, callId);
  return after ? { ok: true, call: view(after) } : { ok: false, error: "Звонок не найден" };
}

/** Любая сторона положила трубку (или сотрудник отменил вызов, пока звонит). */
export async function hangupCall(db: Db, conversation: Conversation, callId: string, now: Date): Promise<void> {
  const call = await getCall(db, conversation.id, callId);
  if (call) await finish(db, call, "ended", now);
}

/** Сигнал браузера: сотрудник отправляет offer, клиент — answer. Только для открытого звонка. */
export async function addSignal(
  db: Db,
  conversation: Conversation,
  callId: string,
  side: CallSide,
  sdp: string,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  if (sdp === "" || sdp.length > MAX_SDP_LENGTH) return { ok: false, error: "Неверные данные соединения" };
  const call = await getCall(db, conversation.id, callId);
  if (!call || !isOpen(call)) return { ok: false, error: "Звонок уже завершён" };
  const [s] = await db
    .insert(callSignals)
    .values({ callId: call.id, side, kind: side === "staff" ? "offer" : "answer", sdp })
    .returning({ id: callSignals.id });
  return { ok: true, id: (s as { id: number }).id };
}

/** Клиент просит позвонить: отметка для сотрудников и сообщение в чат (не чаще раза в 10 минут). */
export async function requestCall(db: Db, conversation: Conversation, now: Date): Promise<{ ok: true } | { ok: false; error: string }> {
  const [fresh] = await db
    .select({ callRequestedAt: conversations.callRequestedAt })
    .from(conversations)
    .where(eq(conversations.id, conversation.id));
  const last = fresh?.callRequestedAt;
  if (last && now.getTime() - last.getTime() < CALL_REQUEST_COOLDOWN_MS) return { ok: true };
  const res = await postMessage(db, conversation.id, { author: "client", body: "📞 Прошу позвонить мне" });
  if (!res.ok) return res;
  await db.update(conversations).set({ callRequestedAt: now }).where(eq(conversations.id, conversation.id));
  return { ok: true };
}
