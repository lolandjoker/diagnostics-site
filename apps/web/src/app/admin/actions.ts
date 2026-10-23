"use server";

/**
 * Действия админки. Каждое начинается с requireAdmin(): действие — это POST-запрос,
 * отправить его может кто угодно, а не только тот, кто видит форму.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { diagnosticBlocks, experts, priceVariants, products, variations } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { getBlock, getMethod, saveBlockTexts } from "@/lib/diagnostic";
import { createExpert, getExpert, saveExpertPhoto, setExpertPassword, setOnlineByAdmin } from "@/lib/experts";
import { VARIATION_MODES, getVariation, saveVariationTexts, setVariationMode } from "@/lib/variations";
import type { VariationMode } from "@/lib/variations";
import { smtpMailer } from "@/lib/mail";
import { parseRub } from "@/lib/offers";
import { cancelOrder, markPaid, sendOrderEmail } from "@/lib/orders";
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

// --- Блоки разбора ---

export async function createBlockAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const title = str(form, "title").trim();
  const method = str(form, "method");
  if (!title) return fail("Укажите заголовок блока");
  if (!getMethod(method)) return fail("Выберите способ расчёта");
  const [block] = await (await getDb()).insert(diagnosticBlocks).values({ title, method, sort: int(form, "sort") ?? 0 }).returning();
  refresh();
  redirect(`/admin/diagnostic/${block?.id}`);
}

export async function updateBlockAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const db = await getDb();
  const id = int(form, "id");
  const block = id === null ? null : await getBlock(db, id);
  if (!block) return fail("Блок не найден");
  const title = str(form, "title").trim();
  if (!title) return fail("Укажите заголовок блока");

  await db
    .update(diagnosticBlocks)
    .set({ title, sort: int(form, "sort") ?? block.sort, active: form.get("active") === "on" })
    .where(eq(diagnosticBlocks.id, block.id));

  // Тексты — только для значений, которые вообще может дать расчёт этого блока
  const method = getMethod(block.method);
  const bodies = new Map<number, string>();
  for (const value of method?.values ?? []) {
    const v = form.get(`value_${value}`);
    if (typeof v === "string") bodies.set(value, v.replace(/\r\n/g, "\n"));
  }
  await saveBlockTexts(db, block.id, bodies);
  refresh();
  return done("Сохранено");
}

export async function deleteBlockAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = int(form, "id");
  if (id !== null) await (await getDb()).delete(diagnosticBlocks).where(eq(diagnosticBlocks.id, id));
  refresh();
  redirect("/admin/diagnostic");
}

// --- Продукты и цены ---

export async function createProductAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const title = str(form, "title").trim();
  if (!title) return fail("Укажите название продукта");
  const [product] = await (await getDb()).insert(products).values({ title }).returning();
  refresh();
  redirect(`/admin/products/${product?.id}`);
}

export async function updateProductAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = int(form, "id");
  const title = str(form, "title").trim();
  if (id === null) return fail("Продукт не найден");
  if (!title) return fail("Укажите название продукта");
  const updated = await (await getDb())
    .update(products)
    .set({
      title,
      description: str(form, "description").replace(/\r\n/g, "\n").trim(),
      delivery: str(form, "delivery").replace(/\r\n/g, "\n").trim(),
      sort: int(form, "sort") ?? 0,
      active: form.get("active") === "on",
      showOnResult: form.get("showOnResult") === "on",
    })
    .where(eq(products.id, id))
    .returning({ id: products.id });
  if (updated.length === 0) return fail("Продукт не найден");
  refresh();
  return done("Сохранено");
}

export async function addVariantAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const productId = int(form, "productId");
  const amount = parseRub(str(form, "price"));
  if (productId === null) return fail("Продукт не найден");
  if (amount === null) return fail("Укажите цену в рублях, например 2950");
  await (await getDb()).insert(priceVariants).values({ productId, amountKopecks: amount, label: str(form, "label").trim() });
  refresh();
  return done("Вариант цены добавлен");
}

export async function toggleVariantAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = int(form, "id");
  if (id !== null) {
    await (await getDb())
      .update(priceVariants)
      .set({ active: form.get("active") === "true" })
      .where(eq(priceVariants.id, id));
  }
  refresh();
}

// --- Заказы ---

export async function markPaidAction(form: FormData): Promise<void> {
  await requireAdmin();
  await markPaid(await getDb(), str(form, "id"), smtpMailer());
  refresh();
}

export async function cancelOrderAction(form: FormData): Promise<void> {
  await requireAdmin();
  await cancelOrder(await getDb(), str(form, "id"));
  refresh();
}

export async function resendEmailAction(form: FormData): Promise<void> {
  await requireAdmin();
  await sendOrderEmail(await getDb(), str(form, "id"), smtpMailer());
  refresh();
}

// --- Варианты диагностики ---

export async function setVariationModeAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const mode = str(form, "mode");
  if (!(mode in VARIATION_MODES)) return fail("Выберите способ");
  await setVariationMode(await getDb(), mode as VariationMode);
  refresh();
  return done("Сохранено");
}

export async function createVariationAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const title = str(form, "title").trim();
  const method = str(form, "method");
  if (!title) return fail("Укажите название варианта");
  if (!getMethod(method)) return fail("Выберите способ расчёта");
  const [v] = await (await getDb()).insert(variations).values({ title, method }).returning();
  refresh();
  redirect(`/admin/variations/${v?.id}`);
}

export async function updateVariationAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
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

  const texts = new Map<number, { shortText: string; fullText: string }>();
  for (const value of getMethod(variation.method)?.values ?? []) {
    const shortText = form.get(`short_${value}`);
    const fullText = form.get(`full_${value}`);
    if (typeof shortText === "string" && typeof fullText === "string") {
      texts.set(value, { shortText: shortText.replace(/\r\n/g, "\n"), fullText: fullText.replace(/\r\n/g, "\n") });
    }
  }
  await saveVariationTexts(db, variation.id, texts);
  refresh();
  return done("Сохранено");
}

// --- Эксперты ---

export async function createExpertAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const res = await createExpert(await getDb(), {
    name: str(form, "name"),
    login: str(form, "login"),
    password: str(form, "password"),
  });
  if (!res.ok) return fail(res.error);
  refresh();
  redirect(`/admin/experts/${res.id}`);
}

/** «В сети» на час или выключить — за эксперта (для проверки и подмены). */
export async function setExpertOnlineAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = int(form, "id");
  if (id !== null) await setOnlineByAdmin(await getDb(), id, form.get("online") === "true", new Date());
  refresh();
}

export async function updateExpertAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const db = await getDb();
  const id = int(form, "id");
  const expert = id === null ? null : await getExpert(db, id);
  if (!expert) return fail("Эксперт не найден");
  const name = str(form, "name").trim();
  if (!name) return fail("Укажите имя эксперта");

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
      active,
      // Выключенный эксперт сразу пропадает из выбора
      ...(!active && { online: false, onlineUntil: null }),
    })
    .where(eq(experts.id, expert.id));
  refresh();
  return done(password ? "Сохранено, пароль изменён — эксперту нужно войти заново" : "Сохранено");
}
