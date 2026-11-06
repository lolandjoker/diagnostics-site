/**
 * Вход владельца в админку из Telegram: /admin/telegram?t=<код из бота> (lib/owner.ts).
 * Код подошёл — ставим cookie админки и открываем «Чаты». Переход делает сама страница: cookie админки
 * SameSite=Strict, при первом переходе из Telegram браузер её ещё не отправил бы. Не подошёл — на вход по паролю.
 */
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_DAYS, authConfig, createSessionToken } from "@/lib/admin-auth";
import { ownerFromAdminCode } from "@/lib/owner";
import { telegramConfig } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const page = (title: string, to: string) =>
  new Response(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<meta http-equiv="refresh" content="0;url=${to}"></head><body style="font-family:system-ui;padding:24px">${title}… ` +
      `<a href="${to}">продолжить</a><script>location.replace(${JSON.stringify(to)})</script></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } },
  );

export async function GET(req: Request) {
  const tg = telegramConfig();
  const auth = authConfig();
  const code = new URL(req.url).searchParams.get("t") ?? "";
  const owner = tg ? ownerFromAdminCode(tg.token, code, new Date()) : null;
  if (!owner || typeof auth === "string") return page("Ссылка устарела — попросите новую командой /admin в боте", "/admin/login");
  (await cookies()).set(SESSION_COOKIE, createSessionToken(Date.now(), auth), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: SESSION_DAYS * 86_400,
  });
  return page("Входим в админку", "/admin/chats");
}
