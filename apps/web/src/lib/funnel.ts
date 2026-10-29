/**
 * Воронка: до какого шага доходят люди и где отваливаются (Сводка в админке).
 * - Шаги до заявки (открыл главную, начал заполнять форму) — по анонимному id браузера, пишет страница.
 * - Шаги после — по заявкам: что-то пишет страница (увидел разбор, открыл экспертов), остальное
 *   берётся из данных (заявка, чат, сообщения, Telegram).
 * Заявки считаются когортой: созданные за период, и для них — до какого шага дошли.
 */
import { and, countDistinct, eq, gte, inArray, isNotNull, min, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, funnelEvents, leads, messages } from "@/db/schema";

/** Шаги, которые пишет страница; остальные шаги воронки — из данных. */
export const TRACKED_STEPS = ["home", "form_start", "result", "experts"] as const;
export type TrackedStep = (typeof TRACKED_STEPS)[number];

/** Шаги после заявки — у события должен быть id заявки. */
const LEAD_STEPS: readonly TrackedStep[] = ["result", "experts"];

export function isTrackedStep(s: string): s is TrackedStep {
  return (TRACKED_STEPS as readonly string[]).includes(s);
}

/** Записать шаг. Повтор того же шага тем же браузером (или той же заявкой) не считается. */
export async function trackStep(db: Db, visitorId: string, step: TrackedStep, leadId: string | null): Promise<void> {
  const forLead = LEAD_STEPS.includes(step);
  if (forLead && !leadId) return;
  await db
    .insert(funnelEvents)
    .values({ visitorId, step, leadId: forLead ? leadId : null })
    .onConflictDoNothing();
}

/**
 * С какого момента собираются данные воронки (первое событие); null — ещё ни одного.
 * Заявки до этого момента в воронку не берём: их посещений главной нет, проценты бы врали.
 */
export async function trackingSince(db: Db): Promise<Date | null> {
  const [row] = await db.select({ at: min(funnelEvents.createdAt) }).from(funnelEvents);
  return row?.at ?? null;
}

/** Начало воронки: начало периода, но не раньше начала сбора данных. */
export function funnelStart(period: Date | null, tracking: Date): Date {
  return period && period > tracking ? period : tracking;
}

export interface FunnelStep {
  key: string;
  label: string;
  hint: string;
  count: number;
}

/** Воронка с since (null — за всё время). */
export async function funnel(db: Db, since: Date | null): Promise<FunnelStep[]> {
  const inPeriod = since ? gte(leads.createdAt, since) : undefined;
  const visitors = (step: TrackedStep) =>
    db
      .select({ n: countDistinct(funnelEvents.visitorId) })
      .from(funnelEvents)
      .where(and(eq(funnelEvents.step, step), since ? gte(funnelEvents.createdAt, since) : undefined));
  const leadsWithEvent = (step: TrackedStep) =>
    db
      .select({ n: countDistinct(funnelEvents.leadId) })
      .from(funnelEvents)
      .innerJoin(leads, eq(leads.id, funnelEvents.leadId))
      .where(and(eq(funnelEvents.step, step), inPeriod));
  const leadsWithMessage = (authors: ("client" | "expert" | "admin")[]) =>
    db
      .select({ n: countDistinct(conversations.leadId) })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .where(and(inArray(messages.author, authors), inPeriod));

  const rows = await Promise.all([
    visitors("home"),
    visitors("form_start"),
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(leads).where(inPeriod),
    leadsWithEvent("result"),
    leadsWithEvent("experts"),
    db
      .select({ n: countDistinct(conversations.leadId) })
      .from(conversations)
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .where(inPeriod),
    leadsWithMessage(["client"]),
    leadsWithMessage(["expert", "admin"]),
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(leads)
      .where(and(isNotNull(leads.telegramUserId), inPeriod)),
  ]);
  const n = (i: number) => Number(rows[i]?.[0]?.n ?? 0);
  return [
    { key: "home", label: "Открыли главную", hint: "уникальные браузеры", count: n(0) },
    { key: "form_start", label: "Начали заполнять форму", hint: "нажали на поле имени или даты", count: n(1) },
    { key: "lead", label: "Отправили форму", hint: "заявки", count: n(2) },
    { key: "result", label: "Дождались разбора", hint: "досмотрели загрузку", count: n(3) },
    { key: "experts", label: "Открыли список экспертов", hint: "нажали «Написать эксперту»", count: n(4) },
    { key: "chat", label: "Начали чат", hint: "выбрали эксперта", count: n(5) },
    { key: "wrote", label: "Написали эксперту", hint: "хотя бы одно сообщение", count: n(6) },
    { key: "replied", label: "Получили ответ", hint: "эксперт или админ ответили", count: n(7) },
    { key: "telegram", label: "Подключили Telegram", hint: "уведомления в боте", count: n(8) },
  ];
}

export type FunnelPeriod = "today" | "week" | "month" | "all";

export const FUNNEL_PERIODS: { key: FunnelPeriod; label: string }[] = [
  { key: "today", label: "Сегодня" },
  { key: "week", label: "7 дней" },
  { key: "month", label: "30 дней" },
  { key: "all", label: "Всё время" },
];

/** Начало периода; «сегодня» — с полуночи по Москве. */
export function periodStart(period: FunnelPeriod, now: Date): Date | null {
  const DAY = 86_400_000;
  if (period === "all") return null;
  if (period === "week") return new Date(now.getTime() - 7 * DAY);
  if (period === "month") return new Date(now.getTime() - 30 * DAY);
  const MSK = 3 * 3_600_000;
  return new Date(Math.floor((now.getTime() + MSK) / DAY) * DAY - MSK);
}
