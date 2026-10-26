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
import { deleteReview, setReviewHidden } from "@/lib/reviews";
import { requireStaff } from "@/lib/staff-auth";
import {
  ADMIN_ONLINE_FOREVER,
  adminOnlineMs,
  createExpert,
  deleteExpert,
  getExpert,
  parseRating,
  saveExpertPhoto,
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

const fail = (message: string): ActionResult => ({ ok: false, message });
const done = (message: string): ActionResult => ({ ok: true, message });

function refresh() {
  revalidatePath("/", "layout");
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
      sort: int(form, "sort") ?? expert.sort,
      rating,
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

export async function deleteReviewAction(form: FormData): Promise<void> {
  await requireStaff();
  const id = int(form, "id");
  if (id !== null && form.get("confirm") === "on") await deleteReview(await getDb(), id);
  refresh();
}
