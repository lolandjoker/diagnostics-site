import Link from "next/link";
import { getDb } from "@/db";
import { METHODS, getMethod, listBlocks } from "@/lib/diagnostic";
import { ActionForm } from "../../ActionForm";
import { createBlockAction } from "../../actions";

export default async function DiagnosticPage() {
  const blocks = await listBlocks(await getDb());
  return (
    <>
      <h1>Разбор</h1>
      <p className="muted">
        Разбор состоит из блоков. Для блока выбирается способ расчёта, и для каждого возможного значения пишется свой
        текст. Человек видит активные блоки по порядку; блок без текста для его значения пропускается.
      </p>

      {blocks.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Порядок</th>
                <th>Блок</th>
                <th>Расчёт</th>
                <th>Показ</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.id} className={b.active ? "" : "muted"}>
                  <td>{b.sort}</td>
                  <td>
                    <Link href={`/admin/diagnostic/${b.id}`}>{b.title}</Link>
                  </td>
                  <td>{getMethod(b.method)?.label ?? b.method}</td>
                  <td>{b.active ? "да" : "выключен"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="admin-section">
        <h2>Новый блок</h2>
        <ActionForm action={createBlockAction}>
          <label className="field">
            <span>Заголовок (виден человеку)</span>
            <input name="title" required />
          </label>
          <label className="field">
            <span>Способ расчёта</span>
            <select name="method" required defaultValue="">
              <option value="" disabled>
                Выберите…
              </option>
              {METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--short">
            <span>Порядок</span>
            <input name="sort" type="number" defaultValue={(blocks.at(-1)?.sort ?? 0) + 10} />
          </label>
          <button className="button">Создать и перейти к текстам</button>
        </ActionForm>
      </section>
    </>
  );
}
