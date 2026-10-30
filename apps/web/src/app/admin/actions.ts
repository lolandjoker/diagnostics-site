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
  setExpertBusy,
  setExpertPassword,
  setExpertStatus,
  setOnlineByAdmin,
} from "@/lib/experts";
import { NO_METHOD, VARIATION_MODES, deleteVariation, getVariation, saveVariationTexts, setVariationMode } from "@/lib/variations";
import type { VariationMode } from "@/lib/variations";
import { TEXT_DEFS, saveTexts } from "@/lib/texts";
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

// --- Варианты диагностики ---

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
  if (!title) return fail("Укажите название варианта");
  const [v] = await (await getDb()).insert(variations).values({ title, method: NO_METHOD }).returning();
  refresh();
  redirect(`/admin/variations/${v?.id}`);
}

export async function updateVariationAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireStaff();
  const db = await getDb();
  const id = int(form, "id");
  const variation = id === null ? null : await getVariation(db, id);
  if (!variation) return fail("Вариант не найден");
  const title = str(form, "title").trim();
  if (!title) return fail("Укажите название варианта");
  await db
    .update(variations)
    .set({ title, active: form.get("active") === "on" })
    .where(eq(variations.id, variation.id));

  await saveVariationTexts(db, variation.id, {
    shortText: str(form, "short_text").replace(/\r\n/g, "\n"),
    fullText: str(form, "full_text").replace(/\r\n/g, "\n"),
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
