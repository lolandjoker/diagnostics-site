import Link from "next/link";
import { count, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { FUNNEL_PERIODS, funnel, funnelStart, periodStart, trackingSince } from "@/lib/funnel";
import type { FunnelPeriod } from "@/lib/funnel";
import { botStats } from "@/lib/bot-stats";
import { cityName, countryName } from "@/lib/geo-label";
import { geoStats } from "@/lib/geo-stats";
import { heardFromStats, sourceStats } from "@/lib/sources";
import { botUsername, telegramConfig } from "@/lib/telegram";
import { getTexts } from "@/lib/texts";

const REF_TEXT_KEYS = [
  "source.r1",
  "source.r2",
  "source.r3",
  "source.r4",
  "source.r5",
  "source.r6",
  "source.r7",
  "source.r8",
  "source.r9",
  "source.r10",
] as const;
type RefTextKey = (typeof REF_TEXT_KEYS)[number];

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
  const since = periodStart(period, new Date());
  const cfg = telegramConfig();
  const [steps, [callRow], sources, heard, sourceNames, bot, botName, geo] = await Promise.all([
    tracking ? funnel(db, funnelStart(since, tracking)) : Promise.resolve([]),
    db
      .select({ n: count() })
      .from(calls)
      .where(sql`${calls.answeredAt} is not null`),
    sourceStats(db, since),
    heardFromStats(db, since),
    getTexts(db, REF_TEXT_KEYS),
    botStats(db, since),
    cfg ? botUsername(cfg) : Promise.resolve(null),
    geoStats(db, since),
  ]);
  const geoTotal = geo.countries.reduce((s, c) => s + c.leads, 0);
  const heardTotal = heard.reduce((sum, h) => sum + h.leads, 0);
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

      <section className="admin-section">
        <h2>Откуда приходят</h2>
        <p className="muted">
          По коротким адресам: сайт запоминает, по какому адресу человек зашёл впервые. «Открыли главную» — браузеры за
          период, остальное — заявки, созданные за период. Адреса taromba.com/r1 … /r10 — для других площадок, их
          названия меняются в <Link href="/admin/texts">«Текстах сайта» → «Источники»</Link>. Ссылка t.me/…?start=…
          ведёт сразу в Telegram-бота — заявка из бота тоже попадёт в этот источник. «Вернулись» — снова пришли в
          чат (открыли его или написали, на сайте или из бота) через сутки и позже после заявки; свежие заявки
          вернуться ещё не успели.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Источник</th>
                <th>Открыли главную</th>
                <th>Заявки</th>
                <th>Начали чат</th>
                <th>Написали эксперту</th>
                <th title="Снова пришли в чат (на сайте или из бота) через сутки и позже">Вернулись</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.key ?? "none"}>
                  <td>
                    {(s.key && REF_TEXT_KEYS.includes(`source.${s.key}` as RefTextKey) && sourceNames[`source.${s.key}` as RefTextKey]) || s.label}
                    <div className="muted">{s.key ? `taromba.com/${s.key}` : "taromba.com и Telegram-бот"}</div>
                    {s.key && botName && <div className="muted">t.me/{botName}?start={s.key}</div>}
                  </td>
                  <td>{s.visitors}</td>
                  <td>
                    {s.leads} <span className="muted">{pct(s.leads, s.visitors)}</span>
                  </td>
                  <td>
                    {s.chats} <span className="muted">{pct(s.chats, s.leads)}</span>
                  </td>
                  <td>{s.wrote}</td>
                  <td>
                    {s.returned} <span className="muted">{pct(s.returned, s.leads)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Ответы «Откуда вы о нас узнали?»</h3>
        <p className="muted">
          Вопрос в чате — только для тех, кто открыл просто taromba.com (не по короткой ссылке и не из Telegram-бота).
          Ответили: {heardTotal}.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ответ</th>
                <th>Заявки</th>
                <th>Начали чат</th>
              </tr>
            </thead>
            <tbody>
              {heard.map((h) => (
                <tr key={h.key}>
                  <td>{h.label}</td>
                  <td>{h.leads}</td>
                  <td>{h.chats}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section">
        <h2>География</h2>
        <p className="muted">
          Откуда заявки за период — по IP в момент заявки (сам IP не храним). Определено: {geoTotal}
          {geo.unknown > 0 && <>, не определено: {geo.unknown} (старые заявки или адрес не нашёлся в базе)</>}.
        </p>
        {geoTotal === 0 ? (
          <p className="muted">Пока нет данных — появятся с новыми заявками.</p>
        ) : (
          <div className="geo-stats">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Страна</th>
                    <th>Заявки</th>
                    <th>Доля</th>
                    <th>Начали чат</th>
                  </tr>
                </thead>
                <tbody>
                  {geo.countries.map((c) => (
                    <tr key={c.country}>
                      <td>{countryName(c.country)}</td>
                      <td>{c.leads}</td>
                      <td>{pct(c.leads, geoTotal)}</td>
                      <td>
                        {c.chats} <span className="muted">({pct(c.chats, c.leads)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Город</th>
                    <th>Заявки</th>
                    <th>Начали чат</th>
                  </tr>
                </thead>
                <tbody>
                  {geo.cities.map((c) => (
                    <tr key={`${c.country}:${c.city}`}>
                      <td>
                        {cityName(c.city ?? "")}
                        {c.country !== "RU" && <span className="muted"> · {countryName(c.country)}</span>}
                      </td>
                      <td>{c.leads}</td>
                      <td>
                        {c.chats} <span className="muted">({pct(c.chats, c.leads)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="muted geo-stats__credit">
          Геоданные:{" "}
          <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">
            IP Geolocation by DB-IP
          </a>{" "}
          (CC BY 4.0). Точность — до города, у мобильного интернета город иногда определяется по месту оператора.
        </p>
      </section>

      <section className="admin-section">
        <h2>Telegram-бот</h2>
        <p className="muted">
          Подключены сейчас — за всё время (им уходят ответы экспертов и <Link href="/admin/rassylki">рассылки</Link>);
          остальное — за период.
        </p>
        <div className="stats">
          <div>
            <b>{bot.subscribers}</b> подключены сейчас
          </div>
          <div>
            <b>{bot.linkedLeads}</b> заявок с Telegram
          </div>
          <div>
            <b>{bot.repliedLeads}</b> писали эксперту из бота <span className="muted">({bot.repliedMessages} сообщ.)</span>
          </div>
          <div>
            <b>{bot.reminders}</b> напоминаний о непрочитанном
          </div>
          <div>
            <b>{bot.reviewAsks}</b> просьб оценить эксперта
          </div>
          <div>
            <b>{bot.quizzes}</b> квизов клуба пройдено <span className="muted">({bot.quizPeople} чел.)</span>
          </div>
          <div>
            <b>{bot.quizzesWaiting}</b> человек прошли квиз, но не подключили Telegram
          </div>
        </div>
      </section>

      <div className="stats">
        <div>
          <b>{callRow?.n ?? 0}</b> состоявшихся звонков за всё время
        </div>
      </div>
      <p className="muted">Воронка по каждой краткой диагностике — в «Эксперты» → «Краткие диагностики».</p>
    </>
  );
}
