"use client";

import { useEffect, useRef, useState } from "react";
import { maskBirthDate } from "@/lib/date-input";
import { submitLead } from "./actions";
import { telegramFirstName, telegramInitData } from "./telegramWebApp";
import type { FormState } from "./actions";
import { useKeptForm } from "./useKeptForm";

const initial: FormState = { error: null };

export function LeadForm({ button }: { button: string }) {
  const { state, onSubmit, pending } = useKeptForm(submitLead, initial);
  const [birthDate, setBirthDate] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const telegramRef = useRef<HTMLInputElement>(null);

  // В приложении Telegram-бота: имя из профиля Telegram и подписанные данные — сервер запомнит,
  // чья это заявка (вернуться в чат, уведомления об ответах)
  useEffect(() => {
    const initData = telegramInitData();
    if (!initData) return;
    if (telegramRef.current) telegramRef.current.value = initData;
    const name = telegramFirstName(initData);
    if (nameRef.current && nameRef.current.value === "" && name) nameRef.current.value = name.slice(0, 60);
  }, []);

  return (
    <form onSubmit={onSubmit} className="form form--card">
      <input ref={telegramRef} type="hidden" name="tg" />
      <label className="field">
        <span>Имя</span>
        <input ref={nameRef} name="name" required maxLength={60} autoComplete="given-name" />
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
