/**
 * Картинка «Мой архетип» для сторис (PNG 1080×1920) — по последнему результату теста. Только с подключённым
 * Telegram (как и сам результат). Картинка одна на архетип, без личных данных.
 */
import { getDb } from "@/db";
import { siteHost } from "@/lib/bot-quizzes";
import { getLead } from "@/lib/leads";
import { archetypeView } from "@/lib/quiz-archetype";
import { archetypeStoryPng } from "@/lib/quiz-images";
import { latestQuiz } from "@/lib/quizzes";
import { botUsername, telegramConfig, telegramLink } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/razbor/[id]/arhetip/story">): Promise<Response> {
  const { id } = await ctx.params;
  const db = await getDb();
  const lead = await getLead(db, id);
  if (!lead) return new Response("Не найдено", { status: 404 });
  const telegram = await telegramLink(lead);
  const row = await latestQuiz(db, lead.id, "archetype");
  const view = row ? archetypeView(row, !telegram || telegram.connected) : null;
  if (!view?.result) return new Response("Не найдено", { status: 404 });
  const cfg = telegramConfig();
  const png = await archetypeStoryPng(view.result.key, siteHost(cfg), cfg ? await botUsername(cfg) : null);
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=86400",
      "content-disposition": 'inline; filename="moy-arhetip.png"',
    },
  });
}
