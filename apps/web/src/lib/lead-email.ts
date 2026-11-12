/**
 * Почта клиента для уведомлений. Человек указывает её перед чатом с экспертом (или в окне «Подключите Telegram»).
 * Письма:
 * - «Подробный разбор готов» с текстом разбора и кнопкой в чат;
 * - «Вам написал эксперт» — на каждое сообщение эксперта (или админа, оператора от его имени), если клиент за
 *   MESSAGE_EMAIL_DELAY_MS не ответил и не открыл чат на сайте (deliverDueMessageEmails). Автоматические
 *   (приветствие, рассылки от экспертов) и сам разбор так не уходят. Старше MESSAGE_EMAIL_WINDOW_MS не догоняем
 *   (после перезапуска не шлём пачку старых).
 * - Письмо одно на заявку (leads.email_full_text_sent_at; отметка одним UPDATE — два опроса не отправят дважды).
 * - Почту указали, когда разбор уже пришёл, — письмо уходит сразу.
 * - В каждом письме — «Отписаться» (ссылка с подписью SESSION_SECRET): после неё не пишем; новая почта в окне
 *   снова подписывает. Ещё одну ссылку отписки дописывает UniSender Go — отписавшимся там он сам не шлёт.
 * - Почта выключена (lib/mail.ts) — адрес сохраняем, письмо не уходит и не отмечается.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
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

/** Через сколько после сообщения эксперта без ответа клиента — письмо. */
export const MESSAGE_EMAIL_DELAY_MS = 2 * 60 * 1000;
/** Сообщения старше — без письма (сайт лежал, письмо уже не к месту). */
export const MESSAGE_EMAIL_WINDOW_MS = 30 * 60 * 1000;
/** Писем за один проход — не больше. */
const MESSAGE_EMAIL_BATCH = 50;

/** Письмо «Вам написал эксперт»: текст сообщения, кнопка в чат, отписка. Пустой текст — фото или предложение. */
export function messageNoticeMail(input: { name: string; expertName: string; body: string; chatUrl: string; optOutUrl: string }) {
  const paragraphs = input.body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const first = input.name.trim().split(/\s+/)[0] ?? "";
  const expert = input.expertName;
  const content = paragraphs.length
    ? paragraphs.map((p) => `<p style="margin:0 0 12px">${escHtml(p).replace(/\n/g, "<br>")}</p>`).join("\n")
    : `<p style="margin:0 0 12px">Эксперт отправил вам фото или предложение — откройте чат, чтобы посмотреть.</p>`;
  const html = `<!doctype html><html lang="ru"><body style="margin:0;padding:0;background:#f6f4f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4f9;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:28px 24px;font-family:Arial,Helvetica,sans-serif;color:#2a2233;line-height:1.55;font-size:16px">
<tr><td>
<p style="margin:0 0 4px;color:#8a6a1f;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Таромба</p>
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3">${first ? `${escHtml(first)}, в` : "В"}ам написал эксперт ${escHtml(expert)}</h1>
<div style="margin:0 0 6px;padding:14px 16px;border-left:3px solid #8a6a1f;background:#faf7ef;border-radius:0 12px 12px 0">
${content}
</div>
<p style="margin:20px 0 6px"><a href="${escHtml(input.chatUrl)}" style="display:inline-block;padding:13px 26px;border-radius:999px;background:#8a6a1f;color:#ffffff;text-decoration:none;font-weight:bold">Ответить эксперту</a></p>
</td></tr></table>
<p style="max-width:560px;margin:14px auto 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8294;line-height:1.5">
Вы получили это письмо, потому что указали эту почту в чате на сайте Таромба.
<a href="${escHtml(input.optOutUrl)}" style="color:#8a8294">Отписаться</a></p>
</td></tr></table></body></html>`;
  const text = [
    `${first ? `${first}, в` : "В"}ам написал эксперт ${expert}`,
    "",
    ...(paragraphs.length ? paragraphs.flatMap((p) => [p, ""]) : ["Эксперт отправил вам фото или предложение — откройте чат, чтобы посмотреть.", ""]),
    `Ответить эксперту: ${input.chatUrl}`,
    "",
    `Отписаться: ${input.optOutUrl}`,
  ].join("\n");
  return { subject: `Вам написал эксперт ${expert}`, html, text };
}

/**
 * Письма «Вам написал эксперт», которым пора: сообщение эксперта старше MESSAGE_EMAIL_DELAY_MS (но не старше
 * окна), после него клиент не писал в этот чат и не открывал его на сайте, у заявки есть почта, без отписки
 * и блокировки. Сообщение отмечается одним UPDATE до отправки — два прохода не отправят дважды; не ушло —
 * не повторяем (адрес мог отказать навсегда). Сколько писем ушло.
 */
export async function deliverDueMessageEmails(db: Db, now: Date, cfg: MailConfig | null = mailConfig()): Promise<number> {
  const site = siteUrl();
  const secret = process.env.SESSION_SECRET;
  if (!cfg || !site || !secret) return 0;
  const before = new Date(now.getTime() - MESSAGE_EMAIL_DELAY_MS).toISOString();
  const after = new Date(now.getTime() - MESSAGE_EMAIL_WINDOW_MS).toISOString();
  const due = await db.execute<{ id: number }>(sql`
    update messages set email_notified_at = ${now.toISOString()}::timestamptz
    where id in (
      select m.id from messages m
      join conversations c on c.id = m.conversation_id
      join leads l on l.id = c.lead_id
      where m.email_notified_at is null and m.author in ('expert', 'admin') and m.automatic = false
        and m.created_at <= ${before}::timestamptz and m.created_at > ${after}::timestamptz
        and l.email is not null and l.email_opt_out_at is null and l.blocked_at is null
        and (c.client_read_at is null or c.client_read_at < m.created_at)
        and not exists (select 1 from messages r where r.conversation_id = m.conversation_id and r.author = 'client' and r.id > m.id)
      order by m.id
      limit ${MESSAGE_EMAIL_BATCH}
    ) and email_notified_at is null
    returning id`);
  const ids = (Array.isArray(due) ? due : (due as { rows: { id: number }[] }).rows).map((r) => Number(r.id)).sort((a, b) => a - b);
  let sent = 0;
  for (const id of ids) {
    const [row] = await db
      .select({
        body: messages.body,
        conversationId: conversations.id,
        leadId: leads.id,
        name: leads.name,
        email: leads.email,
        expertName: experts.name,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .innerJoin(experts, eq(experts.id, conversations.expertId))
      .where(eq(messages.id, id));
    if (!row?.email) continue;
    const mail = messageNoticeMail({
      name: row.name,
      expertName: row.expertName.split("|")[0]!.trim(),
      body: row.body,
      chatUrl: `${site}/razbor/${row.leadId}/chat?c=${row.conversationId}`,
      optOutUrl: `${site}/pochta/otpiska?t=${optOutCode(secret, row.leadId)}`,
    });
    if (await sendMail(cfg, { to: row.email, ...mail })) sent++;
  }
  return sent;
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
