/** Удаление с подтверждением галочкой — чтобы не удалить случайно одним нажатием. */
export function DeleteForm({
  action,
  id,
  title,
  hint,
  confirm,
}: {
  action: (form: FormData) => Promise<void>;
  id: number;
  title: string;
  hint: string;
  confirm: string;
}) {
  return (
    <section className="admin-section danger-zone">
      <h2>{title}</h2>
      <p className="muted">{hint}</p>
      <form action={action} className="danger-zone__form">
        <input type="hidden" name="id" value={id} />
        <label className="check">
          <input type="checkbox" name="confirm" required />
          <span>{confirm}</span>
        </label>
        <button className="button button--danger">Удалить</button>
      </form>
    </section>
  );
}
