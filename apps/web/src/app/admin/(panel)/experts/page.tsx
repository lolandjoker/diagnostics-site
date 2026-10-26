import Link from "next/link";
import { getDb } from "@/db";
import { MIN_EXPERT_PASSWORD, formatRating, listExperts } from "@/lib/experts";
import { ActionForm } from "../../ActionForm";
import { OnlineToggle } from "../../OnlineToggle";
import { createExpertAction } from "../../actions";

export default async function ExpertsAdminPage() {
  const list = await listExperts(await getDb());
  return (
    <>
      <h1>Эксперты</h1>
      <p className="muted">
        Эксперт входит в свою панель по адресу <b>/expert</b> с логином и паролем, которые вы задали здесь. Клиент может
        выбрать того, кто «в сети» или «занят» (занятому можно написать, он ответит позже). Эксперт сам выбирает
        статус в своей панели — статус держится, пока его не сменят. Вы можете включить эксперта на срок или
        навсегда, отметить «занят» и выключить. Удалить эксперта — на его странице.
      </p>

      {list.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Порядок</th>
                <th>Имя</th>
                <th>Логин</th>
                <th>Рейтинг</th>
                <th>Сейчас</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className={e.active ? "" : "muted"}>
                  <td>{e.sort}</td>
                  <td>
                    <Link href={`/admin/experts/${e.id}`}>{e.name}</Link>
                  </td>
                  <td>{e.login}</td>
                  <td>★ {formatRating(e.rating)}</td>
                  <td>
                    <OnlineToggle expert={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
