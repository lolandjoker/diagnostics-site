"use client";

import Link from "next/link";
import { submitOrder } from "../../../../actions";
import type { FormState } from "../../../../actions";
import { useKeptForm } from "../../../../useKeptForm";

const initial: FormState = { error: null };

export function OrderForm(props: { leadId: string; productId: number; hint: string; button: string }) {
  const { state, onSubmit, pending } = useKeptForm(submitOrder, initial);
  return (
    <form onSubmit={onSubmit} className="form">
      <input type="hidden" name="leadId" value={props.leadId} />
      <input type="hidden" name="productId" value={props.productId} />
      <label className="field">
        <span>Почта</span>
        <input name="email" type="email" required maxLength={200} autoComplete="email" />
        {props.hint && <small>{props.hint}</small>}
      </label>
      <label className="check">
        <input name="offer" type="checkbox" required />
        <span>
          Принимаю условия <Link href="/oferta">оферты</Link>
        </span>
      </label>
      {state.error && (
        <p className="form__error" role="alert">
          {state.error}
        </p>
      )}
      <button className="button" disabled={pending}>
        {pending ? "Оформляем…" : props.button}
      </button>
    </form>
  );
}
