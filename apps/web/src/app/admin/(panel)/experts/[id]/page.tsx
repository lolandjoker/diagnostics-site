import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { listCertificates } from "@/lib/certificates";
import { MIN_EXPERT_PASSWORD, expertPhotoUrls, formatRating, getExpert } from "@/lib/experts";
import { ActionForm } from "../../../ActionForm";
import { OnlineToggle } from "../../../OnlineToggle";
import { DeleteForm } from "../../../DeleteForm";
import { addCertificateAction, deleteCertificateAction, deleteExpertAction, updateExpertAction } from "../../../actions";

export default async function ExpertAdminPage(props: PageProps<"/admin/experts/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const expert = /^\d+$/.test(id) ? await getExpert(db, Number(id)) : null;
  if (!expert || expert.deletedAt) notFound();
  const photo = (await expertPhotoUrls(db)).get(expert.id);
  const certificates = await listCertificates(db, expert.id);

  return (
    <>
      <p>
        <Link href="/admin/experts">← Все эксперты</Link>
      </p>
      <h1>{expert.name}</h1>
      <p className="muted">
        Логин: <b>{expert.login}</b>.
      </p>
      <OnlineToggle expert={expert} />
      <p>
        <Link href={`/admin/reviews?expert=${expert.id}`}>Отзывы эксперта — посмотреть, добавить, удалить</Link>
        {" · "}
        <Link href={`/ekspert/${expert.id}`} target="_blank">
          Профиль на сайте ↗
        </Link>
      </p>

      <ActionForm action={updateExpertAction}>
        <input type="hidden" name="id" value={expert.id} />
        <div className="expert__head">
          {photo ? (
            <img className="expert__photo" src={photo} alt="" width={72} height={72} />
          ) : (
            <div className="expert__photo expert__photo--empty" aria-hidden="true">
              {expert.name.slice(0, 1)}
            </div>
          )}
          <label className="field">
            <span>Фото: JPEG, PNG или WebP до 2 МБ, лучше квадратное</span>
            <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
          </label>
        </div>
        <label className="field">
          <span>Имя (видят клиенты)</span>
          <input name="name" defaultValue={expert.name} required />
        </label>
        <label className="field">
          <span>Короткое описание (на карточке выбора эксперта и в мини-профиле у чата)</span>
          <textarea name="description" defaultValue={expert.description} rows={3} />
        </label>
        <label className="field">
          <span>Подробное описание (полный профиль: опыт, подход, с чем помогает)</span>
          <textarea name="about" defaultValue={expert.about} rows={10} />
        </label>
        <label className="field">
          <span>Специализации — через запятую, например: Таро, Астрология, Нумерология</span>
          <input name="tags" defaultValue={expert.tags} maxLength={400} />
        </label>
        <div className="row">
          <label className="field field--short">
            <span>Порядок</span>
            <input name="sort" type="number" defaultValue={expert.sort} />
          </label>
          <label className="field field--short">
            <span>Рейтинг (1,0–5,0)</span>
            <input name="rating" inputMode="decimal" defaultValue={formatRating(expert.rating)} required />
          </label>
          <label className="field field--short">
            <span>Отзывов на карточке</span>
            <input name="reviews_shown" type="number" min={0} max={100000} defaultValue={expert.reviewsShown} required />
          </label>
          <label className="check">
            <input name="active" type="checkbox" defaultChecked={expert.active} />
            <span>Работает (выключенный не может войти и не виден клиентам)</span>
          </label>
        </div>
        <label className="field">
          <span>Новый пароль — оставьте пустым, чтобы не менять (от {MIN_EXPERT_PASSWORD} символов)</span>
          <input name="password" autoComplete="new-password" />
        </label>
        <button className="button">Сохранить</button>
      </ActionForm>

      <section className="admin-section">
        <h2>Сертификаты</h2>
        <p className="muted">Картинки JPEG, PNG или WebP до 5 МБ — видны в профиле эксперта, открываются по нажатию.</p>
        {certificates.length > 0 && (
          <ul className="certs certs--admin">
            {certificates.map((c) => (
              <li key={c.id}>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="certs__item">
                  <img src={c.url} alt={c.title || "Сертификат"} loading="lazy" />
                  {c.title && <span>{c.title}</span>}
                </a>
                <form action={deleteCertificateAction} className="inline-delete">
                  <input type="hidden" name="expert_id" value={expert.id} />
                  <input type="hidden" name="id" value={c.id} />
                  <label className="check">
                    <input type="checkbox" name="confirm" required />
                    <span>удалить</span>
                  </label>
                  <button className="link-button link-button--danger">Удалить</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addCertificateAction} resetOnSuccess>
          <input type="hidden" name="expert_id" value={expert.id} />
          <div className="row">
            <label className="field">
              <span>Картинка</span>
              <input name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
            </label>
            <label className="field">
              <span>Подпись (необязательно)</span>
              <input name="title" maxLength={120} placeholder="например, Диплом астролога, 2019" />
            </label>
          </div>
          <button className="button">Добавить сертификат</button>
        </ActionForm>
      </section>

      <DeleteForm
        action={deleteExpertAction}
        id={expert.id}
        title="Удалить эксперта"
        hint="Эксперт больше не сможет войти и пропадёт из списков и у клиентов. Его чаты останутся — ответить в них можно из панели любого эксперта. Логин освободится для нового эксперта."
        confirm={`Да, удалить эксперта «${expert.name}»`}
      />
    </>
  );
}
