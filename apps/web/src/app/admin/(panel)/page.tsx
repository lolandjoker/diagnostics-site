import { count } from "drizzle-orm";
import { getDb } from "@/db";
import { leads } from "@/db/schema";
import { dashboardTotals, formatRub, variantStats } from "@/lib/offers";

export default async function DashboardPage() {
  const db = await getDb();
  const [totals, stats, [leadRow]] = await Promise.all([
    dashboardTotals(db),
    variantStats(db),
    db.select({ n: count() }).from(leads),
  ]);

  return (
    <>
      <h1>Сводка</h1>
      <div className="stats">
        <div>
          <b>{leadRow?.n ?? 0}</b> заявок на разбор
        </div>
        <div>
          <b>{totals.pending}</b> заказов ждут оплаты
        </div>
        <div>
          <b>{totals.paid}</b> оплачено
        </div>
        <div>
          <b>{formatRub(totals.revenue)}</b> выручка
        </div>
      </div>

      <h2>Варианты цен</h2>
      <p className="muted">
        Показы — скольким людям досталась эта цена. Конверсия — доля оплат от показов. Сравнивать варианты стоит после
        хотя бы нескольких сотен показов каждого.
      </p>
      {stats.length === 0 ? (
        <p className="muted">Продуктов пока нет.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Продукт</th>
                <th>Вариант</th>
                <th>Цена</th>
                <th>Показы</th>
                <th>Оплаты</th>
                <th>Конверсия</th>
                <th>Выручка</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.variantId} className={s.active ? "" : "muted"}>
                  <td>{s.productTitle}</td>
                  <td>
                    {s.label || `№ ${s.variantId}`}
                    {!s.active && " (выключен)"}
                  </td>
                  <td>{formatRub(s.amountKopecks)}</td>
                  <td>{s.shown}</td>
                  <td>{s.paid}</td>
                  <td>{(s.conversion * 100).toFixed(1)}%</td>
                  <td>{formatRub(s.revenueKopecks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
