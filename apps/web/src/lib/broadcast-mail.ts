/**
 * Письмо системной рассылки (lib/broadcasts.ts, канал «почта»): та же серия, что уходит в Telegram, одним письмом —
 * сообщения по порядку, фото картинкой, видео — кнопкой «Смотреть видео» (почтовые программы видео не играют),
 * внизу кнопки рассылки (личная — на страницу человека на сайте) и «Отписаться». Разметка текста та же: **жирный**.
 * Файлы лежат в chat_media и открываются по адресу /api/chat/media/<id>.
 */

export interface MailPart {
  body: string;
  media?: { kind: "photo" | "video"; url: string } | undefined;
}

export interface BroadcastMailInput {
  subject: string;
  parts: MailPart[];
  /** Значок подарка в начале. */
  gift: boolean;
  buttons: { text: string; url: string }[];
  /** Ссылка «Отписаться»; null — у адреса нет заявки (проба на чужую почту). */
  optOutUrl: string | null;
}

export const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const paragraphs = (body: string) =>
  body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

/** Абзац: экранирование, **жирный**, переносы строк. */
const paragraphHtml = (p: string) =>
  `<p style="margin:0 0 14px">${escHtml(p)
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br>")}</p>`;

const button = (text: string, url: string) =>
  `<p style="margin:14px 0 6px"><a href="${escHtml(url)}" style="display:inline-block;padding:13px 26px;border-radius:999px;background:#8a6a1f;color:#ffffff;text-decoration:none;font-weight:bold">${escHtml(text)}</a></p>`;

export function broadcastMail(input: BroadcastMailInput): { subject: string; html: string; text: string } {
  const parts = input.parts.map((p, i) => ({ ...p, body: i === 0 && input.gift && p.body.trim() ? `🎁 ${p.body.trim()}` : p.body }));
  const blocks = parts.map((p) => {
    const media = !p.media
      ? ""
      : p.media.kind === "photo"
        ? `<p style="margin:0 0 14px"><img src="${escHtml(p.media.url)}" alt="" width="512" style="display:block;width:100%;max-width:512px;height:auto;border:0;border-radius:12px"></p>`
        : `<p style="margin:0 0 14px"><a href="${escHtml(p.media.url)}" style="display:inline-block;padding:11px 22px;border-radius:999px;border:1px solid #8a6a1f;color:#8a6a1f;text-decoration:none;font-weight:bold">▶ Смотреть видео</a></p>`;
    return media + paragraphs(p.body).map(paragraphHtml).join("\n");
  });
  const footer = input.optOutUrl
    ? `Вы получили это письмо, потому что указали эту почту на сайте Таромба.
<a href="${escHtml(input.optOutUrl)}" style="color:#8a8294">Отписаться</a>`
    : "Вы получили это письмо, потому что указали эту почту на сайте Таромба.";
  const html = `<!doctype html><html lang="ru"><body style="margin:0;padding:0;background:#f6f4f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4f9;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:28px 24px;font-family:Arial,Helvetica,sans-serif;color:#2a2233;line-height:1.55;font-size:16px">
<tr><td>
<p style="margin:0 0 14px;color:#8a6a1f;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Таромба</p>
${blocks.join('\n<div style="height:10px"></div>\n')}
${input.buttons.map((b) => button(b.text, b.url)).join("\n")}
</td></tr></table>
<p style="max-width:560px;margin:14px auto 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8294;line-height:1.5">
${footer}</p>
</td></tr></table></body></html>`;
  const text = [
    ...parts.flatMap((p) => [
      ...(p.media ? [p.media.kind === "photo" ? `Фото: ${p.media.url}` : `Видео: ${p.media.url}`, ""] : []),
      ...paragraphs(p.body).flatMap((x) => [x.replace(/\*\*([^*\n]+)\*\*/g, "$1"), ""]),
    ]),
    ...input.buttons.flatMap((b) => [`${b.text}: ${b.url}`, ""]),
    ...(input.optOutUrl ? [`Отписаться: ${input.optOutUrl}`] : []),
  ]
    .join("\n")
    .trim();
  return { subject: input.subject.trim(), html, text };
}
