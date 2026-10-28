"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

/**
 * Удаление отмеченного в списке. Галочки стоят в строках списка (внутри строк — свои формы),
 * поэтому к этой форме они привязаны атрибутом form={id}: <BulkCheck form={id} value={…} />.
 * children — скрытые поля формы (например, expert_id).
 */
export function BulkDelete({ id, action, children }: { id: string; action: (form: FormData) => Promise<void>; children?: ReactNode }) {
  const [checked, setChecked] = useState(0);
  const [total, setTotal] = useState(0);
  const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${id}"]`)];

  // Считаем отмеченные после каждой отрисовки (список мог измениться после удаления) и при каждой галочке
  useEffect(() => {
    const count = () => {
      const all = boxes();
      setTotal(all.length);
      setChecked(all.filter((b) => b.checked).length);
    };
    count();
    document.addEventListener("change", count);
    return () => document.removeEventListener("change", count);
  });

  const all = total > 0 && checked === total;
  const toggleAll = () => {
    for (const b of boxes()) b.checked = !all;
    setChecked(all ? 0 : total);
  };

  return (
    <form id={id} action={action} className="bulk">
      {children}
      <button type="button" className="link-button" onClick={toggleAll} disabled={total === 0}>
        {all ? "Снять отметки" : "Отметить все"}
      </button>
      <span className="muted">Отмечено: {checked}</span>
      <button className="button button--danger" disabled={checked === 0}>
        Удалить отмеченные
      </button>
    </form>
  );
}

/** Галочка в строке списка для BulkDelete. */
export function BulkCheck({ form, value, name = "ids", label = "отметить" }: { form: string; value: string | number; name?: string; label?: string }) {
  return (
    <label className="check">
      <input type="checkbox" name={name} value={value} form={form} />
      <span>{label}</span>
    </label>
  );
}
