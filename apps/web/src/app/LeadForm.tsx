"use client";

import { useEffect, useRef, useState } from "react";
import { maskBirthDate } from "@/lib/date-input";
import { submitLead, updateLead } from "./actions";
import { telegramFirstName, telegramInitData } from "./telegramWebApp";
import type { FormState } from "./actions";
import { useKeptForm } from "./useKeptForm";

const initial: FormState = { error: null };

/** edit — та же форма на странице «Изменить данные»: поля заполнены, сохраняется в ту же заявку. */
export function LeadForm({ button, edit }: { button: string; edit?: { leadId: string; name: string; birthDate: string } }) {
  const { state, onSubmit, pending } = useKeptForm(edit ? updateLead : submitLead, initial);
  const [birthDate, setBirthDate] = useState(edit?.birthDate ?? "");
  const nameRef = useRef<HTMLInputElement>(null);
  const telegramRef = useRef<HTMLInputElement>(null);

  // В приложении Telegram-бота: имя из профиля Telegram и подписанные данные — сервер запомнит,
  // чья это заявка (вернуться в чат, уведомления об ответах)
  useEffect(() => {
    if (edit) return;
    const initData = telegramInitData();
    if (!initData) return;
    if (telegramRef.current) telegramRef.current.value = initData;
    const name = telegramFirstName(initData);
    if (nameRef.current && nameRef.current.value === "" && name) nameRef.current.value = name.slice(0, 60);
  }, [edit]);

  return (
    <form onSubmit={onSubmit} className="form form--card">
      <input ref={telegramRef} type="hidden" name="tg" />
      {edit && <input type="hidden" name="leadId" value={edit.leadId} />}
      <label className="field">
        <span>Имя</span>
        <input ref={nameRef} name="name" defaultValue={edit?.name} required maxLength={60} autoComplete="given-name" />
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
        {pending ? (edit ? "Сохраняем…" : "Считаем…") : button}
      </button>
    </form>
  );
}
