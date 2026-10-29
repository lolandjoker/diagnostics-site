import Link from "next/link";
import { getDb } from "@/db";
import { listExperts } from "@/lib/experts";
import { listAllReviews } from "@/lib/reviews";
import { requireStaff } from "@/lib/staff-auth";
import { ActionForm } from "../../ActionForm";
import { BulkCheck, BulkDelete } from "../../BulkDelete";
import {
  addReviewAction,
  deleteReviewsAction,
  setReviewBodyAction,
  setReviewHiddenAction,
  setReviewVerifiedAction,
} from "../../actions";
import { Stars } from "../../../Stars";

const when = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function ReviewsPage(props: PageProps<"/admin/reviews">) {
  const staff = await requireStaff();
  const { expert: expertParam } = await props.searchParams;
  const db = await getDb();
  const experts = await listExperts(db);
  const current = experts.find((e) => typeof expertParam === "string" && String(e.id) === expertParam) ?? null;
  const list = await listAllReviews(db, current?.id);
  const today = new Date().toISOString().slice(0, 10);
  // Эксперт открывает чат в своей панели, админ — в админке
  const chatBase = staff.kind === "admin" ? "/admin/chats" : "/expert/chat";

  return (
    <>
      <h1>Отзывы{current ? ` — ${current.name}` : ""}</h1>
      <p className="muted">
        Клиенты оставляют отзыв в своём чате — один на чат, могут поправить; здесь можно добавить отзыв и без чата.
        Отзыв сразу виден на карточке эксперта (листается по 5). Текст отзыва можно поправить. Скрытый клиентам
        не показывается; удаление — насовсем: отметьте отзывы галочками и нажмите «Удалить отмеченные».
        Отзыв из чата можно отметить «Проверенный пользователь», когда по переписке вы убедились, что пишет живой
        человек, а не бот, — отметка видна клиентам. У отзывов, добавленных вручную, её нет: проверять некого.
        Число отзывов на карточке («347 отзывов») задаётся на странице эксперта.
      </p>

      <nav className="filter">
        <Link href="/admin/reviews" className={current ? "" : "is-current"}>
          Все
        </Link>
        {experts.map((e) => (
          <Link key={e.id} href={`/admin/reviews?expert=${e.id}`} className={current?.id === e.id ? "is-current" : ""}>
            {e.name}
          </Link>
        ))}
      </nav>

      <section className="admin-section">
        <h2>Добавить отзыв</h2>
        <ActionForm action={addReviewAction} resetOnSuccess>
          <div className="row">
            <label className="field">
              <span>Эксперт</span>
              <select name="expert_id" defaultValue={current?.id ?? ""} required>
                <option value="" disabled>
                  Выберите…
                </option>
                {experts.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Имя автора</span>
              <input name="author" required maxLength={60} placeholder="например, Ольга" />
            </label>
            <label className="field field--short">
              <span>Оценка</span>
              <select name="stars" defaultValue="5">
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {"★".repeat(n)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--short">
              <span>Дата</span>
              <input name="date" type="date" defaultValue={today} required />
            </label>
          </div>
          <label className="field">
            <span>Текст</span>
            <textarea name="body" rows={3} maxLength={2000} />
          </label>
          <button className="button">Добавить</button>
        </ActionForm>
      </section>
      {list.length === 0 ? (
        <p className="muted">Отзывов пока нет.</p>
      ) : (
        <>
          <BulkDelete id="reviews-delete" action={deleteReviewsAction} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Эксперт</th>
                  <th>Клиент</th>
                  <th>Оценка</th>
                  <th>Отзыв</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className={r.hidden ? "muted" : ""}>
                    <td>{when.format(r.createdAt)}</td>
                    <td>{r.expertName}</td>
                    <td>
                      {r.conversationId ? (
                        <>
                          <Link href={`${chatBase}/${r.conversationId}`}>{r.authorName}</Link>
                          {r.verifiedAt && <span className="verified"> ✓ проверен</span>}
                        </>
                      ) : (
                        <>
                          {r.authorName} <span className="muted">(добавлен вручную)</span>
                        </>
                      )}
                    </td>
                    <td>
                      <Stars n={r.stars} />
                    </td>
                    <td className="text">
                      {r.body || <span className="muted">без текста</span>}
                      {r.hidden && <span className="muted"> (скрыт)</span>}
                      <details className="review-edit">
                        <summary>изменить текст</summary>
                        <ActionForm action={setReviewBodyAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <textarea name="body" rows={4} maxLength={2000} defaultValue={r.body} aria-label="Текст отзыва" />
                          <button className="button">Сохранить</button>
                        </ActionForm>
                      </details>
                    </td>
                    <td className="actions">
                      {r.conversationId && (
                        <form action={setReviewVerifiedAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="verified" value={r.verifiedAt ? "false" : "true"} />
                          <button className="link-button" title="По переписке ясно, что пишет живой человек, а не бот">
                            {r.verifiedAt ? "Снять «проверен»" : "Проверенный"}
                          </button>
                        </form>
                      )}
                      <form action={setReviewHiddenAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="hidden" value={r.hidden ? "false" : "true"} />
                        <button className="link-button">{r.hidden ? "Показать" : "Скрыть"}</button>
                      </form>
                      <BulkCheck form="reviews-delete" value={r.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
