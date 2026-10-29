import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { TEXT_DEFS, getAllTexts } from "@/lib/texts";
import type { TextDef } from "@/lib/texts";
import { ActionForm } from "../../ActionForm";
import { saveTextsAction } from "../../actions";

export default async function TextsPage() {
  // Тексты сайта правит только админ; эксперту этот раздел закрыт
  if (!(await isAdmin())) redirect("/admin");
  const values = await getAllTexts(await getDb());
  const groups = new Map<string, TextDef[]>();
  for (const def of TEXT_DEFS as readonly TextDef[]) {
    groups.set(def.group, [...(groups.get(def.group) ?? []), def]);
  }

  return (
    <>
      <h1>Тексты сайта</h1>
      <p className="muted">
        Пустое поле — блок на сайте не показывается (кроме заголовков). Подстановки в фигурных скобках заменяются на
        данные человека или заказа.
      </p>
      <ActionForm action={saveTextsAction}>
        {[...groups].map(([group, defs]) => (
          <section key={group} className="admin-section">
            <h2>{group}</h2>
            {defs.map((def) => {
              const value = values[def.key as keyof typeof values];
              const long = def.group === "Документы" || value.length > 80 || value.includes("\n");
              if (def.toggle) {
                // Снятая галочка в форму не попадает — тогда уходит скрытое пустое значение
                return (
                  <label key={def.key} className="check">
                    <input type="checkbox" name={def.key} value="1" defaultChecked={value === "1"} />
                    <input type="hidden" name={def.key} value="" />
                    <span>{def.label}</span>
                  </label>
                );
              }
              return (
                <label key={def.key} className="field">
                  <span>
                    {def.label}
                    {def.hint && <small> — подстановки: {def.hint}</small>}
                  </span>
                  {def.url ? (
                    <input name={def.key} type="url" defaultValue={value} placeholder="https://" />
                  ) : def.number ? (
                    <input name={def.key} inputMode="numeric" pattern="\d+" defaultValue={value} required />
                  ) : long ? (
                    <textarea name={def.key} defaultValue={value} rows={def.group === "Документы" ? 12 : 4} />
                  ) : (
                    <input name={def.key} defaultValue={value} />
                  )}
                </label>
              );
            })}
          </section>
        ))}
        <button className="button sticky-save">Сохранить</button>
      </ActionForm>
    </>
  );
}
