/**
 * Результаты квизов «Клуба Таромбы» — в бот. Прошёл квиз с подключённым Telegram — результат приходит сразу;
 * без Telegram — придёт, когда человек подключит (joinClub), по одному последнему на каждый квиз.
 * Отправку отмечаем до отправки (markQuizSent): два процесса не пришлют одно и то же дважды.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { leads } from "@/db/schema";
import { ARCANA } from "./arcana";
import { arcanaCardPng } from "./arcana-image";
import { em } from "./bot-emoji";
import { sendText } from "./bot-delivery";
import { dayUrl, sendPhoto } from "./bot-forecast";
import { ARCHETYPES, archetypeView } from "./quiz-archetype";
import { compatView } from "./quiz-compat";
import { archetypeStoryPng } from "./quiz-images";
import { ANSWER_LABEL, yesNoView } from "./quiz-yesno";
import { type QuizRow, markQuizSent, unsentQuizzes } from "./quizzes";
import { type BotButton, type TelegramConfig, botUsername, ensureBotEmoji, esc, keyboard, telegramConfig } from "./telegram";

const CAPTION_LIMIT = 900;

export const siteHost = (cfg: TelegramConfig | null) => (cfg ? new URL(cfg.siteUrl).host : process.env.SITE_DOMAIN?.trim() || "taromba.com");

function buttons(cfg: TelegramConfig, leadId: string, page: string, pageText: string): (BotButton | BotButton[])[] {
  return [
    [
      { text: pageText, webApp: `${cfg.siteUrl}/razbor/${leadId}/${page}`, icon: "sparkle" },
      { text: "Выбрать эксперта", callback: "exl", icon: "star" },
    ],
    { text: "Мой день", webApp: dayUrl(cfg, leadId), icon: "moon" },
  ];
}

/** Фото с подписью; не помещается в подпись — подпись короткая, текст отдельным сообщением. */
async function photoWithText(
  cfg: TelegramConfig,
  chatId: number,
  key: string,
  render: () => Promise<Buffer>,
  head: string,
  body: string,
  rows: (BotButton | BotButton[])[],
): Promise<void> {
  const short = head.length + body.length + 2 <= CAPTION_LIMIT;
  await sendPhoto(cfg, chatId, key, render, { caption: short ? `${head}\n\n${body}` : head, parse_mode: "HTML", ...(short ? keyboard(rows) : {}) });
  if (!short) await sendText(cfg, chatId, body, rows);
}

async function sendQuiz(cfg: TelegramConfig, chatId: number, row: QuizRow, birthDate: string, now: Date): Promise<void> {
  if (row.kind === "compat") {
    const v = compatView(row, birthDate, true);
    if (!v?.result) return;
    const { scores: s, text: t } = v.result;
    const html =
      `${em("sparkle")}<b>Совместимость пары: ${s.total}%</b>\n` +
      `Вы — ${esc(v.self.sign)}, число судьбы ${v.self.num}; ${v.partnerName ? esc(v.partnerName) : "партнёр"} — ${esc(v.partner.sign)}, число ${v.partner.num}\n\n` +
      `${esc(t.summary)}\n\n<b>Чувства — ${s.feelings}%.</b> ${esc(t.feelings)}\n<b>Быт — ${s.life}%.</b> ${esc(t.life)}\n` +
      `<b>Страсть — ${s.passion}%.</b> ${esc(t.passion)}\n\n${em("sparkle")}<b>Что стоит разобрать.</b> <i>${esc(t.teaser)}</i>\n\n` +
      "Напишите эксперту прямо сюда — он разберёт вашу пару по двум датам рождения.";
    await sendText(cfg, chatId, html, buttons(cfg, row.leadId, "sovmestimost", "Открыть на сайте"));
    return;
  }
  if (row.kind === "archetype") {
    const v = archetypeView(row, true);
    if (!v?.result) return;
    const a = ARCHETYPES[v.result.key];
    const head = `${em("star")}<b>Ваш архетип — ${esc(a.name)}</b>\n<i>${esc(a.tagline)}</i>`;
    const body =
      `${esc(v.result.personal)}\n\n<b>Сила.</b> ${esc(a.strength)}\n<b>В любви.</b> ${esc(a.love)}\n<b>Тень.</b> ${esc(a.shadow)}\n\n` +
      `${em("sparkle")}<b>Что стоит разобрать.</b> <i>${esc(v.result.teaser)}</i>\n\nКартинка — для сторис: сохраните и поделитесь.`;
    const bot = await botUsername(cfg);
    await photoWithText(cfg, chatId, `story:${a.key}`, () => archetypeStoryPng(a.key, siteHost(cfg), bot), head, body, buttons(cfg, row.leadId, "arhetip", "Открыть на сайте"));
    return;
  }
  if (row.kind === "yesno") {
    const v = yesNoView(row, true);
    if (!v?.result) return;
    const r = v.result;
    const c = ARCANA[r.card] ?? ARCANA[0]!;
    const head = `${em("moon")}<b>Ваш вопрос:</b> «${esc(v.question)}»\n<b>${esc(c.n)} · ${esc(c.name)}${r.answer ? ` — ${ANSWER_LABEL[r.answer]}` : ""}</b>`;
    const body =
      `${esc(r.text)}\n\n<b>Совет.</b> ${esc(r.advice)}\n\n${em("sparkle")}<b>Что за этим стоит.</b> <i>${esc(r.teaser)}</i>\n\n` +
      "Напишите эксперту прямо сюда — он разберёт ваш вопрос подробно.";
    await photoWithText(cfg, chatId, `yn:${r.card}`, () => arcanaCardPng(r.card, now, "ДА ИЛИ НЕТ"), head, body, buttons(cfg, row.leadId, "da-net", "Открыть на сайте"));
  }
}

/** Только что пройденный квиз — в бот, если Telegram подключён. */
export async function deliverQuiz(db: Db, row: QuizRow, now = new Date()): Promise<void> {
  const cfg = telegramConfig();
  if (!cfg) return;
  const [lead] = await db.select({ tg: leads.telegramUserId, birthDate: leads.birthDate }).from(leads).where(eq(leads.id, row.leadId));
  if (!lead?.tg) return;
  if (!(await markQuizSent(db, row.id, now))) return;
  await ensureBotEmoji(cfg);
  await sendQuiz(cfg, lead.tg, row, lead.birthDate, now);
}

/** Подключил Telegram — присылаем то, что прошёл до этого (по последнему результату каждого квиза). */
export async function sendPendingQuizzes(db: Db, cfg: TelegramConfig, leadId: string, now = new Date()): Promise<number> {
  const [lead] = await db.select({ tg: leads.telegramUserId, birthDate: leads.birthDate }).from(leads).where(eq(leads.id, leadId));
  if (!lead?.tg) return 0;
  let n = 0;
  for (const row of await unsentQuizzes(db, leadId, now)) {
    if (!(await markQuizSent(db, row.id, now))) continue;
    await sendQuiz(cfg, lead.tg, row, lead.birthDate, now);
    n++;
  }
  return n;
}
