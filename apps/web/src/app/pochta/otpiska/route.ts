/**
 * «Отписаться» из письма: ?t=<код> (lib/lead-email.ts, подписан SESSION_SECRET). GET — ссылка в письме, страница
 * с итогом; POST — отписка в один клик из почтового клиента (заголовок List-Unsubscribe-Post).
 */
import { getDb } from "@/db";
import { leadFromOptOutCode, optOutEmail } from "@/lib/lead-email";

export const dynamic = "force-dynamic";

async function optOut(req: Request): Promise<boolean> {
  const secret = process.env.SESSION_SECRET;
  const leadId = secret ? leadFromOptOutCode(secret, new URL(req.url).searchParams.get("t") ?? "") : null;
  return leadId !== null && (await optOutEmail(await getDb(), leadId, new Date()));
}

const page = (title: string, text: string) =>
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4f9;font-family:Arial,Helvetica,sans-serif;color:#2a2233">
<main style="max-width:420px;margin:24px 16px;padding:28px 24px;background:#fff;border-radius:16px;text-align:center;line-height:1.5">
<h1 style="margin:0 0 10px;font-size:22px">${title}</h1><p style="margin:0 0 18px">${text}</p>
<a href="/" style="color:#8a6a1f">На сайт Таромбы</a></main></body></html>`;

export async function GET(req: Request) {
  const ok = await optOut(req);
  return new Response(
    ok
      ? page("Вы отписались", "Больше не будем присылать письма на эту почту. Ответы эксперта по-прежнему в чате на сайте.")
      : page("Ссылка не сработала", "Похоже, ссылка из письма повреждена. Скопируйте её из письма целиком."),
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  return new Response(null, { status: (await optOut(req)) ? 200 : 400 });
}
