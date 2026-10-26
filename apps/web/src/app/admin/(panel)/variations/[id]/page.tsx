import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getVariation, getVariationTexts } from "@/lib/variations";
import { ActionForm } from "../../../ActionForm";
import { DeleteForm } from "../../../DeleteForm";
import { deleteVariationAction, updateVariationAction } from "../../../actions";

export default async function VariationPage(props: PageProps<"/admin/variations/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const variation = /^\d+$/.test(id) ? await getVariation(db, Number(id)) : null;
  if (!variation) notFound();
  const texts = await getVariationTexts(db, variation.id);

  return (
    <>
      <p>
        <Link href="/admin/variations">← Все варианты</Link>
      </p>
      <h1>{variation.title}</h1>
      <p className="muted">
        Тексты одинаковые для всех, кому достался вариант. В текстах работает {"{name}"} — имя человека. Пустой текст
        не показывается: нет текста 1 — на странице разбора его не будет, нет текста 2 — в чат ничего не придёт.
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

        <label className="field">
          <span>Текст 1 — на странице разбора, сразу после ввода имени и даты рождения</span>
          <textarea name="short_text" defaultValue={texts.shortText} rows={6} />
        </label>
        <label className="field">
          <span>Текст 2 — в чат через 3 минуты после выбора эксперта</span>
          <textarea name="full_text" defaultValue={texts.fullText} rows={10} />
        </label>
        <button className="button sticky-save">Сохранить</button>
      </ActionForm>

      <DeleteForm
        action={deleteVariationAction}
        id={variation.id}
        title="Удалить вариант"
        hint="Новым людям вариант больше не выдаётся, из списка и воронки он пропадёт. Тем, кому он уже достался, тексты по-прежнему показываются."
        confirm={`Да, удалить вариант «${variation.title}»`}
      />
    </>
  );
}
