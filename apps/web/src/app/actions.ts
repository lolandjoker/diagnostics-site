"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { createLead, validateLead } from "@/lib/leads";
import { createOrder } from "@/lib/orders";

export interface FormState {
  error: string | null;
}

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

/** Форма на главной: имя, дата рождения, согласие → страница разбора. */
export async function submitLead(_prev: FormState, form: FormData): Promise<FormState> {
  const input = {
    name: str(form.get("name")),
    birthDate: str(form.get("birthDate")),
    consent: form.get("consent") === "on",
  };
  const now = new Date();
  const error = validateLead(input, now);
  if (error) return { error };
  const lead = await createLead(await getDb(), input, now);
  redirect(`/razbor/${lead.id}`);
}

/** Оформление заказа: почта и согласие с офертой → страница оплаты. */
export async function submitOrder(_prev: FormState, form: FormData): Promise<FormState> {
  if (form.get("offer") !== "on") return { error: "Нужно принять условия оферты" };
  const productId = Number(str(form.get("productId")));
  if (!Number.isInteger(productId)) return { error: "Продукт не найден" };
  const res = await createOrder(await getDb(), {
    leadId: str(form.get("leadId")),
    productId,
    email: str(form.get("email")),
  });
  if (!res.ok) return { error: res.error };
  redirect(`/zakaz/${res.order.id}`);
}
