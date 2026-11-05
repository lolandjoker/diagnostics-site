/**
 * Выбор эксперта прямо в боте (/experts или кнопка «Выбрать эксперта»): карточка эксперта — плашка
 * (фото, имя, рейтинг, статус) с описанием, листается кнопками ◀ ▶ в том же сообщении (без новых
 * сообщений). «Написать» открывает чат с экспертом, как на сайте (startConversation: первый чат — только
 * с экспертом в сети), и дальше переписка идёт в боте: приветствие, подробный разбор, ответы.
 * Заявки ещё нет (не получал разбор) — сначала разбор в приложении бота.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations } from "@/db/schema";
import { splitExpertName } from "./bot-card";
import { chatContext, expertCard, forgetCardFile, remember, rememberCardFile, sendText, warmExpertCards } from "./bot-delivery";
import { em } from "./bot-emoji";
import { selectableExperts, startConversation } from "./chat";
import { formatRating, getExpert } from "./experts";
import { getLead } from "./leads";
import { expertReviews, reviewsCount, reviewsCountLabel } from "./reviews";
import { type BotButton, type TelegramConfig, botApi, botCall, esc, keyboard, leadForTelegramUser } from "./telegram";

const STATUS_LABEL = { online: "в сети", busy: "на консультации", offline: "не в сети" } as const;
/** Подпись к карточке — до 1024 символов; описание режем с запасом. */
const ABOUT_LIMIT = 600;

/** Эксперты для выбора в том же порядке, что на сайте: свободные, занятые, не в сети. */
async function expertList(db: Db, now: Date) {
  const order = { online: 0, busy: 1, offline: 2 } as const;
  return (await selectableExperts(db, now)).sort((a, b) => order[a.status] - order[b.status]);
}

interface Card {
  caption: string;
  buttons: (BotButton | BotButton[])[];
  expertId: number;
  /** Соседние карточки — их плашки рисуем заранее. */
  neighbors: number[];
}

async function expertCardView(db: Db, cfg: TelegramConfig, telegramUserId: number, index: number, now: Date): Promise<Card | null> {
  const [list, leadId] = await Promise.all([expertList(db, now), leadForTelegramUser(db, telegramUserId)]);
  if (list.length === 0) return null;
  const at = (k: number) => list[((k % list.length) + list.length) % list.length]!;
  const i = ((index % list.length) + list.length) % list.length;
  const e = list[i]!;
  const { name, role } = splitExpertName(e.name);
  const [reviewRows, chats] = await Promise.all([
    expertReviews(db, [e.id]),
    leadId ? db.select({ expertId: conversations.expertId }).from(conversations).where(eq(conversations.leadId, leadId)) : Promise.resolve([]),
  ]);
  const total = reviewsCount(e.reviewsShown, reviewRows.get(e.id)?.count ?? 0).total;
  const about = e.description.length > ABOUT_LIMIT ? `${e.description.slice(0, ABOUT_LIMIT).trimEnd()}…` : e.description;
  const caption = [
    `<b>${esc(name)}</b>${role ? ` · ${esc(role)}` : ""}`,
    `${em("star")}${formatRating(e.rating)}${total > 0 ? ` · ${reviewsCountLabel(total)}` : ""} · ${STATUS_LABEL[e.status]}`,
    about ? `\n${esc(about)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const chatWith = chats.some((x) => x.expertId === e.id);
  const nav: BotButton[] =
    list.length > 1
      ? [
          { text: "◀", callback: `ex:${i - 1}` },
          // Номер — просто подпись: нажатие ничего не меняет (и не перерисовывает карточку)
          { text: `${i + 1} из ${list.length}`, callback: "exn" },
          { text: "▶", callback: `ex:${i + 1}` },
        ]
      : [];
  const buttons: (BotButton | BotButton[])[] = [
    ...(nav.length ? [nav] : []),
    { text: chatWith ? "Продолжить чат" : "Написать эксперту", callback: `exw:${e.id}`, icon: "chat" },
    { text: "Профиль и отзывы", webApp: `${cfg.siteUrl}/ekspert/${e.id}${leadId ? `?lead=${leadId}` : ""}`, icon: "star" },
  ];
  const neighbors = list.length > 1 ? [...new Set([at(i + 1).id, at(i - 1).id])].filter((id) => id !== e.id) : [];
  return { caption, buttons, expertId: e.id, neighbors };
}

/**
 * Показать карточку эксперта номер index: новым сообщением или (messageId) — заменить в том же.
 * Плашка — по file_id, если уже загружена; не вышло заменить (сообщение старое или удалено) — новым сообщением.
 */
export async function showExperts(
  db: Db,
  cfg: TelegramConfig,
  chatId: number,
  telegramUserId: number,
  index: number,
  messageId?: number,
  now = new Date(),
): Promise<void> {
  const view = await expertCardView(db, cfg, telegramUserId, index, now);
  if (!view) {
    await sendText(cfg, chatId, "Сейчас нет доступных экспертов — загляните чуть позже.", []);
    return;
  }
  const card = await expertCard(db, view.expertId, now);
  if (!card) return;
  const upload = (field: string, data: Buffer) => ({ field, data, name: "expert.png", type: "image/png" });
  // Пока Telegram показывает эту карточку, соседние уже рисуются
  warmExpertCards(db, view.neighbors, now);

  let sent: unknown = null;
  if (messageId !== undefined) {
    const media = (photo: string) => ({ type: "photo", media: photo, caption: view.caption, parse_mode: "HTML" });
    const body = { chat_id: chatId, message_id: messageId, ...keyboard(view.buttons) };
    if (card.fileId) sent = await botCall(cfg.token, "editMessageMedia", { ...body, media: media(card.fileId) });
    if (!sent) {
      const png = await card.png();
      if (png) sent = await botCall(cfg.token, "editMessageMedia", { ...body, media: media("attach://card") }, upload("card", png));
    }
    if (sent) {
      rememberCardFile(card.key, sent);
      return;
    }
  }

  const fields = { chat_id: chatId, caption: view.caption, parse_mode: "HTML", ...keyboard(view.buttons) };
  if (card.fileId) sent = await botCall(cfg.token, "sendPhoto", { ...fields, photo: card.fileId });
  if (!sent) {
    if (card.fileId) forgetCardFile(card.key);
    const png = await card.png();
    if (png) sent = await botCall(cfg.token, "sendPhoto", fields, upload("photo", png));
  }
  rememberCardFile(card.key, sent);
}

/**
 * Нажали «Написать»: открыть чат с экспертом — переписка дальше в боте. answer — ответить на нажатие
 * (убрать «часики» с кнопки) сразу, как стало ясно, получилось ли; сообщения — уже после.
 */
export async function chooseExpertInBot(
  db: Db,
  cfg: TelegramConfig,
  chatId: number,
  telegramUserId: number,
  expertId: number,
  answer: (text: string) => Promise<unknown>,
  now = new Date(),
): Promise<void> {
  const leadId = await leadForTelegramUser(db, telegramUserId);
  const lead = leadId ? await getLead(db, leadId) : null;
  if (!lead) {
    await answer("");
    await sendText(cfg, chatId, `${em("moon")}Сначала получите бесплатный разбор по дате рождения — это минута. Потом эксперт напишет вам сюда.`, [
      { text: "Получить разбор", webApp: cfg.siteUrl, icon: "moon" },
    ]);
    return;
  }
  const res = await startConversation(db, lead, expertId, now);
  if (!res.ok) {
    await answer(res.error);
    return;
  }
  await answer("");
  const [ctx, expert] = await Promise.all([chatContext(db, cfg, res.conversation.id, now, true), getExpert(db, expertId)]);
  if (!ctx) return;
  const name = splitExpertName(expert?.name ?? "").name || "эксперт";
  const id = await sendText(
    cfg,
    chatId,
    `${em("chat")}Чат с экспертом <b>${esc(name)}</b> открыт. Напишите сообщение прямо сюда — эксперт ответит здесь же.`,
    [{ text: "Открыть чат на сайте", webApp: ctx.chatUrl, icon: "globe" }],
  );
  // Следующее сообщение человека уйдёт в этот чат
  await remember(db, cfg, ctx, id, { expertId, withButtons: true });
}

/**
 * Кнопки: «exl» — показать экспертов новым сообщением (кнопка под текстом), «ex:<номер>» — листать карточку,
 * «exn» — номер карточки (ничего не делает), «exw:<эксперт>» — написать. false — кнопка не отсюда.
 * На нажатие отвечаем сразу — кнопка не «висит», пока рисуется и меняется карточка.
 */
export async function handleExpertCallback(
  db: Db,
  cfg: TelegramConfig,
  q: { id: string; userId: number; chatId: number | null; messageId: number | null; data: string },
): Promise<boolean> {
  const page = /^ex:(-?\d{1,4})$/.exec(q.data);
  const write = /^exw:(\d{1,9})$/.exec(q.data);
  const list = q.data === "exl";
  const noop = q.data === "exn";
  if (!page && !write && !list && !noop) return false;
  const answer = (text: string) =>
    botApi(cfg.token, "answerCallbackQuery", { callback_query_id: q.id, ...(text && { text, show_alert: text.length > 40 }) });
  const chatId = q.chatId ?? q.userId;
  if (write) {
    await chooseExpertInBot(db, cfg, chatId, q.userId, Number(write[1]), answer);
    return true;
  }
  await answer("");
  if (list) await showExperts(db, cfg, chatId, q.userId, 0);
  if (page) await showExperts(db, cfg, chatId, q.userId, Number(page[1]), q.messageId ?? undefined);
  return true;
}
