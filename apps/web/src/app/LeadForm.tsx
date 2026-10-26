"use client";

import { submitLead } from "./actions";
import type { FormState } from "./actions";
import { useKeptForm } from "./useKeptForm";

const initial: FormState = { error: null };

export function LeadForm({ button, maxDate }: { button: string; maxDate: string }) {
  const { state, onSubmit, pending } = useKeptForm(submitLead, initial);
  return (
    <form onSubmit={onSubmit} className="form form--card">
      <label className="field">
        <span>Имя</span>
        <input name="name" required maxLength={60} autoComplete="given-name" />
      </label>
      <label className="field">
        <span>Дата рождения</span>
        <input name="birthDate" type="date" required min="1900-01-01" max={maxDate} />
      </label>
      {state.error && (
        <p className="form__error" role="alert">
          {state.error}
        </p>
      )}
      <button className="button" disabled={pending}>
        {pending ? "Считаем…" : button}
      </button>
    </form>
  );
}
