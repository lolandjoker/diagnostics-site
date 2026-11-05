"use server";

/** Вытянуть карту дня на странице «Мой день». Доступ — по id заявки (как ко всей странице разбора). */
import { getDb } from "@/db";
import { type DailyCardView, cardView, drawDailyCard } from "@/lib/club";
import { getLead } from "@/lib/leads";
import { telegramLink } from "@/lib/telegram";

export async function drawCardAction(leadId: string, position: number): Promise<DailyCardView | { error: string }> {
  const db = await getDb();
  const lead = await getLead(db, String(leadId));
  if (!lead) return { error: "Разбор не найден — откройте его заново" };
  const row = await drawDailyCard(db, lead.id, Number(position), new Date());
  if (!row) return { error: "Не получилось вытянуть карту — попробуйте ещё раз" };
  // Расшифровка — только с подключённым Telegram (бот выключен — открываем всем)
  const telegram = await telegramLink(lead);
  return cardView(row, !telegram || telegram.connected);
}
