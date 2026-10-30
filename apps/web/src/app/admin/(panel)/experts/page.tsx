import Link from "next/link";
import { getDb } from "@/db";
import { MIN_EXPERT_PASSWORD, formatRating, listExperts } from "@/lib/experts";
import type { PublicExpert } from "@/lib/experts";
import { expertReviews } from "@/lib/reviews";
import { ActionForm } from "../../ActionForm";
import { OnlineToggle } from "../../OnlineToggle";
import { createExpertAction, setExpertArchivedAction } from "../../actions";

function ArchiveButton({ expert }: { expert: PublicExpert }) {
  return (
    <form action={setExpertArchivedAction}>
      <input type="hidden" name="id" value={expert.id} />
      <input type="hidden" name="archived" value={expert.archivedAt ? "false" : "true"} />
      <button className="link-button">{expert.archivedAt ? "Достать из архива" : "В архив"}</button>
    </form>
  );
}

function ExpertsTable({ list, onSite }: { list: PublicExpert[]; onSite: Map<number, { count: number }> }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Порядок</th>
            <th>Имя</th>
            <th>Логин</th>
            <th>Рейтинг</th>
            <th>Сейчас</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((e) => (
            <tr key={e.id} className={e.active && !e.archivedAt ? "" : "muted"}>
              <td>{e.sort}</td>
              <td>
                <Link href={`/admin/experts/${e.id}`}>{e.name}</Link>
              </td>
              <td>{e.login}</td>
              <td>
                ★ {formatRating(e.rating)} ·{" "}
                <Link href={`/admin/reviews?expert=${e.id}`} title="с других площадок + на сайте">
                  {e.reviewsShown} + {onSite.get(e.id)?.count ?? 0} отз.
                </Link>
              </td>
              <td>
                <OnlineToggle expert={e} />
              </td>
              <td>
                <ArchiveButton expert={e} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ExpertsAdminPage() {
  const db = await getDb();
  const all = await listExperts(db);
  const onSite = await expertReviews(
    db,
    all.map((e) => e.id),
  );
  const list = all.filter((e) => !e.archivedAt);
  const archive = all.filter((e) => e.archivedAt);
  return (
    <>
      <h1>Эксперты</h1>
      <p className="muted">
        Эксперт входит в свою панель по адресу <b>/expert</b> с логином и паролем, которые вы задали здесь. Клиент может
        выбрать того, кто «в сети» или «занят» (занятому можно написать, он ответит позже). Эксперт сам выбирает
        статус в своей панели — статус держится, пока его не сменят. Вы можете включить эксперта на срок или
        навсегда, отметить «занят» и выключить. Удалить эксперта — на его странице.
      </p>

      {list.length > 0 && <ExpertsTable list={list} onSite={onSite} />}

      <section className="admin-section">
        <h2>Архив{archive.length > 0 && ` (${archive.length})`}</h2>
        <p className="muted">
          Эксперта из архива клиенты не видят нигде: ни в списке, ни в профиле, ни его чатов; уведомлений от него не
          приходит, войти в панель он не может. Его профиль, фото, сертификаты, отзывы и переписка сохраняются — нажмите
          «Достать из архива», и всё вернётся как было.
        </p>
        {archive.length > 0 ? <ExpertsTable list={archive} onSite={onSite} /> : <p className="muted">Пока пусто.</p>}
      </section>

      <section className="admin-section">
        <h2>Новый эксперт</h2>
        <ActionForm action={createExpertAction}>
          <label className="field">
            <span>Имя (видят клиенты)</span>
            <input name="name" required />
          </label>
          <div className="row">
            <label className="field">
              <span>Логин для входа</span>
              <input name="login" required pattern="[a-zA-Z0-9._\-]{3,32}" autoCapitalize="none" />
            </label>
            <label className="field">
              <span>Пароль (от {MIN_EXPERT_PASSWORD} символов)</span>
              <input name="password" required minLength={MIN_EXPERT_PASSWORD} autoComplete="new-password" />
            </label>
          </div>
          <button className="button">Создать</button>
        </ActionForm>
      </section>
    </>
  );
}
