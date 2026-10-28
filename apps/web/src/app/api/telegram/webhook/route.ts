/**
 * Сообщения, которые люди пишут боту (Telegram присылает их сюда, адрес задаёт configureBot).
 * На любое сообщение, в том числе /start, бот отвечает приветствием с кнопкой, открывающей сайт.
 * Переписка с экспертом идёт в чате на сайте, не в боте.
 */
import { timingSafeEqual } from "node:crypto";
import { jsonBody } from "@/lib/http";
import { WELCOME_TEXT, sendMessage, telegramConfig, webhookSecret } from "@/lib/telegram";

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
  const message = (await jsonBody(req))?.message as { chat?: { id?: unknown; type?: unknown } } | undefined;
  const chatId = message?.chat?.id;
  // Только личные чаты: в группах кнопка, открывающая сайт, не работает
  if (typeof chatId === "number" && message?.chat?.type === "private") {
    await sendMessage(cfg, chatId, WELCOME_TEXT, { text: "Открыть", url: cfg.siteUrl });
  }
  // Telegram ждёт 200 — иначе будет повторять доставку
  return new Response(null, { status: 200 });
}
