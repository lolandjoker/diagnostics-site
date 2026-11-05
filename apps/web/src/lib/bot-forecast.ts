/**
 * Личный прогноз на день в боте — повод возвращаться. Только по согласию: через 2 часа после подробного
 * разбора бот один раз предлагает подписаться (кнопки «Да» / «Нет»); /forecast — подписаться или отписаться.
 * Каждое утро после FORECAST_HOUR по Москве подписчик получает «личный день» по нумерологии (1–9, из даты
 * рождения последней заявки и сегодняшней даты) и текст этого дня из «Текстов сайта» → «Прогноз в боте».
 */
import { and, desc, eq, gt, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, leads, telegramUsers } from "@/db/schema";
import { em } from "./bot-emoji";
import { sendText } from "./bot-delivery";
import { type TelegramConfig, botApi, esc, ensureBotEmoji, telegramConfig } from "./telegram";
import { getTexts } from "./texts";

export const FORECAST_HOUR = 9;
export const FORECAST_ASK_AFTER_MS = 2 * 60 * 60 * 1000;
const FORECAST_ASK_UNTIL_MS = 3 * 24 * 60 * 60 * 1000;
const BATCH = 200;

const digits = (n: number) => String(n).split("").reduce((s, d) => s + Number(d), 0);
const reduce = (n: number) => {
  let x = n;
  while (x > 9) x = digits(x);
  return x;
};

/** Личный день: личный год (день + месяц рождения + год) → личный месяц (+ месяц) → день (+ число). */
export function personalDay(birthDate: string, today: string): number {
  const [, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const year = reduce(reduce(bd) + reduce(bm) + reduce(y));
  const month = reduce(year + m);
  return reduce(month + d);
}

const moscow = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });

/** Дата (ГГГГ-ММ-ДД) и час по Москве. */
export function moscowNow(now: Date): { date: string; hour: number } {
  const parts = Object.fromEntries(moscow.formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Последняя заявка человека в боте (имя и дата рождения для прогноза). */
async function latestLead(db: Db, telegramUserId: number) {
  const [lead] = await db
    .select({ name: leads.name, birthDate: leads.birthDate })
    .from(leads)
    .where(eq(leads.telegramUserId, telegramUserId))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return lead ?? null;
}

const DAY_KEYS = [
  "forecast.day1",
  "forecast.day2",
  "forecast.day3",
  "forecast.day4",
  "forecast.day5",
  "forecast.day6",
  "forecast.day7",
  "forecast.day8",
  "forecast.day9",
] as const;

/** Отправить прогноз на сегодня одному человеку. false — заявки нет (отвязан) или не ушло. */
export async function sendForecast(db: Db, cfg: TelegramConfig, telegramUserId: number, now: Date): Promise<boolean> {
  const lead = await latestLead(db, telegramUserId);
  if (!lead) return false;
  const day = personalDay(lead.birthDate, moscowNow(now).date);
  const t = await getTexts(db, DAY_KEYS);
  const text = t[DAY_KEYS[day - 1]!].trim();
  if (!text) return false;
  const id = await sendText(
    cfg,
    telegramUserId,
    `${em("moon")}<b>${esc(lead.name)}, ваш личный день — ${day}</b>\n\n${esc(text)}\n\n` +
      "<i>Хотите разобрать подробнее — напишите эксперту прямо сюда.</i>",
    [[
      { text: "Выбрать эксперта", callback: "exl", icon: "star" },
      { text: "Отписаться", callback: "fc:0" },
    ]],
  );
  return id !== null;
}

async function setForecast(db: Db, telegramUserId: number, on: boolean, extra: Partial<typeof telegramUsers.$inferInsert> = {}) {
  await db
    .insert(telegramUsers)
    .values({ telegramUserId, forecast: on, ...extra })
    .onConflictDoUpdate({ target: telegramUsers.telegramUserId, set: { forecast: on, ...extra } });
}

/** Предложить подписку тем, кто получил подробный разбор FORECAST_ASK_AFTER_MS назад (один раз). */
export async function askForecast(db: Db, now: Date): Promise<number> {
  const cfg = telegramConfig();
  if (!cfg) return 0;
  const due = await db
    .selectDistinct({ tg: leads.telegramUserId })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .leftJoin(telegramUsers, eq(telegramUsers.telegramUserId, leads.telegramUserId))
    .where(
      and(
        isNotNull(leads.telegramUserId),
        lte(conversations.fullTextSentAt, new Date(now.getTime() - FORECAST_ASK_AFTER_MS)),
        gt(conversations.fullTextSentAt, new Date(now.getTime() - FORECAST_ASK_UNTIL_MS)),
        isNull(telegramUsers.forecastAskedAt),
        or(isNull(telegramUsers.forecast), eq(telegramUsers.forecast, false)),
      ),
    )
    .limit(50);
  let n = 0;
  for (const { tg } of due) {
    if (tg === null) continue;
    await db
      .insert(telegramUsers)
      .values({ telegramUserId: tg, forecastAskedAt: now })
      .onConflictDoUpdate({ target: telegramUsers.telegramUserId, set: { forecastAskedAt: now } });
    const id = await sendText(
      cfg,
      tg,
      `${em("sparkle")}Хотите каждое утро получать короткий личный прогноз на день по вашей дате рождения? Отписаться можно в любой момент.`,
      [[
        { text: "Да, присылайте", callback: "fc:1", icon: "check" },
        { text: "Нет, спасибо", callback: "fc:0" },
      ]],
    );
    if (id !== null) n++;
  }
  return n;
}

/** Утренняя рассылка прогнозов подписчикам (после FORECAST_HOUR по Москве, раз в день каждому). */
export async function sendForecasts(db: Db, now: Date): Promise<number> {
  const cfg = telegramConfig();
  if (!cfg) return 0;
  const { date, hour } = moscowNow(now);
  if (hour < FORECAST_HOUR) return 0;
  const due = await db
    .select({ tg: telegramUsers.telegramUserId })
    .from(telegramUsers)
    .where(and(eq(telegramUsers.forecast, true), or(isNull(telegramUsers.forecastSentOn), lt(telegramUsers.forecastSentOn, date))))
    .limit(BATCH);
  if (due.length === 0) return 0;
  await ensureBotEmoji(cfg);
  let n = 0;
  for (const { tg } of due) {
    // Отмечаем одним UPDATE — два процесса не отправят дважды
    const [won] = await db
      .update(telegramUsers)
      .set({ forecastSentOn: date })
      .where(and(eq(telegramUsers.telegramUserId, tg), or(isNull(telegramUsers.forecastSentOn), lt(telegramUsers.forecastSentOn, date))))
      .returning({ tg: telegramUsers.telegramUserId });
    if (!won) continue;
    if (await sendForecast(db, cfg, tg, now)) n++;
    await new Promise((r) => setTimeout(r, 50));
  }
  return n;
}

/** /forecast: подписан — отписать, нет — подписать и сразу прислать прогноз на сегодня. */
export async function toggleForecast(db: Db, cfg: TelegramConfig, telegramUserId: number, now = new Date()): Promise<void> {
  const [row] = await db.select({ on: telegramUsers.forecast }).from(telegramUsers).where(eq(telegramUsers.telegramUserId, telegramUserId));
  if (row?.on) {
    await setForecast(db, telegramUserId, false);
    await sendText(cfg, telegramUserId, "Прогноз на день больше не будет приходить. Включить снова — /forecast.", []);
    return;
  }
  await subscribe(db, cfg, telegramUserId, now);
}

async function subscribe(db: Db, cfg: TelegramConfig, telegramUserId: number, now: Date): Promise<void> {
  if (!(await latestLead(db, telegramUserId))) {
    await sendText(cfg, telegramUserId, `${em("moon")}Сначала получите бесплатный разбор — прогноз считается по вашей дате рождения.`, [
      { text: "Получить разбор", webApp: cfg.siteUrl, icon: "moon" },
    ]);
    return;
  }
  await setForecast(db, telegramUserId, true, { forecastSentOn: moscowNow(now).date });
  await sendText(
    cfg,
    telegramUserId,
    `${em("check")}Готово! Прогноз будет приходить каждое утро после ${FORECAST_HOUR}:00 по Москве. Вот прогноз на сегодня:`,
    [],
  );
  await sendForecast(db, cfg, telegramUserId, now);
}

/** Кнопки «fc:1» (подписаться) и «fc:0» (отказаться или отписаться). false — кнопка не отсюда. */
export async function handleForecastCallback(
  db: Db,
  cfg: TelegramConfig,
  q: { id: string; userId: number; chatId: number | null; messageId: number | null; data: string },
  now = new Date(),
): Promise<boolean> {
  if (q.data !== "fc:1" && q.data !== "fc:0") return false;
  await botApi(cfg.token, "answerCallbackQuery", { callback_query_id: q.id });
  const editTo = async (text: string) => {
    if (q.chatId !== null && q.messageId !== null) {
      await botApi(cfg.token, "editMessageText", { chat_id: q.chatId, message_id: q.messageId, text, parse_mode: "HTML" });
    }
  };
  if (q.data === "fc:0") {
    await setForecast(db, q.userId, false);
    await editTo("Хорошо, прогноз присылать не будем. Включить — /forecast.");
    return true;
  }
  await editTo(`${em("check")}Подписка на прогноз включена.`);
  await subscribe(db, cfg, q.userId, now);
  return true;
}

/** /stop — и прогноз больше не приходит. */
export async function stopForecast(db: Db, telegramUserId: number): Promise<void> {
  await db.update(telegramUsers).set({ forecast: false }).where(eq(telegramUsers.telegramUserId, telegramUserId));
}
