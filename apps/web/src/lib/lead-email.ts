/**
 * Почта клиента для уведомлений. Человек указывает её в окне «Подключите Telegram» в чате (рядом с Telegram) —
 * сейчас на неё уходит одно письмо: «Подробный разбор готов» с текстом разбора и кнопкой в чат.
 * - Письмо одно на заявку (leads.email_full_text_sent_at; отметка одним UPDATE — два опроса не отправят дважды).
 * - Почту указали, когда разбор уже пришёл, — письмо уходит сразу.
 * - В каждом письме — «Отписаться» (ссылка с подписью SESSION_SECRET): после неё не пишем; новая почта в окне
 *   снова подписывает. Ещё одну ссылку отписки дописывает UniSender Go — отписавшимся там он сам не шлёт.
 * - Почта выключена (lib/mail.ts) — адрес сохраняем, письмо не уходит и не отмечается.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, count, eq, isNull, or } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, experts, leads, messages } from "@/db/schema";
import { type MailConfig, mailConfig, sendMail } from "./mail";
import { within } from "./period";

/** Не чаще раза в минуту менять почту: защита от перебора адресов чужими руками. */
export const EMAIL_CHANGE_GAP_MS = 60_000;

/** Адрес почты: обрезаем пробелы, буквы — строчные; не похоже на почту — null. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  return /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/.test(email) ? email : null;
}

const sign = (secret: string, leadId: string) => createHmac("sha256", secret).update(`email-optout:${leadId}`).digest("hex").slice(0, 32);

/** Код ссылки «Отписаться»: id заявки и подпись. */
export const optOutCode = (secret: string, leadId: string) => `${leadId}.${sign(secret, leadId)}`;

export function leadFromOptOutCode(secret: string, code: string): string | null {
  const m = /^([0-9a-f-]{36})\.([0-9a-f]{32})$/.exec(code);
  if (!m) return null;
  const expected = Buffer.from(sign(secret, m[1]!));
  const given = Buffer.from(m[2]!);
  return expected.length === given.length && timingSafeEqual(expected, given) ? m[1]! : null;
}

/** Отписка: этот адрес больше не получает писем ни по одной заявке (рассылки идут по адресу, а не по заявке). */
export async function optOutEmail(db: Db, leadId: string, now: Date): Promise<boolean> {
  const [lead] = await db.select({ email: leads.email }).from(leads).where(eq(leads.id, leadId));
  if (!lead) return false;
  await db
    .update(leads)
    .set({ emailOptOutAt: now })
    .where(lead.email ? or(eq(leads.id, leadId), eq(leads.email, lead.email)) : eq(leads.id, leadId));
  return true;
}

export type ConnectResult = { ok: true; sentNow: boolean } | { ok: false; error: string; status: number };

/** Человек указал почту в чате. Разбор уже пришёл — отправляем его сразу. */
export async function connectEmail(db: Db, leadId: string, raw: string, now: Date, cfg = mailConfig()): Promise<ConnectResult> {
  const email = normalizeEmail(raw);
  if (!email) return { ok: false, error: "Проверьте адрес почты", status: 400 };
  const [lead] = await db.select({ email: leads.email, emailAt: leads.emailAt }).from(leads).where(eq(leads.id, leadId));
  if (!lead) return { ok: false, error: "Заявка не найдена", status: 404 };
  if (lead.email !== email && lead.emailAt && now.getTime() - lead.emailAt.getTime() < EMAIL_CHANGE_GAP_MS) {
    return { ok: false, error: "Почту только что меняли — попробуйте через минуту", status: 429 };
  }
  await db.update(leads).set({ email, emailAt: now, emailOptOutAt: null }).where(eq(leads.id, leadId));
  // Разбора ещё нет — sendFullTextEmail ничего не отправит (письмо уйдёт, когда он придёт)
  const sentNow = await sendFullTextEmail(db, leadId, now, cfg);
  return { ok: true, sentNow };
}

/** Адрес сайта для ссылок в письме. */
const siteUrl = (env: Record<string, string | undefined> = process.env) => {
  const domain = env.SITE_DOMAIN?.trim();
  return domain ? `https://${domain}` : null;
};

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Письмо «Подробный разбор готов»: текст абзацами, кнопка в чат, внизу — почему пришло и как отписаться. */
export function fullTextMail(input: { name: string; expertName: string; body: string; chatUrl: string; optOutUrl: string }) {
  const paragraphs = input.body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const first = input.name.trim().split(/\s+/)[0] ?? "";
  const html = `<!doctype html><html lang="ru"><body style="margin:0;padding:0;background:#f6f4f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4f9;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:28px 24px;font-family:Arial,Helvetica,sans-serif;color:#2a2233;line-height:1.55;font-size:16px">
<tr><td>
<p style="margin:0 0 4px;color:#8a6a1f;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Таромба</p>
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3">${escHtml(first)}, ваш подробный разбор готов</h1>
${paragraphs.map((p) => `<p style="margin:0 0 14px">${escHtml(p).replace(/\n/g, "<br>")}</p>`).join("\n")}
<p style="margin:22px 0 8px">Эксперт <b>${escHtml(input.expertName)}</b> ждёт вас в чате — можно задать вопросы по разбору.</p>
<p style="margin:18px 0 6px"><a href="${escHtml(input.chatUrl)}" style="display:inline-block;padding:13px 26px;border-radius:999px;background:#8a6a1f;color:#ffffff;text-decoration:none;font-weight:bold">Открыть чат с экспертом</a></p>
</td></tr></table>
<p style="max-width:560px;margin:14px auto 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8294;line-height:1.5">
Вы получили это письмо, потому что указали эту почту в чате на сайте Таромба.
<a href="${escHtml(input.optOutUrl)}" style="color:#8a8294">Отписаться</a></p>
</td></tr></table></body></html>`;
  const text = [
    `${first}, ваш подробный разбор готов`,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    `Эксперт ${input.expertName} ждёт вас в чате: ${input.chatUrl}`,
    "",
    `Отписаться: ${input.optOutUrl}`,
  ].join("\n");
  return { subject: "Ваш подробный разбор готов", html, text };
}

/** Письмо с подробным разбором — один раз на заявку, если почта указана и человек не отписался. */
export async function sendFullTextEmail(db: Db, leadId: string, now: Date, cfg: MailConfig | null = mailConfig()): Promise<boolean> {
  const site = siteUrl();
  const secret = process.env.SESSION_SECRET;
  if (!cfg || !site || !secret) return false;
  // Отметка — одним UPDATE: два одновременных вызова не отправят дважды
  const [lead] = await db
    .update(leads)
    .set({ emailFullTextSentAt: now })
    .where(and(eq(leads.id, leadId), isNull(leads.emailFullTextSentAt), isNull(leads.emailOptOutAt)))
    .returning({ name: leads.name, email: leads.email });
  if (!lead) return false;
  const release = () => db.update(leads).set({ emailFullTextSentAt: null }).where(eq(leads.id, leadId));
  if (!lead.email) {
    await release();
    return false;
  }
  const [row] = await db
    .select({ body: messages.body, conversationId: conversations.id, expertName: experts.name })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(experts, eq(experts.id, conversations.expertId))
    .where(and(eq(conversations.leadId, leadId), eq(messages.author, "system")))
    .orderBy(asc(messages.id))
    .limit(1);
  if (!row) {
    await release();
    return false;
  }
  const optOutUrl = `${site}/pochta/otpiska?t=${optOutCode(secret, leadId)}`;
  const mail = fullTextMail({
    name: lead.name,
    expertName: row.expertName.split("|")[0]!.trim(),
    body: row.body,
    chatUrl: `${site}/razbor/${leadId}/chat?c=${row.conversationId}`,
    optOutUrl,
  });
  // Свою ссылку отписки UniSender Go дописывает сам (его список); наша — /pochta/otpiska в подвале письма
  const ok = await sendMail(cfg, { to: lead.email, ...mail });
  // Не ушло — снимаем отметку: следующий повод (новая почта) попробует снова
  if (!ok) await release();
  return ok;
}

export interface EmailStats {
  /** Все заявки за период — для доли. */
  leads: number;
  /** Заявки за период, указавшие почту. */
  withEmail: number;
  /** Из них письмо с подробным разбором ушло. */
  sent: number;
  /** Из них отписались. */
  optedOut: number;
}

/** «Сводка» → «Почта»: по заявкам, созданным за период. */
export async function emailStats(db: Db, since: Date | null, until: Date | null = null): Promise<EmailStats> {
  const [row] = await db
    .select({
      leads: count(),
      withEmail: count(leads.email),
      sent: count(leads.emailFullTextSentAt),
      optedOut: count(leads.emailOptOutAt),
    })
    .from(leads)
    .where(within(leads.createdAt, since, until));
  return {
    leads: Number(row?.leads ?? 0),
    withEmail: Number(row?.withEmail ?? 0),
    sent: Number(row?.sent ?? 0),
    optedOut: Number(row?.optedOut ?? 0),
  };
}
