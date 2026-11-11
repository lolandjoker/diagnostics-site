/**
 * Отправка писем через Web API UniSender Go (HTTPS): SMTP-порты (25, 465, 587, 2525) с нашего сервера в Timeweb
 * закрыты, а HTTPS открыт. Настройки в .env сервера:
 * - UNISENDER_GO_API_KEY — API-ключ (кабинет → API-ключ);
 * - UNISENDER_GO_API_URL — адрес API по кластеру кабинета; по умолчанию go2 (наш кабинет на go2.unisender.ru);
 * - MAIL_FROM — «Таромба <noreply@taromba.com>», домен подтверждён в UniSender Go (SPF, DKIM).
 * Чего-то нет — почта выключена: сайт работает, письма не уходят. Ошибки отправки не ломают сайт — пишем в журнал
 * и возвращаем false. UniSender сам дописывает в письмо ссылку отписки (global_language: ru) и не шлёт отписавшимся.
 */

export const DEFAULT_UNISENDER_GO_API_URL = "https://go2.unisender.ru/ru/transactional/api/v1";

export interface MailConfig {
  apiUrl: string;
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

/** «Имя <адрес>» или просто адрес. */
function parseFrom(raw: string): { name: string; email: string } | null {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>\s*$/.exec(raw) ?? /^\s*()([^<>\s]+@[^<>\s]+)\s*$/.exec(raw);
  return m ? { name: (m[1] ?? "").trim(), email: m[2]! } : null;
}

export function mailConfig(env: Record<string, string | undefined> = process.env): MailConfig | null {
  const apiKey = env.UNISENDER_GO_API_KEY?.trim();
  const from = parseFrom(env.MAIL_FROM ?? "");
  if (!apiKey || !from) return null;
  const apiUrl = (env.UNISENDER_GO_API_URL?.trim() || DEFAULT_UNISENDER_GO_API_URL).replace(/\/+$/, "");
  return { apiUrl, apiKey, fromEmail: from.email, fromName: from.name };
}

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Подмена отправки в тестах: получает письмо вместо запроса к UniSender. */
type Transport = { sendMail: (m: Mail & { from: string }) => Promise<unknown> };
const g = globalThis as unknown as { __diagMailTest?: Transport | null };

export function setMailTransport(transport: Transport | null): void {
  g.__diagMailTest = transport;
}

export async function sendMail(cfg: MailConfig, mail: Mail): Promise<boolean> {
  try {
    if (g.__diagMailTest) {
      await g.__diagMailTest.sendMail({ ...mail, from: cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail });
      return true;
    }
    const res = await fetch(`${cfg.apiUrl}/email/send.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-API-KEY": cfg.apiKey },
      body: JSON.stringify({
        message: {
          recipients: [{ email: mail.to }],
          subject: mail.subject,
          body: { html: mail.html, plaintext: mail.text },
          from_email: cfg.fromEmail,
          ...(cfg.fromName && { from_name: cfg.fromName }),
          global_language: "ru",
          // Ссылка в чат содержит id заявки — без переадресации через сервис; прочтения не считаем
          track_links: 0,
          track_read: 0,
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => null)) as { status?: string; failed_emails?: Record<string, string>; message?: string } | null;
    const failed = data?.failed_emails?.[mail.to];
    if (!res.ok || data?.status !== "success" || failed) {
      console.warn(`Письмо не ушло: ${res.status} ${failed ?? data?.message ?? ""}`.trim());
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`Письмо не ушло: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
