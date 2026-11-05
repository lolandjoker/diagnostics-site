/**
 * Сообщения, которые люди пишут боту (Telegram присылает их сюда, адрес задаёт configureBot).
 * - Ответ эксперту (текст или фото от человека с привязанной заявкой и чатом) — в чат на сайте (bot-inbox).
 * - /experts и кнопки карточек экспертов — выбрать эксперта и открыть с ним чат (bot-experts).
 * - Нажатие кнопки оценки эксперта — отзыв (bot-reviews).
 * - Остальное решает botReply: /start <код> привязывает заявку с сайта (и последнее сообщение эксперта
 *   сразу приходит в бот), /stop отвязывает, новым — кнопка «Открыть».
 */
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { sendLatestToTelegram } from "@/lib/bot-delivery";
import { type IncomingMessage, handleClientMessage } from "@/lib/bot-inbox";
import { handleExpertCallback, showExperts } from "@/lib/bot-experts";
import { type IncomingCallback, handleCallback } from "@/lib/bot-reviews";
import { jsonBody } from "@/lib/http";
import { botReply, ensureBotEmoji, sendMessage, telegramConfig, webhookSecret } from "@/lib/telegram";

export const dynamic = "force-dynamic";

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: Request) {
  const cfg = telegramConfig();
  if (!cfg) return new Response(null, { status: 404 });
  if (!sameSecret(req.headers.get("x-telegram-bot-api-secret-token") ?? "", webhookSecret(cfg.token))) {
    return new Response(null, { status: 401 });
  }
  const update = await jsonBody(req);
  await ensureBotEmoji(cfg);
  const callback = update?.callback_query as IncomingCallback | undefined;
  if (callback) {
    try {
      const db = await getDb();
      const userId = callback.from?.id;
      const data = typeof callback.data === "string" ? callback.data : "";
      const chatId = callback.message?.chat?.id;
      const messageId = callback.message?.message_id;
      const expertButton =
        typeof callback.id === "string" &&
        typeof userId === "number" &&
        (await handleExpertCallback(db, cfg, {
          id: callback.id,
          userId,
          chatId: typeof chatId === "number" ? chatId : null,
          messageId: typeof messageId === "number" ? messageId : null,
          data,
        }));
      if (!expertButton) await handleCallback(db, cfg, callback);
    } catch (err) {
      console.warn(`Кнопка бота: ${err instanceof Error ? err.message : String(err)}`);
    }
    return new Response(null, { status: 200 });
  }
  const message = update?.message as IncomingMessage | undefined;
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  // Только личные чаты: в группах кнопка, открывающая сайт, не работает
  if (message && typeof chatId === "number" && typeof userId === "number" && message.chat?.type === "private") {
    const db = await getDb();
    try {
      const command = typeof message.text === "string" ? message.text.trim().split(/\s+/, 1)[0] : "";
      const inbox = command === "/experts" ? null : await handleClientMessage(db, cfg, message);
      if (!inbox) {
        await showExperts(db, cfg, chatId, userId, 0);
      } else if (inbox.handled) {
        if (inbox.reply) await sendMessage(cfg, chatId, inbox.reply);
      } else {
        const text = typeof message.text === "string" ? message.text : "";
        const reply = await botReply(db, cfg, userId, text, new Date());
        await sendMessage(cfg, chatId, reply.text, reply.buttons);
        if (reply.linked) await sendLatestToTelegram(db, cfg, reply.linked);
      }
    } catch (err) {
      console.warn(`Сообщение боту: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Telegram ждёт 200 — иначе будет повторять доставку
  return new Response(null, { status: 200 });
}
