import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getBlock, getBlockTexts, getMethod } from "@/lib/diagnostic";
import { ActionForm } from "../../../ActionForm";
import { deleteBlockAction, updateBlockAction } from "../../../actions";

export default async function BlockPage(props: PageProps<"/admin/diagnostic/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const block = /^\d+$/.test(id) ? await getBlock(db, Number(id)) : null;
  if (!block) notFound();
  const method = getMethod(block.method);
  const bodies = await getBlockTexts(db, block.id);
  const filled = method?.values.filter((v) => bodies.has(v)).length ?? 0;

  return (
    <>
      <p>
        <Link href="/admin/diagnostic">← Все блоки</Link>
      </p>
      <h1>{block.title}</h1>
      <p className="muted">
        Расчёт: {method?.label ?? `неизвестный (${block.method})`}. Заполнено {filled} из {method?.values.length ?? 0}.
        В тексте можно использовать {"{name}"} — имя человека.
      </p>

      <ActionForm action={updateBlockAction}>
        <input type="hidden" name="id" value={block.id} />
        <div className="row">
          <label className="field">
            <span>Заголовок</span>
            <input name="title" defaultValue={block.title} required />
          </label>
          <label className="field field--short">
            <span>Порядок</span>
            <input name="sort" type="number" defaultValue={block.sort} />
          </label>
          <label className="check">
            <input name="active" type="checkbox" defaultChecked={block.active} />
            <span>Показывать</span>
          </label>
        </div>

        {method?.values.map((v) => (
          <label key={v} className="field">
            <span>
              Значение: <b>{method.valueLabel(v)}</b>
            </span>
            <textarea name={`value_${v}`} defaultValue={bodies.get(v) ?? ""} rows={5} />
          </label>
        ))}
        <button className="button sticky-save">Сохранить</button>
      </ActionForm>

      <form action={deleteBlockAction} className="danger-zone">
        <input type="hidden" name="id" value={block.id} />
        <button className="link-button link-button--danger">Удалить блок вместе с текстами</button>
      </form>
    </>
  );
}
