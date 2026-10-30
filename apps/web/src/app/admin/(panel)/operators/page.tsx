import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { MIN_OPERATOR_PASSWORD, listOperators } from "@/lib/operators";
import { ActionForm } from "../../ActionForm";
import { createOperatorAction, deleteOperatorAction, setOperatorActiveAction, setOperatorPasswordAction } from "../../actions";

/** Операторы чатов — заводит и выключает только админ. */
export default async function OperatorsPage() {
  if (!(await isAdmin())) redirect("/admin");
  const list = await listOperators(await getDb());
  return (
    <>
      <h1>Операторы чатов</h1>
      <p className="muted">
        Оператор входит по адресу <b>/operator/login</b> со своим логином и паролем и видит только чаты: все переписки,
        может отвечать и звонить. Клиент видит его ответы от эксперта чата; вы и эксперты — подпись «Оператор: имя».
        Сводка, эксперты, отзывы, тексты и всё остальное оператору недоступны.
      </p>

      {list.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>Логин</th>
                <th>Вход</th>
                <th>Новый пароль</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} className={o.active ? "" : "muted"}>
                  <td>{o.name}</td>
                  <td>{o.login}</td>
                  <td>
                    <form action={setOperatorActiveAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="active" value={o.active ? "false" : "true"} />
                      <button className="link-button">{o.active ? "Выключить" : "Включить"}</button>
                    </form>
                  </td>
                  <td>
                    <ActionForm action={setOperatorPasswordAction} className="inline-form" resetOnSuccess>
                      <input type="hidden" name="id" value={o.id} />
                      <input
                        name="password"
                        type="text"
                        minLength={MIN_OPERATOR_PASSWORD}
                        placeholder={`от ${MIN_OPERATOR_PASSWORD} символов`}
                        autoComplete="off"
                        aria-label={`Новый пароль для ${o.name}`}
                        required
                      />
                      <button className="link-button">Сменить</button>
                    </ActionForm>
                  </td>
                  <td>
                    <form action={deleteOperatorAction} className="inline-delete">
                      <input type="hidden" name="id" value={o.id} />
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

      <section className="admin-section">
        <h2>Новый оператор</h2>
        <ActionForm action={createOperatorAction} resetOnSuccess>
          <div className="row">
            <label className="field">
              <span>Имя (видят вы и эксперты)</span>
              <input name="name" required maxLength={60} />
            </label>
            <label className="field">
              <span>Логин</span>
              <input name="login" required pattern="[a-zA-Z0-9._\-]{3,32}" autoCapitalize="none" autoComplete="off" />
            </label>
            <label className="field">
              <span>Пароль (от {MIN_OPERATOR_PASSWORD} символов)</span>
              <input name="password" type="text" required minLength={MIN_OPERATOR_PASSWORD} autoComplete="off" />
            </label>
          </div>
          <button className="button">Добавить оператора</button>
        </ActionForm>
      </section>
    </>
  );
}
