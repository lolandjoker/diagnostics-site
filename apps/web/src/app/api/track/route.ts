/**
 * Шаг воронки от страницы: POST {step, leadId?}. Браузер узнаём по анонимной cookie vid (случайный id,
 * без личных данных) — ставим её при первом шаге. Ошибки не мешают человеку: ответ всегда 204.
 */
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { isTrackedStep, trackStep } from "@/lib/funnel";
import { jsonBody, sameOrigin } from "@/lib/http";
import { getLead } from "@/lib/leads";

export const dynamic = "force-dynamic";

const VISITOR_COOKIE = "vid";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const body = await jsonBody(req);
  const step = typeof body?.step === "string" ? body.step : "";
  if (!isTrackedStep(step)) return new Response(null, { status: 400 });

  const jar = await cookies();
  let visitorId = jar.get(VISITOR_COOKIE)?.value ?? "";
  if (!/^[0-9a-f]{32}$/.test(visitorId)) {
    visitorId = randomBytes(16).toString("hex");
    jar.set(VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 86_400,
    });
  }
  try {
    const db = await getDb();
    const lead = typeof body?.leadId === "string" ? await getLead(db, body.leadId) : null;
    await trackStep(db, visitorId, step, lead?.id ?? null);
  } catch (err) {
    console.warn(`Воронка: ${err instanceof Error ? err.message : String(err)}`);
  }
  return new Response(null, { status: 204 });
}
