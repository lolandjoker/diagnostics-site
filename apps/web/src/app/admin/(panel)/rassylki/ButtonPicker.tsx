"use client";

/**
 * Кнопка под рассылкой — один выбор: куда ведёт и надпись. Личный раздел (тест, «Мой день», чат…) — у каждого
 * свой, открывается внутри Telegram; «Своя ссылка» — одна для всех, тогда появляется поле адреса.
 */
import { useState } from "react";
import { PERSONAL_PAGES, type PersonalPage } from "@/lib/broadcast-pages";

export function ButtonPicker() {
  const [kind, setKind] = useState<"" | "url" | PersonalPage>("");
  const personal = kind !== "" && kind !== "url";
  return (
    <fieldset className="button-picker">
      <legend>Кнопка под сообщением</legend>
      <div className="row">
        <label className="field">
          <span>Куда ведёт</span>
          <select name="button_kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="">Без кнопки</option>
            <optgroup label="Личный раздел — у каждого свой, внутри Telegram">
              {(Object.keys(PERSONAL_PAGES) as PersonalPage[]).map((p) => (
                <option key={p} value={p}>
                  {PERSONAL_PAGES[p].label}
                </option>
              ))}
            </optgroup>
            <option value="url">Своя ссылка (одна для всех, в браузере)</option>
          </select>
        </label>
        {kind !== "" && (
          <label className="field">
            <span>Надпись на кнопке{personal ? " (необязательно)" : ""}</span>
            <input
              name="button_label"
              maxLength={40}
              required={kind === "url"}
              placeholder={personal ? PERSONAL_PAGES[kind].button : "Например: Смотреть видео"}
            />
          </label>
        )}
      </div>
      {kind === "url" && (
        <label className="field">
          <span>Адрес</span>
          <input name="button_url" type="url" required placeholder="https://…" />
        </label>
      )}
      <p className="muted">
        {personal
          ? "Каждый получит кнопку на свой раздел — сразу с его именем и датой, без ввода данных."
          : kind === "url"
            ? "Ссылка одна для всех и откроется в браузере — на сайте человека там не узнают. Для теста, чата или «Моего дня» выберите личный раздел."
            : "Без кнопки — только текст."}
      </p>
    </fieldset>
  );
}
