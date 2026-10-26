import Link from "next/link";
import { getDb } from "@/db";
import { listAllReviews } from "@/lib/reviews";
import { requireStaff } from "@/lib/staff-auth";
import { deleteReviewAction, setReviewHiddenAction } from "../../actions";
import { Stars } from "../../../Stars";

const when = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function ReviewsPage() {
  const staff = await requireStaff();
  const list = await listAllReviews(await getDb());
  // Эксперт открывает чат в своей панели, админ — в админке
  const chatBase = staff.kind === "admin" ? "/admin/chats" : "/expert/chat";

  return (
    <>
      <h1>Отзывы</h1>
      <p className="muted">
        Клиенты оставляют отзыв в своём чате — один на чат, могут поправить. Отзыв сразу виден на карточке эксперта с
        именем клиента. Скрытый отзыв клиентам не показывается; удаление — насовсем.
      </p>
      {list.length === 0 ? (
        <p className="muted">Отзывов пока нет.</p>
      ) : (
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
                    <Link href={`${chatBase}/${r.conversationId}`}>{r.authorName}</Link>
                  </td>
                  <td>
                    <Stars n={r.stars} />
                  </td>
                  <td className="text">
                    {r.body || <span className="muted">без текста</span>}
                    {r.hidden && <span className="muted"> (скрыт)</span>}
                  </td>
                  <td className="actions">
                    <form action={setReviewHiddenAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="hidden" value={r.hidden ? "false" : "true"} />
                      <button className="link-button">{r.hidden ? "Показать" : "Скрыть"}</button>
                    </form>
                    <form action={deleteReviewAction} className="inline-delete">
                      <input type="hidden" name="id" value={r.id} />
                      <label className="check">
                        <input type="checkbox" name="confirm" required />
                        <span>удалить</span>
                      </label>
                      <button className="link-button link-button--danger">Удалить</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
