import Link from "next/link";
import { getDb } from "@/db";
import { METHODS, getMethod } from "@/lib/diagnostic";
import { formatRub } from "@/lib/offers";
import { VARIATION_MODES, getVariationMode, listVariations, variationStats } from "@/lib/variations";
import { ActionForm } from "../../ActionForm";
import { createVariationAction, setVariationModeAction } from "../../actions";

const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—");

export default async function VariationsPage() {
  const db = await getDb();
  const [list, stats, mode] = await Promise.all([listVariations(db), variationStats(db), getVariationMode(db)]);
  const statsById = new Map(stats.map((s) => [s.variationId, s]));

  return (
    <>
      <h1>Варианты диагностики</h1>
      <p className="muted">
        В варианте для каждого значения расчёта пишутся два текста: короткая диагностика (страница разбора) и полная
        (приходит в чат с подписью «Подробный разбор», когда человек выбрал эксперта). Новому человеку достаётся один
        активный вариант и закрепляется за ним.
      </p>

      <section className="admin-section">
        <h2>Как выбирать вариант</h2>
        <ActionForm action={setVariationModeAction}>
          <div className="row">
            {Object.entries(VARIATION_MODES).map(([key, label]) => (
              <label key={key} className="check">
                <input type="radio" name="mode" value={key} defaultChecked={mode === key} />
                <span>{label}</span>
              </label>
            ))}
            <button className="button">Сохранить</button>
          </div>
        </ActionForm>
      </section>

      {list.length > 0 && (
        <section className="admin-section">
          <h2>Варианты и конверсия</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Вариант</th>
                  <th>Расчёт</th>
                  <th>Получили диагностику</th>
                  <th>Перешли в чат</th>
                  <th>Написали</th>
                  <th>Оплатили</th>
                  <th>Выручка</th>
                </tr>
              </thead>
              <tbody>
                {list.map((v) => {
                  const s = statsById.get(v.id);
                  const leads = s?.leads ?? 0;
                  return (
                    <tr key={v.id} className={v.active ? "" : "muted"}>
                      <td>
                        <Link href={`/admin/variations/${v.id}`}>{v.title}</Link>
                        {!v.active && " (выключен)"}
                      </td>
                      <td>{getMethod(v.method)?.label ?? v.method}</td>
                      <td>{leads}</td>
                      <td>
                        {s?.chats ?? 0} <small className="muted">{pct(s?.chats ?? 0, leads)}</small>
                      </td>
                      <td>
                        {s?.replied ?? 0} <small className="muted">{pct(s?.replied ?? 0, leads)}</small>
                      </td>
                      <td>
                        {s?.paid ?? 0} <small className="muted">{pct(s?.paid ?? 0, leads)}</small>
                      </td>
                      <td>{formatRub(s?.revenueKopecks ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted">Проценты — от числа получивших диагностику.</p>
        </section>
      )}

      <section className="admin-section">
        <h2>Новый вариант</h2>
        <ActionForm action={createVariationAction}>
          <label className="field">
            <span>Название (видно только вам)</span>
            <input name="title" required placeholder="например: «Вариант А — мягкий»" />
          </label>
          <label className="field">
            <span>Способ расчёта — от него зависит, под какие значения писать тексты</span>
            <select name="method" required defaultValue="">
              <option value="" disabled>
                Выберите…
              </option>
              {METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.values.length} значений)
                </option>
              ))}
            </select>
          </label>
          <button className="button">Создать и перейти к текстам</button>
        </ActionForm>
      </section>
    </>
  );
}
