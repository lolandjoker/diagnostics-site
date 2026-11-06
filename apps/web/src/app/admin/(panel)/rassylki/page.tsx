import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { AUDIENCES, type Audience, BROADCAST_GAP_MS, MAX_BROADCAST_LENGTH, PERSONAL_PAGES, type PersonalPage, audienceCounts, listBroadcasts } from "@/lib/broadcasts";
import { telegramConfig } from "@/lib/telegram";
import { ActionForm } from "../../ActionForm";
import { broadcastAction } from "../../actions";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

/** Незаконченная рассылка старше часа — значит, её прервал перезапуск сайта. */
const STALLED_MS = 60 * 60 * 1000;

/** Рассылки в Telegram-бот — только админ. */
export default async function BroadcastsPage() {
  if (!(await isAdmin())) redirect("/admin");
  const db = await getDb();
  const [counts, history] = await Promise.all([audienceCounts(db), listBroadcasts(db)]);
  const now = Date.now();
  const last = history[0];
  const recent = last && now - last.createdAt.getTime() < BROADCAST_GAP_MS;

  return (
    <>
      <h1>Рассылки в Telegram-бот</h1>
      <p className="muted">
        Подключили бота: <b>{counts.all}</b>. Внизу каждой рассылки бот добавляет «Отключить сообщения — /stop». Жирный текст — **так**. Сначала отправьте пробу себе: впишите свой
        Telegram ID (узнать его можно у @userinfobot).
      </p>
      <p className="muted">
        Пишите не чаще раза в день и только по делу (подарок, новость, акция): частые рассылки люди блокируют, а
        Telegram может ограничить бота.
      </p>
      {!telegramConfig() && <p className="notice notice--error">Telegram-бот не подключён — рассылка не уйдёт.</p>}
      {recent && (
        <p className="notice notice--error">
          Последняя рассылка была {when.format(last.createdAt)} — меньше суток назад.
        </p>
      )}

      <ActionForm action={broadcastAction}>
        <fieldset className="audience">
          <legend>Кому</legend>
          {(Object.keys(AUDIENCES) as Audience[]).map((a) => (
            <label key={a} className="check">
              <input type="radio" name="audience" value={a} defaultChecked={a === "all"} />
              <span>
                {AUDIENCES[a]} — <b>{counts[a]}</b>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>Текст (до {MAX_BROADCAST_LENGTH} символов)</span>
          <textarea name="body" rows={8} maxLength={MAX_BROADCAST_LENGTH} required />
        </label>
        <label className="check">
          <input name="gift" type="checkbox" />
          <span>Значок подарка в начале</span>
        </label>
        <div className="row">
          <label className="field">
            <span>Личная кнопка — каждому его страница внутри Telegram</span>
            <select name="personal_page" defaultValue="">
              <option value="">Без личной кнопки</option>
              {(Object.keys(PERSONAL_PAGES) as PersonalPage[]).map((p) => (
                <option key={p} value={p}>
                  {PERSONAL_PAGES[p].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Надпись личной кнопки (необязательно)</span>
            <input name="personal_text" maxLength={40} placeholder="Например: Пройти тест «Ваш архетип»" />
          </label>
        </div>
        <p className="muted field-hint">
          Личная кнопка открывает каждому его собственный раздел — сразу с его именем и датой, без ввода данных.
          Обычная кнопка-ссылка ниже открывает сайт в браузере, где человека не узнают.
        </p>
        <div className="row">
          <label className="field">
            <span>Кнопка-ссылка: надпись (необязательно)</span>
            <input name="button_text" maxLength={40} placeholder="Например: Получить подарок" />
          </label>
          <label className="field">
            <span>Кнопка-ссылка: адрес</span>
            <input name="button_url" type="url" placeholder="https://taromba.com/…" />
          </label>
        </div>
        <label className="field field--short">
          <span>Проба: только на этот Telegram ID</span>
          <input name="test_id" inputMode="numeric" pattern="\d*" placeholder="например, 123456789" />
        </label>
        <label className="check">
          <input name="confirm" type="checkbox" />
          <span>Отправить выбранным — если ID для пробы пустой</span>
        </label>
        <button className="button">Отправить</button>
      </ActionForm>

      {history.length > 0 && (
        <section className="admin-section">
          <h2>История</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Кому</th>
                  <th>Текст</th>
                  <th>Получателей</th>
                  <th>Дошло</th>
                  <th>Не дошло</th>
                  <th>Состояние</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id}>
                    <td>{when.format(b.createdAt)}</td>
                    <td>
                      {b.audience === "silent" ? "не ответили" : b.audience === "never" ? "не писали" : "все"}
                      {b.personalPage && b.personalPage in PERSONAL_PAGES && (
                        <span className="muted"> · кнопка: {PERSONAL_PAGES[b.personalPage as PersonalPage].label}</span>
                      )}
                    </td>
                    <td>{b.body.length > 120 ? `${b.body.slice(0, 120)}…` : b.body}</td>
                    <td>{b.total}</td>
                    <td>{b.sent}</td>
                    <td title="заблокировали бота или удалили аккаунт">{b.failed}</td>
                    <td>
                      {b.finishedAt ? "готово" : now - b.createdAt.getTime() > STALLED_MS ? "прервана перезапуском" : "идёт…"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
