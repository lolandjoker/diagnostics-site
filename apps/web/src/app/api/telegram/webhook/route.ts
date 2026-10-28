/**
 * Сообщения, которые люди пишут боту (Telegram присылает их сюда, адрес задаёт configureBot).
 * Что ответить, решает botReply: /start <код> привязывает заявку с сайта, /stop отвязывает,
 * остальным — кнопки «Открыть чат» / «Открыть». Переписка с экспертом идёт в чате на сайте, не в боте.
 */
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { jsonBody } from "@/lib/http";
import { botReply, sendMessage, telegramConfig, webhookSecret } from "@/lib/telegram";

export const dynamic = "force-dynamic";

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type Message = { chat?: { id?: unknown; type?: unknown }; from?: { id?: unknown }; text?: unknown };

export async function POST(req: Request) {
  const cfg = telegramConfig();
  if (!cfg) return new Response(null, { status: 404 });
  if (!sameSecret(req.headers.get("x-telegram-bot-api-secret-token") ?? "", webhookSecret(cfg.token))) {
    return new Response(null, { status: 401 });
  }
  const message = (await jsonBody(req))?.message as Message | undefined;
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  // Только личные чаты: в группах кнопка, открывающая сайт, не работает
  if (typeof chatId === "number" && typeof userId === "number" && message?.chat?.type === "private") {
    const text = typeof message.text === "string" ? message.text : "";
    const reply = await botReply(await getDb(), cfg, userId, text, new Date());
    await sendMessage(cfg, chatId, reply.text, reply.buttons);
  }
  // Telegram ждёт 200 — иначе будет повторять доставку
  return new Response(null, { status: 200 });
}
