/**
 * Отправка писем через SMTP. Настройки — в .env:
 *   SMTP_URL=smtps://логин:пароль@smtp.example.ru:465
 *   MAIL_FROM="Название <noreply@example.ru>"
 * Если SMTP не настроен, письма не уходят, а у заказа записывается причина.
 */
import nodemailer from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type Mailer = (msg: MailMessage) => Promise<void>;

let cached: Mailer | null | undefined;

/** Почтовый отправитель из настроек или null, если SMTP не настроен. */
export function smtpMailer(): Mailer | null {
  if (cached !== undefined) return cached;
  const url = process.env.SMTP_URL;
  const from = process.env.MAIL_FROM;
  if (!url || !from) {
    cached = null;
    return cached;
  }
  const transport = nodemailer.createTransport(url);
  cached = async (msg) => {
    await transport.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text });
  };
  return cached;
}
