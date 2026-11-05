/**
 * Сообщения и нажатия кнопок, которые люди шлют боту (Telegram присылает их сюда, адрес задаёт configureBot).
 * - Ответ эксперту (текст или фото от человека с привязанной заявкой и чатом) — в чат на сайте (bot-inbox).
 * - /experts и кнопки карточек экспертов — выбрать эксперта и открыть с ним чат (bot-experts).
 * - /forecast и кнопки «Да / Нет» — подписка на личный прогноз на день (bot-forecast).
 * - /start st_<код> — сотрудник подключает Telegram для уведомлений; ответ на уведомление — клиенту (staff-telegram).
 * - Нажатие кнопки оценки эксперта — отзыв (bot-reviews).
 * - Остальное решает botReply: /start <код> привязывает заявку с сайта (и последнее сообщение эксперта
 *   сразу приходит в бот), /stop отвязывает, новым — кнопка «Открыть».
 *
 * Telegram отвечаем 200 сразу, а обновление разбираем после ответа (after): Telegram не ждёт отрисовку
 * плашек и не держит следующие обновления. Обновления одного человека — по очереди, в порядке прихода.
 */
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { getDb } from "@/db";
import { enqueue, sendLatestToTelegram, warmExpertCards } from "@/lib/bot-delivery";
import { handleExpertCallback, showExperts } from "@/lib/bot-experts";
import { handleForecastCallback, stopForecast, toggleForecast } from "@/lib/bot-forecast";
import { type IncomingMessage, handleClientMessage } from "@/lib/bot-inbox";
import { type IncomingCallback, handleCallback } from "@/lib/bot-reviews";
import { selectableExperts } from "@/lib/chat";
import { jsonBody } from "@/lib/http";
import { consumeStaffLink, handleStaffReply, unlinkStaffTelegramUser } from "@/lib/staff-telegram";
import { type TelegramConfig, botApi, botReply, sendMessage, telegramConfig, webhookSecret } from "@/lib/telegram";

export const dynamic = "force-dynamic";

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Нажатие кнопки. Что-то сломалось — всё равно отвечаем на нажатие, чтобы «часики» на кнопке не висели. */
async function onCallback(cfg: TelegramConfig, callback: IncomingCallback): Promise<void> {
  try {
    await handleButton(cfg, callback);
  } catch (err) {
    if (typeof callback.id === "string") await botApi(cfg.token, "answerCallbackQuery", { callback_query_id: callback.id });
    throw err;
  }
}

async function handleButton(cfg: TelegramConfig, callback: IncomingCallback): Promise<void> {
  const db = await getDb();
  const userId = callback.from?.id;
  const data = typeof callback.data === "string" ? callback.data : "";
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  if (typeof callback.id === "string" && typeof userId === "number") {
    const q = {
      id: callback.id,
      userId,
      chatId: typeof chatId === "number" ? chatId : null,
      messageId: typeof messageId === "number" ? messageId : null,
      data,
    };
    if ((await handleExpertCallback(db, cfg, q)) || (await handleForecastCallback(db, cfg, q))) return;
  }
  await handleCallback(db, cfg, callback);
}

async function onMessage(cfg: TelegramConfig, message: IncomingMessage, chatId: number, userId: number): Promise<void> {
  const db = await getDb();
  const [command = "", arg = ""] = typeof message.text === "string" ? message.text.trim().split(/\s+/, 2) : [];
  if (command === "/experts") {
    await showExperts(db, cfg, chatId, userId, 0);
    return;
  }
  if (command === "/forecast") {
    await toggleForecast(db, cfg, userId);
    return;
  }
  // Сотрудник подключает Telegram по ссылке из своей панели
  if (command === "/start") {
    const name = [message.from?.first_name, message.from?.username && `@${String(message.from.username)}`].filter((x) => typeof x === "string").join(" ");
    const staff = await consumeStaffLink(db, arg, { id: userId, name }, new Date());
    if (staff) {
      await sendMessage(cfg, chatId, staff);
      return;
    }
  }
  if (command === "/stop") {
    await unlinkStaffTelegramUser(db, userId);
    await stopForecast(db, userId);
  }
  // Ответ сотрудника на уведомление — клиенту
  const staffReply = await handleStaffReply(db, cfg, message);
  if (staffReply.handled) {
    if (staffReply.reply) await sendMessage(cfg, chatId, staffReply.reply);
    return;
  }
  const inbox = await handleClientMessage(db, cfg, message);
  if (inbox.handled) {
    if (inbox.reply) await sendMessage(cfg, chatId, inbox.reply);
    return;
  }
  const text = typeof message.text === "string" ? message.text : "";
  const reply = await botReply(db, cfg, userId, text, new Date());
  await sendMessage(cfg, chatId, reply.text, reply.buttons);
  if (reply.linked) await sendLatestToTelegram(db, cfg, reply.linked);
}

/**
 * Первая плашка после запуска рисуется ~1,5 с (отрисовщик загружает свои модули и шрифт), следующие — ~40 мс.
 * На первом же обращении к боту рисуем плашки всех экспертов в фоне — карточки потом открываются сразу.
 */
let warmed = false;
function warmUp(): void {
  if (warmed) return;
  warmed = true;
  void getDb()
    .then(async (db) => warmExpertCards(db, (await selectableExperts(db, new Date())).map((e) => e.id), new Date()))
    .catch(() => {
      warmed = false;
    });
}

export async function POST(req: Request) {
  const cfg = telegramConfig();
  if (!cfg) return new Response(null, { status: 404 });
  if (!sameSecret(req.headers.get("x-telegram-bot-api-secret-token") ?? "", webhookSecret(cfg.token))) {
    return new Response(null, { status: 401 });
  }
  const update = await jsonBody(req);
  const callback = update?.callback_query as IncomingCallback | undefined;
  const message = update?.message as IncomingMessage | undefined;
  const userId = callback?.from?.id ?? message?.from?.id;
  const chatId = message?.chat?.id;

  warmUp();
  // enqueue сам подгружает свои эмодзи бота и пишет ошибки в лог
  if (callback && typeof userId === "number") {
    after(() => enqueue(`tg:${userId}`, () => onCallback(cfg, callback)));
  } else if (
    message &&
    typeof chatId === "number" &&
    typeof userId === "number" &&
    // Только личные чаты: в группах кнопка, открывающая сайт, не работает
    message.chat?.type === "private"
  ) {
    after(() => enqueue(`tg:${userId}`, () => onMessage(cfg, message, chatId, userId)));
  }
  // Telegram ждёт 200 — иначе будет повторять доставку
  return new Response(null, { status: 200 });
}
