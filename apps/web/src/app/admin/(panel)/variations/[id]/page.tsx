import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getMethod } from "@/lib/diagnostic";
import { getVariation, getVariationTexts } from "@/lib/variations";
import { ActionForm } from "../../../ActionForm";
import { updateVariationAction } from "../../../actions";

export default async function VariationPage(props: PageProps<"/admin/variations/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const variation = /^\d+$/.test(id) ? await getVariation(db, Number(id)) : null;
  if (!variation) notFound();
  const method = getMethod(variation.method);
  const texts = await getVariationTexts(db, variation.id);
  const filled = method?.values.filter((v) => texts.get(v)?.shortText).length ?? 0;

  return (
    <>
      <p>
        <Link href="/admin/variations">← Все варианты</Link>
      </p>
      <h1>{variation.title}</h1>
      <p className="muted">
        Расчёт: {method?.label ?? variation.method}. Короткая диагностика заполнена для {filled} из{" "}
        {method?.values.length ?? 0} значений. В текстах работает {"{name}"} — имя человека. Если для значения человека
        текста нет, короткой диагностики на его странице не будет, а в чат не придёт полная.
      </p>

      <ActionForm action={updateVariationAction}>
        <input type="hidden" name="id" value={variation.id} />
        <div className="row">
          <label className="field">
            <span>Название</span>
            <input name="title" defaultValue={variation.title} required />
          </label>
          <label className="check">
            <input name="active" type="checkbox" defaultChecked={variation.active} />
            <span>Выдавать новым людям</span>
          </label>
        </div>

        {method?.values.map((v) => (
          <fieldset key={v} className="value-texts">
            <legend>
              Значение: <b>{method.valueLabel(v)}</b>
            </legend>
            <label className="field">
              <span>Короткая диагностика — на странице разбора</span>
              <textarea name={`short_${v}`} defaultValue={texts.get(v)?.shortText ?? ""} rows={4} />
            </label>
            <label className="field">
              <span>Полная диагностика — в чат после выбора эксперта</span>
              <textarea name={`full_${v}`} defaultValue={texts.get(v)?.fullText ?? ""} rows={6} />
            </label>
          </fieldset>
        ))}
        <button className="button sticky-save">Сохранить</button>
      </ActionForm>
    </>
  );
}
