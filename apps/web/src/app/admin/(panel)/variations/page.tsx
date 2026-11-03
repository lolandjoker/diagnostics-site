import Link from "next/link";
import { getDb } from "@/db";
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
      <p>
        <Link href="/admin/experts">← Эксперты</Link>
      </p>
      <h1>Краткие диагностики</h1>
      <p className="muted">
        Краткая диагностика — текст на странице разбора сразу после ввода имени и даты рождения, одинаковый для всех.
        Новому человеку достаётся одна из включённых. Каждый раз, когда он меняет дату рождения, — следующая по списку,
        так что каждую он увидит по разу. Подробная диагностика у каждого эксперта своя — задаётся на странице эксперта
        и приходит в чат с ним.
      </p>

      <section className="admin-section">
        <h2>Какую давать новому человеку</h2>
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
          <h2>Диагностики и конверсия</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Диагностика</th>
                  <th>Получили диагностику</th>
                  <th>Перешли в чат</th>
                  <th>Написали</th>
                  <th>Был звонок</th>
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
                        {!v.active && " (выключена)"}
                      </td>
                      <td>{leads}</td>
                      <td>
                        {s?.chats ?? 0} <small className="muted">{pct(s?.chats ?? 0, leads)}</small>
                      </td>
                      <td>
                        {s?.replied ?? 0} <small className="muted">{pct(s?.replied ?? 0, leads)}</small>
                      </td>
                      <td>
                        {s?.called ?? 0} <small className="muted">{pct(s?.called ?? 0, leads)}</small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Проценты — от числа получивших диагностику. У сменивших дату считается последняя полученная.
          </p>
        </section>
      )}

      <section className="admin-section">
        <h2>Новая краткая диагностика</h2>
        <ActionForm action={createVariationAction}>
          <label className="field">
            <span>Название (видно только вам)</span>
            <input name="title" required placeholder="например: «Скрытые причины»" />
          </label>
          <button className="button">Создать и перейти к тексту</button>
        </ActionForm>
      </section>
    </>
  );
}
