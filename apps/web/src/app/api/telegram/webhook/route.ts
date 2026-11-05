/**
 * Сообщения, которые люди пишут боту (Telegram присылает их сюда, адрес задаёт configureBot).
 * - Ответ эксперту (текст или фото от человека с привязанной заявкой и чатом) — в чат на сайте (bot-inbox).
 * - Остальное решает botReply: /start <код> привязывает заявку с сайта (и последнее сообщение эксперта
 *   сразу приходит в бот), /stop отвязывает, новым — кнопка «Открыть».
 */
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { sendLatestToTelegram } from "@/lib/bot-delivery";
import { type IncomingMessage, handleClientMessage } from "@/lib/bot-inbox";
import { jsonBody } from "@/lib/http";
import { botReply, sendMessage, telegramConfig, webhookSecret } from "@/lib/telegram";

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
  const message = (await jsonBody(req))?.message as IncomingMessage | undefined;
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  // Только личные чаты: в группах кнопка, открывающая сайт, не работает
  if (message && typeof chatId === "number" && typeof userId === "number" && message.chat?.type === "private") {
    const db = await getDb();
    try {
      const inbox = await handleClientMessage(db, cfg, message);
      if (inbox.handled) {
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
