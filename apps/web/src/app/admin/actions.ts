"use server";

/**
 * Действия админки. Каждое начинается с проверки входа: действие — это POST-запрос,
 * отправить его может кто угодно, а не только тот, кто видит форму.
 * requireStaff — админ или эксперт (у эксперта права админа); requireAdmin — только админ («Тексты сайта»).
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { experts, variations } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { addReview, deleteReviews, setReviewBody, setReviewHidden, setReviewVerified } from "@/lib/reviews";
import { addCertificates, deleteCertificate, setCertificateTitle } from "@/lib/certificates";
import { addGalleryPhotos, deleteGalleryPhoto, deleteMainPhoto, makeMainPhoto } from "@/lib/gallery";
import { createOperator, deleteOperator, setOperatorActive, setOperatorPassword } from "@/lib/operators";
import { requireStaff } from "@/lib/staff-auth";
import {
  ADMIN_ONLINE_FOREVER,
  adminOnlineMs,
  createExpert,
  deleteExpert,
  expertTags,
  getExpert,
  parseRating,
  parseReviewsShown,
  saveExpertPhoto,
  setExpertArchived,
  setExpertFullText,
  setExpertBusy,
  setExpertPassword,
  setExpertStatus,
  setOnlineByAdmin,
} from "@/lib/experts";
import { NO_METHOD, VARIATION_MODES, deleteVariation, getVariation, getVariationTexts, saveVariationTexts, setVariationMode } from "@/lib/variations";
import type { VariationMode } from "@/lib/variations";
import { TEXT_DEFS, saveTexts } from "@/lib/texts";
import { startExpertBroadcast, testExpertBroadcast } from "@/lib/expert-broadcasts";
import {
  type BroadcastFilters,
  type BroadcastMessage,
  MAX_BROADCAST_MESSAGES,
  hasLead,
  isAudience,
  isPersonalPage,
  mediaKind,
  hasEmail,
  hasEmailLead,
  hasTelegram,
  isChannels,
  mailEnv,
  sendTestBroadcast,
  sendTestEmail,
  startBroadcast,
  validateBroadcast,
} from "@/lib/broadcasts";
import { normalizeEmail } from "@/lib/lead-email";
import { telegramConfig } from "@/lib/telegram";
import type { TextKey } from "@/lib/texts";
import type { ActionResult } from "./ActionForm";

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

const int = (form: FormData, key: string): number | null => {
  const s = str(form, key).trim();
  return /^-?\d{1,9}$/.test(s) ? Number(s) : null;
};

/** Отмеченные галочками в списке: все значения ids (см. BulkDelete). */
const ids = (form: FormData): number[] =>
  form
    .getAll("ids")
    .filter((v): v is string => typeof v === "string" && /^\d{1,9}$/.test(v))
    .map(Number);

/** Выбранные в поле файлы (пустое поле браузер присылает как один пустой файл — его отбрасываем). */
async function files(form: FormData, key: string): Promise<Buffer[]> {
  const list = form.getAll(key).filter((f): f is File => f instanceof File && f.size > 0);
  return Promise.all(list.map(async (f) => Buffer.from(await f.arrayBuffer())));
}

const fail = (message: string): ActionResult => ({ ok: false, message });
const done = (message: string): ActionResult => ({ ok: true, message });

function refresh() {
  revalidatePath("/", "layout");
}

// --- Операторы чатов (только админ) ---

export async function createOperatorAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const res = await createOperator(await getDb(), {
    name: str(form, "name"),
    login: str(form, "login"),
    password: str(form, "password"),
  });
  if (!res.ok) return fail(res.error);
  refresh();
  return done("Оператор добавлен — логин и пароль передайте ему, вход: /operator/login");
}

export async function setOperatorActiveAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = int(form, "id");
  if (id !== null) await setOperatorActive(await getDb(), id, form.get("active") === "true");
  refresh();
}

export async function setOperatorPasswordAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = int(form, "id");
  if (id === null) return fail("Оператор не найден");
  const error = await setOperatorPassword(await getDb(), id, str(form, "password"));
  if (error) return fail(error);
  return done("Пароль сменён, прежние входы завершены");
}

export async function deleteOperatorAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = int(form, "id");
  if (id !== null && form.get("confirm") === "on") await deleteOperator(await getDb(), id, new Date());
  refresh();
}

// --- Рассылки в Telegram-бот (только админ) ---

/** Серия из формы рассылки: body_0…body_N и файлы media_0…media_N (BroadcastComposer); ошибка — текстом. */
async function broadcastMessages(form: FormData): Promise<BroadcastMessage[] | string> {
  const count = Math.min(Math.max(int(form, "messages_count") ?? 1, 1), MAX_BROADCAST_MESSAGES + 1);
  const messages: BroadcastMessage[] = [];
  for (let i = 0; i < count; i++) {
    const file = form.get(`media_${i}`);
    const message: BroadcastMessage = { body: str(form, `body_${i}`) };
    if (file instanceof File && file.size > 0) {
      const media = mediaKind(file.type);
      if (!media) return `Сообщение ${i + 1}: подойдут фото JPG, PNG, WebP или видео MP4, MOV`;
      message.media = { kind: media, data: Buffer.from(await file.arrayBuffer()), name: file.name || media, type: file.type };
    }
    messages.push(message);
  }
  return messages;
}

/** Условия рассылки из формы: галочка и число часов. */
function broadcastFilters(form: FormData): BroadcastFilters {
  const hours = (key: string) => (form.get(`${key}_on`) === "on" ? (int(form, `${key}_hours`) ?? 0) : undefined);
  return { registeredHours: hours("registered"), silentHours: hours("silent") };
}

/** Рассылка от экспертов: каждому — в его чат с экспертом и оттуда в Telegram. */
export async function expertBroadcastAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const messages = await broadcastMessages(form);
  if (typeof messages === "string") return fail(messages);
  const audience = str(form, "audience");
  const expert = int(form, "expert");
  const input = {
    audience: isAudience(audience) ? audience : ("all" as const),
    filters: broadcastFilters(form),
    expertId: expert !== null && expert > 0 ? expert : undefined,
    messages,
  };
  const error = validateBroadcast({ ...input, body: messages[0]!.body, buttonText: "", buttonUrl: "", gift: false });
  if (error) return fail(error);
  const db = await getDb();
  const testId = str(form, "test_id").trim();
  if (testId) {
    if (!/^\d{3,15}$/.test(testId)) return fail("Telegram ID — только цифры");
    const res = await testExpertBroadcast(db, Number(testId), input);
    if (res === "no-chat") {
      return fail(
        input.expertId
          ? "У этого Telegram нет чата с выбранным экспертом. Откройте чат с ним на сайте или выберите «Всем»"
          : "У этого Telegram нет чата с экспертом — подключите Telegram к своей заявке и откройте чат",
      );
    }
    return res === "ok"
      ? done("Проба отправлена в ваш чат и в Telegram. Сообщения пробы остались в чате — их можно удалить там. Чтобы разослать всем, сотрите ID.")
      : fail("Не получилось записать сообщение в чат");
  }
  if (form.get("confirm") !== "on") return fail("Отметьте «Отправить» — или впишите свой Telegram ID для пробы");
  const { total } = await startExpertBroadcast(db, input);
  refresh();
  return done(`Рассылка началась: ${total} чатов. Обновите страницу, чтобы увидеть, сколько ушло.`);
}

/** Системная рассылка: в Telegram-бот и/или на почту (channels). */
export async function broadcastAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const ch = str(form, "channels");
  const channels = isChannels(ch) ? ch : "telegram";
  const cfg = telegramConfig();
  const mail = mailEnv();
  if (hasTelegram(channels) && !cfg) return fail("Telegram-бот не подключён — выберите «Почта»");
  if (hasEmail(channels) && !mail) return fail("Почта не настроена — выберите «Telegram»");
  const audience = str(form, "audience");
  // Кнопка: "" — нет, url — своя ссылка, иначе — личный раздел (PERSONAL_PAGES)
  const kind = str(form, "button_kind");
  const messages = await broadcastMessages(form);
  if (typeof messages === "string") return fail(messages);
  const input = {
    audience: isAudience(audience) ? audience : ("all" as const),
    personalPage: isPersonalPage(kind) ? kind : undefined,
    personalText: isPersonalPage(kind) ? str(form, "button_label") : "",
    body: messages[0]!.body,
    messages,
    filters: broadcastFilters(form),
    buttonText: kind === "url" ? str(form, "button_label") : "",
    buttonUrl: kind === "url" ? str(form, "button_url") : "",
    gift: form.get("gift") === "on",
    channels,
    subject: str(form, "subject"),
    emailSkipTelegram: form.get("email_skip_tg") === "on",
  };
  const error = validateBroadcast(input);
  if (error) return fail(error);
  // Проба: только в те каналы, что выбраны и для которых вписан адрес
  const testId = hasTelegram(channels) ? str(form, "test_id").trim() : "";
  const rawEmail = hasEmail(channels) ? str(form, "test_email").trim() : "";
  if (testId || rawEmail) {
    const db = await getDb();
    const sentTo: string[] = [];
    if (testId) {
      if (!/^\d{3,15}$/.test(testId)) return fail("Telegram ID — только цифры");
      if (input.personalPage && !(await hasLead(db, Number(testId)))) {
        return fail("У этого Telegram нет заявки — личной кнопке некуда вести. Подключите Telegram к своей заявке на сайте или пробуйте без личной кнопки");
      }
      if (!(await sendTestBroadcast(db, cfg!, Number(testId), input))) return fail("Не ушло в Telegram: этот человек ещё не открывал бота или заблокировал его");
      sentTo.push("в Telegram");
    }
    if (rawEmail) {
      const email = normalizeEmail(rawEmail);
      if (!email) return fail("Проверьте адрес почты для пробы");
      if (input.personalPage && !(await hasEmailLead(db, email))) {
        return fail("С этой почтой нет заявки — личной кнопке некуда вести. Укажите почту в своей заявке на сайте или пробуйте без личной кнопки");
      }
      if (!(await sendTestEmail(db, mail!, email, input))) {
        return fail(`${sentTo.length ? "В Telegram ушло, а письмо" : "Письмо"} не ушло — подробности в журнале сайта`);
      }
      sentTo.push("на почту");
    }
    return done(`Проба отправлена ${sentTo.join(" и ")} — посмотрите. Чтобы разослать всем, очистите поля пробы.`);
  }
  if (form.get("confirm") !== "on") return fail("Отметьте «Отправить» — или впишите свой Telegram ID или почту для пробы");
  const { total, emailTotal } = await startBroadcast(await getDb(), cfg, input, mail);
  refresh();
  const who = [hasTelegram(channels) && `${total} в Telegram`, hasEmail(channels) && `${emailTotal} на почту`].filter(Boolean).join(", ");
  return done(`Рассылка началась: ${who}. Обновите страницу, чтобы увидеть, сколько ушло.`);
}

// --- Тексты сайта ---

export async function saveTextsAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const values: Partial<Record<TextKey, string>> = {};
  for (const def of TEXT_DEFS) {
    const v = form.get(def.key);
    if (typeof v === "string") values[def.key] = v.replace(/\r\n/g, "\n").trim();
  }
  const error = await saveTexts(await getDb(), values);
  if (error) return fail(error);
  refresh();
  return done("Сохранено");
}

// --- Краткие диагностики (в базе — варианты) ---

export async function setVariationModeAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireStaff();
  const mode = str(form, "mode");
  if (!(mode in VARIATION_MODES)) return fail("Выберите способ");
  await setVariationMode(await getDb(), mode as VariationMode);
  refresh();
  return done("Сохранено");
}

export async function createVariationAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireStaff();
  const title = str(form, "title").trim();
  if (!title) return fail("Укажите название диагностики");
  const [v] = await (await getDb()).insert(variations).values({ title, method: NO_METHOD }).returning();
  refresh();
  redirect(`/admin/variations/${v?.id}`);
}

export async function updateVariationAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireStaff();
  const db = await getDb();
  const id = int(form, "id");
  const variation = id === null ? null : await getVariation(db, id);
  if (!variation) return fail("Диагностика не найдена");
  const title = str(form, "title").trim();
  if (!title) return fail("Укажите название диагностики");
  await db
    .update(variations)
    .set({ title, active: form.get("active") === "on" })
    .where(eq(variations.id, variation.id));

  await saveVariationTexts(db, variation.id, {
    shortText: str(form, "short_text").replace(/\r\n/g, "\n"),
    // Текст 2 больше не показывается (подробная диагностика — у экспертов), прежний сохраняем как есть
    fullText: (await getVariationTexts(db, variation.id)).fullText,
  });
  refresh();
  return done("Сохранено");
}

// --- Эксперты ---

export async function createExpertAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireStaff();
  const res = await createExpert(await getDb(), {
    name: str(form, "name"),
    login: str(form, "login"),
    password: str(form, "password"),
  });
  if (!res.ok) return fail(res.error);
  refresh();
  redirect(`/admin/experts/${res.id}`);
}

/** «В сети» на выбранный срок, навсегда (пока не выключат) или выключить — за эксперта. */
export async function setExpertOnlineAction(form: FormData): Promise<void> {
  await requireStaff();
  const id = int(form, "id");
  if (id === null) return;
  if (form.get("online") === "true") {
    if (str(form, "unit") === ADMIN_ONLINE_FOREVER) {
      await setExpertStatus(await getDb(), id, "online", new Date());
    } else {
      // Срок вне пределов — ничего не меняем; поле в форме не даст ввести такой
      const ms = adminOnlineMs(str(form, "amount"), str(form, "unit"));
      if (ms !== null) await setOnlineByAdmin(await getDb(), id, ms, new Date());
    }
  } else {
    await setOnlineByAdmin(await getDb(), id, null, new Date());
  }
  refresh();
}

/** «Занят» / «свободен» — за эксперта; как и на сколько он в сети, не меняется. */
export async function setExpertBusyAction(form: FormData): Promise<void> {
  await requireStaff();
  const id = int(form, "id");
  if (id !== null) await setExpertBusy(await getDb(), id, form.get("busy") === "true");
  refresh();
}

export async function updateExpertAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireStaff();
  const db = await getDb();
  const id = int(form, "id");
  const expert = id === null ? null : await getExpert(db, id);
  if (!expert) return fail("Эксперт не найден");
  const name = str(form, "name").trim();
  if (!name) return fail("Укажите имя эксперта");
  const rating = parseRating(str(form, "rating"));
  if (rating === null) return fail("Рейтинг — число от 1,0 до 5,0, например 4,8");
  const reviewsShown = parseReviewsShown(str(form, "reviews_shown"));
  if (reviewsShown === null) return fail("Отзывов с других площадок — целое от 0 до 100 000");

  const password = str(form, "password");
  if (password !== "") {
    const error = await setExpertPassword(db, expert.id, password);
    if (error) return fail(error);
  }
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const error = await saveExpertPhoto(db, expert.id, Buffer.from(await photo.arrayBuffer()));
    if (error) return fail(error);
  }
  const active = form.get("active") === "on";
  await db
    .update(experts)
    .set({
      name,
      description: str(form, "description").replace(/\r\n/g, "\n").trim(),
      about: str(form, "about").replace(/\r\n/g, "\n").trim(),
      tags: expertTags(str(form, "tags")).join(", "),
      sort: int(form, "sort") ?? expert.sort,
      rating,
      reviewsShown,
      active,
      // Выключенный эксперт сразу пропадает из выбора
      ...(!active && { online: false, onlineUntil: null }),
    })
    .where(eq(experts.id, expert.id));
  refresh();
  return done(password ? "Сохранено, пароль изменён — эксперту нужно войти заново" : "Сохранено");
}

// --- Удаление (с галочкой подтверждения в форме) ---

/** Удалить эксперта: не входит и не виден клиентам; его старые чаты и сообщения остаются. */
/** Подробная диагностика эксперта — приходит в чат с ним. */
export async function setExpertFullTextAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireStaff();
  const id = int(form, "id");
  if (id === null) return fail("Эксперт не найден");
  const error = await setExpertFullText(await getDb(), id, str(form, "full_text"));
  if (error) return fail(error);
  refresh();
  return done("Диагностика сохранена");
}

/** В архив / из архива: в архиве эксперт скрыт от клиентов полностью, вместе с его чатами. */
export async function setExpertArchivedAction(form: FormData): Promise<void> {
  await requireStaff();
  const id = int(form, "id");
  if (id !== null) await setExpertArchived(await getDb(), id, form.get("archived") === "true", new Date());
  refresh();
}

export async function deleteExpertAction(form: FormData): Promise<void> {
  await requireStaff();
  const id = int(form, "id");
  if (id !== null && form.get("confirm") === "on") await deleteExpert(await getDb(), id, new Date());
  refresh();
  redirect("/admin/experts");
}

/** Удалить вариант диагностики: новым людям не выдаётся; кому уже достался — тексты остаются. */
export async function deleteVariationAction(form: FormData): Promise<void> {
  await requireStaff();
  const id = int(form, "id");
  if (id !== null && form.get("confirm") === "on") await deleteVariation(await getDb(), id, new Date());
  refresh();
  redirect("/admin/variations");
}

// --- Отзывы ---

export async function setReviewHiddenAction(form: FormData): Promise<void> {
  await requireStaff();
  const id = int(form, "id");
  if (id !== null) await setReviewHidden(await getDb(), id, form.get("hidden") === "true");
  refresh();
}

/** «Проверенный пользователь» — сотрудник по переписке убедился, что автор живой человек. */
export async function setReviewVerifiedAction(form: FormData): Promise<void> {
  await requireStaff();
  const id = int(form, "id");
  if (id !== null) await setReviewVerified(await getDb(), id, form.get("verified") === "true", new Date());
  refresh();
}

export async function setReviewBodyAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireStaff();
  const id = int(form, "id");
  if (id === null) return fail("Отзыв не найден");
  const error = await setReviewBody(await getDb(), id, str(form, "body"));
  if (error) return fail(error);
  refresh();
  return done("Сохранено");
}

/** Удалить отмеченные отзывы. */
export async function deleteReviewsAction(form: FormData): Promise<void> {
  await requireStaff();
  await deleteReviews(await getDb(), ids(form));
  refresh();
}

/** Отзыв из админки: эксперт, имя автора, звёзды, текст, дата (ГГГГ-ММ-ДД из поля даты; время — полдень по Москве). */
export async function addReviewAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireStaff();
  const expertId = int(form, "expert_id");
  if (expertId === null) return fail("Выберите эксперта");
  const day = str(form, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail("Укажите дату");
  const res = await addReview(await getDb(), {
    expertId,
    authorName: str(form, "author"),
    stars: int(form, "stars") ?? 0,
    body: str(form, "body"),
    createdAt: new Date(`${day}T12:00:00+03:00`),
  });
  if (!res.ok) return fail(res.error);
  refresh();
  return done("Отзыв добавлен");
}

// --- Сертификаты эксперта ---

export async function addCertificateAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireStaff();
  const expertId = int(form, "expert_id");
  if (expertId === null) return fail("Эксперт не найден");
  const list = await files(form, "file");
  const error = await addCertificates(await getDb(), expertId, str(form, "title"), list);
  if (error) return fail(error);
  refresh();
  return done(list.length > 1 ? `Добавлено сертификатов: ${list.length}` : "Сертификат добавлен");
}

export async function setCertificateTitleAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireStaff();
  const expertId = int(form, "expert_id");
  const id = int(form, "id");
  if (expertId === null || id === null) return fail("Сертификат не найден");
  const error = await setCertificateTitle(await getDb(), expertId, id, str(form, "title"));
  if (error) return fail(error);
  refresh();
  return done("Подпись сохранена");
}

/** Удалить отмеченные сертификаты. */
export async function deleteCertificatesAction(form: FormData): Promise<void> {
  await requireStaff();
  const expertId = int(form, "expert_id");
  const db = await getDb();
  if (expertId !== null) for (const id of ids(form)) await deleteCertificate(db, expertId, id);
  refresh();
}

// --- Фото эксперта: главное и дополнительные ---

export async function addGalleryPhotosAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireStaff();
  const expertId = int(form, "expert_id");
  if (expertId === null) return fail("Эксперт не найден");
  const list = await files(form, "photos");
  const error = await addGalleryPhotos(await getDb(), expertId, list);
  if (error) return fail(error);
  refresh();
  return done(list.length > 1 ? `Добавлено фото: ${list.length}` : "Фото добавлено");
}

export async function makeMainPhotoAction(form: FormData): Promise<void> {
  await requireStaff();
  const expertId = int(form, "expert_id");
  const id = int(form, "id");
  if (expertId !== null && id !== null) await makeMainPhoto(await getDb(), expertId, id);
  refresh();
}

/**
 * Удалить отмеченные фото; main — отмечено и главное. Сначала дополнительные: на место удалённого
 * главного встанет первое из оставшихся, а не то, что тоже отмечено.
 */
export async function deletePhotosAction(form: FormData): Promise<void> {
  await requireStaff();
  const expertId = int(form, "expert_id");
  if (expertId === null) return;
  const db = await getDb();
  for (const id of ids(form)) await deleteGalleryPhoto(db, expertId, id);
  if (form.get("main") === "on") await deleteMainPhoto(db, expertId);
  refresh();
}
