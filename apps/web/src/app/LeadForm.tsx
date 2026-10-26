"use client";

import { useState } from "react";
import { maskBirthDate } from "@/lib/date-input";
import { submitLead } from "./actions";
import type { FormState } from "./actions";
import { useKeptForm } from "./useKeptForm";

const initial: FormState = { error: null };

export function LeadForm({ button }: { button: string }) {
  const { state, onSubmit, pending } = useKeptForm(submitLead, initial);
  const [birthDate, setBirthDate] = useState("");
  return (
    <form onSubmit={onSubmit} className="form form--card">
      <label className="field">
        <span>Имя</span>
        <input name="name" required maxLength={60} autoComplete="given-name" />
      </label>
      <label className="field">
        <span>Дата рождения</span>
        <input
          name="birthDate"
          type="text"
          inputMode="numeric"
          autoComplete="bday"
          placeholder="ДД.ММ.ГГГГ"
          required
          maxLength={10}
          pattern="\d{2}\.\d{2}\.\d{4}"
          title="Дата в формате ДД.ММ.ГГГГ, например 15.03.1990"
          value={birthDate}
          onChange={(e) => setBirthDate(maskBirthDate(e.target.value))}
        />
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
