/**
 * Карта дня в боте («Клуб Таромбы») — повод возвращаться каждый день. Подписка (telegram_users.forecast):
 * - вступил в клуб с сайта (подключил Telegram по ссылке) — подписан сразу, карта сегодня приходит тут же;
 * - пришёл в бот сам — через 2 часа после подробного разбора бот один раз предлагает («Да» / «Нет»);
 * - /forecast — включить или выключить, «Отписаться» — под каждым утренним сообщением, /stop — всё.
 * Каждое утро после FORECAST_HOUR по Москве: пять рубашек и кнопки 1–5. Нажал — карта и расшифровка
 * (та же, что на сайте в «Моём дне»: одна карта на заявку в день). Уже вытянул на сайте — утром не беспокоим.
 */
import { and, desc, eq, gt, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, leads, telegramUsers } from "@/db/schema";
import { ARCANA } from "./arcana";
import { arcanaBacksPng, arcanaCardPng } from "./arcana-image";
import { em } from "./bot-emoji";
import { sendText } from "./bot-delivery";
import { type DailyCard, cardStreak, daysLabel, drawDailyCard, todayCard } from "./club";
import { moscowNow, personalDay } from "./numerology";
import { type BotButton, type TelegramConfig, botApi, botCall, esc, ensureBotEmoji, keyboard, sentId, telegramConfig } from "./telegram";

export { moscowNow, personalDay };

export const FORECAST_HOUR = 9;
export const FORECAST_ASK_AFTER_MS = 2 * 60 * 60 * 1000;
const FORECAST_ASK_UNTIL_MS = 3 * 24 * 60 * 60 * 1000;
const BATCH = 200;
/** Подпись к картинке — до 1024 символов; длиннее — расшифровка отдельным сообщением. */
const CAPTION_LIMIT = 900;

/** Последняя заявка человека в боте. */
async function latestLead(db: Db, telegramUserId: number) {
  const [lead] = await db
    .select({ id: leads.id, name: leads.name, birthDate: leads.birthDate })
    .from(leads)
    .where(eq(leads.telegramUserId, telegramUserId))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return lead ?? null;
}

const dayUrl = (cfg: TelegramConfig, leadId: string) => `${cfg.siteUrl}/razbor/${leadId}/den`;

/** Картинки уже в Telegram — по file_id (общие для процесса). Рубашки одни; карта — на свою дату. */
const files = ((globalThis as unknown as { __diagCardFiles?: Map<string, string> }).__diagCardFiles ??= new Map());

async function sendPhoto(
  cfg: TelegramConfig,
  chatId: number,
  key: string,
  render: () => Promise<Buffer>,
  fields: Record<string, unknown>,
): Promise<number | null> {
  const cached = files.get(key);
  if (cached) {
    const id = sentId(await botCall(cfg.token, "sendPhoto", { chat_id: chatId, ...fields, photo: cached }));
    if (id !== null) return id;
    files.delete(key);
  }
  const sent = (await botCall(cfg.token, "sendPhoto", { chat_id: chatId, ...fields }, { field: "photo", data: await render(), name: "card.png", type: "image/png" })) as {
    photo?: { file_id?: string }[];
  } | null;
  const fileId = sent?.photo?.at(-1)?.file_id;
  if (fileId) {
    if (files.size > 200) files.clear();
    files.set(key, fileId);
  }
  return sentId(sent);
}

/** Утреннее «выберите карту»: пять рубашек и кнопки 1–5. false — заявки нет или уже тянул сегодня. */
export async function sendMorningCard(db: Db, cfg: TelegramConfig, telegramUserId: number, now: Date): Promise<boolean> {
  const lead = await latestLead(db, telegramUserId);
  if (!lead || (await todayCard(db, lead.id, now))) return false;
  const streak = await cardStreak(db, lead.id, now);
  const caption =
    `${em("moon")}<b>${esc(lead.name)}, доброе утро!</b>${streak > 0 ? ` Серия — ${daysLabel(streak)}.` : ""}\n` +
    "Выберите карту дня — доверьтесь первому порыву.";
  const picks: BotButton[] = [1, 2, 3, 4, 5].map((n) => ({ text: String(n), callback: `cd:${n}`, icon: "star" }));
  const id = await sendPhoto(cfg, telegramUserId, "backs", arcanaBacksPng, {
    caption,
    parse_mode: "HTML",
    ...keyboard([picks, [{ text: "Мой день", webApp: dayUrl(cfg, lead.id), icon: "moon" }, { text: "Отписаться", callback: "fc:0" }]]),
  });
  return id !== null;
}

/** Карта дня с расшифровкой — в бот. */
async function sendCardReading(cfg: TelegramConfig, telegramUserId: number, leadId: string, row: DailyCard, now: Date, intro = ""): Promise<void> {
  const c = ARCANA[row.card] ?? ARCANA[0]!;
  const head = `${intro}<b>${esc(c.n)} · ${esc(c.name)}</b>\n\n`;
  const tail = "\n\n<i>Хотите разобрать подробнее — напишите эксперту прямо сюда.</i>";
  const buttons = keyboard([[{ text: "Мой день", webApp: dayUrl(cfg, leadId), icon: "moon" }, { text: "Выбрать эксперта", callback: "exl", icon: "star" }]]);
  const short = row.text.length <= CAPTION_LIMIT - 200;
  await sendPhoto(cfg, telegramUserId, `card:${row.card}:${row.day}`, () => arcanaCardPng(row.card, now), {
    caption: short ? head + esc(row.text) + tail : head.trim(),
    parse_mode: "HTML",
    ...(short ? buttons : {}),
  });
  if (!short) await sendText(cfg, telegramUserId, esc(row.text) + tail, [[{ text: "Мой день", webApp: dayUrl(cfg, leadId), icon: "moon" }, { text: "Выбрать эксперта", callback: "exl", icon: "star" }]]);
}

async function setForecast(db: Db, telegramUserId: number, on: boolean, extra: Partial<typeof telegramUsers.$inferInsert> = {}) {
  await db
    .insert(telegramUsers)
    .values({ telegramUserId, forecast: on, ...extra })
    .onConflictDoUpdate({ target: telegramUsers.telegramUserId, set: { forecast: on, ...extra } });
}

/**
 * Человек вступил в клуб с сайта (подключил Telegram): подписываем на карту дня и сразу присылаем
 * сегодняшнюю — уже вытянутую на сайте с расшифровкой, или предложение вытянуть.
 */
export async function joinClub(db: Db, cfg: TelegramConfig, leadId: string, now = new Date()): Promise<void> {
  const [lead] = await db.select({ tg: leads.telegramUserId }).from(leads).where(eq(leads.id, leadId));
  if (!lead?.tg) return;
  await setForecast(db, lead.tg, true, { forecastSentOn: moscowNow(now).date });
  const row = await todayCard(db, leadId, now);
  if (row) await sendCardReading(cfg, lead.tg, leadId, row, now, `${em("sparkle")}Ваша карта дня\n`);
  else await sendMorningCard(db, cfg, lead.tg, now);
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
      `${em("sparkle")}Хотите каждое утро вытягивать карту дня с расшифровкой по вашей дате рождения? Это бесплатно, отписаться можно в любой момент.`,
      [[
        { text: "Да, присылайте", callback: "fc:1", icon: "check" },
        { text: "Нет, спасибо", callback: "fc:0" },
      ]],
    );
    if (id !== null) n++;
  }
  return n;
}

/** Утренняя рассылка подписчикам (после FORECAST_HOUR по Москве, раз в день каждому). */
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
    if (await sendMorningCard(db, cfg, tg, now)) n++;
    await new Promise((r) => setTimeout(r, 50));
  }
  return n;
}

/** /forecast: подписан — отписать, нет — подписать и сразу предложить карту на сегодня. */
export async function toggleForecast(db: Db, cfg: TelegramConfig, telegramUserId: number, now = new Date()): Promise<void> {
  const [row] = await db.select({ on: telegramUsers.forecast }).from(telegramUsers).where(eq(telegramUsers.telegramUserId, telegramUserId));
  if (row?.on) {
    await setForecast(db, telegramUserId, false);
    await sendText(cfg, telegramUserId, "Карта дня больше не будет приходить по утрам. Включить снова — /forecast.", []);
    return;
  }
  await subscribe(db, cfg, telegramUserId, now);
}

async function subscribe(db: Db, cfg: TelegramConfig, telegramUserId: number, now: Date): Promise<void> {
  const lead = await latestLead(db, telegramUserId);
  if (!lead) {
    await sendText(cfg, telegramUserId, `${em("moon")}Сначала получите бесплатный разбор — карта дня читается по вашей дате рождения.`, [
      { text: "Получить разбор", webApp: cfg.siteUrl, icon: "moon" },
    ]);
    return;
  }
  await setForecast(db, telegramUserId, true, { forecastSentOn: moscowNow(now).date });
  await sendText(cfg, telegramUserId, `${em("check")}Готово! Карта дня будет приходить каждое утро после ${FORECAST_HOUR}:00 по Москве.`, []);
  const row = await todayCard(db, lead.id, now);
  if (row) await sendCardReading(cfg, telegramUserId, lead.id, row, now, "Сегодняшняя карта уже вытянута:\n");
  else await sendMorningCard(db, cfg, telegramUserId, now);
}

type Callback = { id: string; userId: number; chatId: number | null; messageId: number | null; data: string };

/**
 * Кнопки «fc:1» / «fc:0» (подписаться / отказаться) и «cd:1…5» (вытянуть карту дня). false — кнопка не отсюда.
 * На нажатие отвечаем сразу — кнопка не «висит», пока пишется расшифровка.
 */
export async function handleForecastCallback(db: Db, cfg: TelegramConfig, q: Callback, now = new Date()): Promise<boolean> {
  const card = /^cd:([1-5])$/.exec(q.data);
  if (card) {
    await botApi(cfg.token, "answerCallbackQuery", { callback_query_id: q.id, text: "Открываю карту…" });
    const lead = await latestLead(db, q.userId);
    if (!lead) return true;
    // Кнопки под рубашками больше не нужны
    if (q.chatId !== null && q.messageId !== null) {
      await botApi(cfg.token, "editMessageReplyMarkup", { chat_id: q.chatId, message_id: q.messageId, reply_markup: { inline_keyboard: [] } });
    }
    void botApi(cfg.token, "sendChatAction", { chat_id: q.userId, action: "upload_photo" });
    const before = await todayCard(db, lead.id, now);
    const row = before ?? (await drawDailyCard(db, lead.id, Number(card[1]), now));
    if (row) await sendCardReading(cfg, q.userId, lead.id, row, now, before ? "Сегодня ваша карта уже вытянута:\n" : "");
    return true;
  }
  if (q.data !== "fc:1" && q.data !== "fc:0") return false;
  await botApi(cfg.token, "answerCallbackQuery", { callback_query_id: q.id });
  // Текст сообщения-вопроса меняем; под утренней картинкой текста нет — там убираем кнопки и пишем отдельно
  const editTo = async (text: string): Promise<boolean> =>
    q.chatId !== null &&
    q.messageId !== null &&
    (await botApi(cfg.token, "editMessageText", { chat_id: q.chatId, message_id: q.messageId, text, parse_mode: "HTML" }));
  if (q.data === "fc:0") {
    await setForecast(db, q.userId, false);
    if (!(await editTo("Хорошо, карту дня по утрам присылать не будем. Включить — /forecast."))) {
      if (q.chatId !== null && q.messageId !== null) {
        await botApi(cfg.token, "editMessageReplyMarkup", { chat_id: q.chatId, message_id: q.messageId, reply_markup: { inline_keyboard: [] } });
      }
      await sendText(cfg, q.userId, "Карта дня по утрам отключена. Включить снова — /forecast.", []);
    }
    return true;
  }
  await editTo(`${em("check")}Карта дня по утрам включена.`);
  await subscribe(db, cfg, q.userId, now);
  return true;
}

/** /stop — и карта дня больше не приходит. */
export async function stopForecast(db: Db, telegramUserId: number): Promise<void> {
  await db.update(telegramUsers).set({ forecast: false }).where(eq(telegramUsers.telegramUserId, telegramUserId));
}
