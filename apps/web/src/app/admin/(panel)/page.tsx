import Link from "next/link";
import { count, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { FUNNEL_PERIODS, funnel, funnelStart, periodStart, trackingSince } from "@/lib/funnel";
import type { FunnelPeriod } from "@/lib/funnel";

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

const day = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function DashboardPage(props: PageProps<"/admin">) {
  const { period: raw } = await props.searchParams;
  const period: FunnelPeriod = FUNNEL_PERIODS.some((p) => p.key === raw) ? (raw as FunnelPeriod) : "week";
  const db = await getDb();
  const tracking = await trackingSince(db);
  const [steps, [callRow]] = await Promise.all([
    tracking ? funnel(db, funnelStart(periodStart(period, new Date()), tracking)) : Promise.resolve([]),
    db
      .select({ n: count() })
      .from(calls)
      .where(sql`${calls.answeredAt} is not null`),
  ]);
  const top = Math.max(1, ...steps.map((s) => s.count));
  // Самое большое падение между соседними шагами — там теряем больше всего людей
  let worst = -1;
  let worstLoss = 0;
  steps.forEach((s, i) => {
    const prev = steps[i - 1];
    if (!prev || prev.count === 0) return;
    const loss = prev.count - s.count;
    if (loss > worstLoss) {
      worstLoss = loss;
      worst = i;
    }
  });

  return (
    <>
      <h1>Сводка</h1>
      <nav className="filter">
        {FUNNEL_PERIODS.map((p) => (
          <Link key={p.key} href={`/admin?period=${p.key}`} className={p.key === period ? "is-current" : ""}>
            {p.label}
          </Link>
        ))}
      </nav>

      <section className="admin-section">
        <h2>Воронка</h2>
        <p className="muted">
          Сколько людей дошли до каждого шага. Первые два шага — по браузерам за период, остальные — по заявкам,
          созданным за период. Слева — доля от первого шага, справа — переход с предыдущего. Красным — шаг, на котором
          теряем больше всего людей.
        </p>
        <p className="muted">
          {tracking
            ? `Данные собираются с ${day.format(tracking)} — более ранние заявки в воронку не входят.`
            : "Данных пока нет: они начнут собираться, когда на сайт зайдёт первый посетитель."}
        </p>
        <ol className="funnel">
          {steps.map((s, i) => {
            const prev = steps[i - 1];
            return (
              <li key={s.key} className={i === worst ? "funnel__step funnel__step--worst" : "funnel__step"}>
                <div className="funnel__label">
                  <b>{s.label}</b>
                  <span className="muted">{s.hint}</span>
                </div>
                <div className="funnel__bar">
                  <span style={{ width: `${(s.count / top) * 100}%` }} />
                </div>
                <b className="funnel__count">{s.count}</b>
                <span className="funnel__pct muted" title="от первого шага">
                  {pct(s.count, steps[0]?.count ?? 0)}
                </span>
                <span className="funnel__conv" title="переход с предыдущего шага">
                  {prev ? `→ ${pct(s.count, prev.count)}` : ""}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="stats">
        <div>
          <b>{callRow?.n ?? 0}</b> состоявшихся звонков за всё время
        </div>
      </div>
      <p className="muted">Воронка по каждому варианту диагностики — в разделе «Варианты диагностики».</p>
    </>
  );
}
