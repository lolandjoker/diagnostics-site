import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { MIN_EXPERT_PASSWORD, expertPhotoUrls, formatRating, getExpert } from "@/lib/experts";
import { ActionForm } from "../../../ActionForm";
import { OnlineToggle } from "../../../OnlineToggle";
import { DeleteForm } from "../../../DeleteForm";
import { deleteExpertAction, updateExpertAction } from "../../../actions";

export default async function ExpertAdminPage(props: PageProps<"/admin/experts/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const expert = /^\d+$/.test(id) ? await getExpert(db, Number(id)) : null;
  if (!expert || expert.deletedAt) notFound();
  const photo = (await expertPhotoUrls(db)).get(expert.id);

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
          <span>Описание (на карточке выбора эксперта)</span>
          <textarea name="description" defaultValue={expert.description} rows={5} />
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
