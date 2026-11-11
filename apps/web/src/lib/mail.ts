/**
 * Отправка писем по SMTP (сейчас — UniSender Go: smtp.go1.unisender.ru, логин — id пользователя, пароль — API-ключ).
 * Настройки в .env сервера: SMTP_HOST, SMTP_PORT (587 по умолчанию; 465 — сразу TLS), SMTP_USER, SMTP_PASS,
 * MAIL_FROM («Таромба <noreply@taromba.com>»). Чего-то нет — почта выключена: сайт работает, письма не уходят.
 * Ошибки отправки не ломают сайт — пишем в журнал и возвращаем false.
 */
import nodemailer from "nodemailer";

export interface MailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export function mailConfig(env: Record<string, string | undefined> = process.env): MailConfig | null {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.trim();
  const from = env.MAIL_FROM?.trim();
  if (!host || !user || !pass || !from) return null;
  const port = Number(env.SMTP_PORT?.trim() || 587);
  return { host, port: Number.isInteger(port) && port > 0 ? port : 587, user, pass, from };
}

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

/** Транспорт — один на процесс (globalThis): соединения переиспользуются. В тестах подменяется setMailTransport. */
type Transport = { sendMail: (m: object) => Promise<unknown> };
const state = (globalThis as unknown as { __diagMail?: { key: string; transport: Transport } | null }).__diagMail ?? null;
let current = state;

export function setMailTransport(transport: Transport | null): void {
  current = transport ? { key: "test", transport } : null;
  (globalThis as unknown as { __diagMail?: typeof current }).__diagMail = current;
}

function transportFor(cfg: MailConfig): Transport {
  if (current?.key === "test") return current.transport;
  const key = `${cfg.host}:${cfg.port}:${cfg.user}`;
  if (current?.key !== key) {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
      pool: true,
      maxConnections: 2,
    });
    current = { key, transport };
    (globalThis as unknown as { __diagMail?: typeof current }).__diagMail = current;
  }
  return current.transport;
}

export async function sendMail(cfg: MailConfig, mail: Mail): Promise<boolean> {
  try {
    await transportFor(cfg).sendMail({ from: cfg.from, ...mail });
    return true;
  } catch (err) {
    console.warn(`Письмо не ушло: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
