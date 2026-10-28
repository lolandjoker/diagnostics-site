import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { listCertificates } from "@/lib/certificates";
import { expertGallery } from "@/lib/gallery";
import { clientChats } from "@/lib/chat";
import { expertPhotoUrls, expertStatus, expertTags, formatRating, getExpert, isOnline } from "@/lib/experts";
import { getLead, isUuid } from "@/lib/leads";
import { REVIEWS_PAGE_SIZE, expertReviews, reviewsCountLabel } from "@/lib/reviews";
import { getTexts } from "@/lib/texts";
import { Certificates } from "../../Certificates";
import { PhotoGallery } from "../../PhotoGallery";
import { Footer } from "../../Footer";
import { ReviewsPager } from "../../ReviewsPager";
import { chooseExpert } from "../../razbor/[id]/eksperty/actions";

export const dynamic = "force-dynamic";

/**
 * Полный профиль эксперта: фото, рейтинг, специализации, подробное описание, сертификаты, отзывы.
 * ?lead=<заявка>&c=<чат> — человек пришёл из чата: назад — в чат, а внизу — «Открыть чат»
 * (с этим экспертом уже переписывался) или «Написать эксперту».
 */
export default async function ExpertProfilePage(props: PageProps<"/ekspert/[id]">) {
  const { id } = await props.params;
  const { lead: leadParam, c, error } = await props.searchParams;
  const db = await getDb();
  const expert = /^\d{1,9}$/.test(id) ? await getExpert(db, Number(id)) : null;
  if (!expert || !expert.active || expert.deletedAt) notFound();

  const lead = typeof leadParam === "string" ? await getLead(db, leadParam) : null;
  const [photos, certificates, reviews, chats, t] = await Promise.all([
    expertPhotoUrls(db),
    listCertificates(db, expert.id),
    expertReviews(db, [expert.id]),
    lead ? clientChats(db, lead.id) : Promise.resolve([]),
    getTexts(db, ["experts.busy", "experts.choose"]),
  ]);
  const gallery = await expertGallery(db, expert.id, photos.get(expert.id) ?? null);
  const status = expertStatus(expert, new Date());
  const tags = expertTags(expert.tags);
  const r = reviews.get(expert.id);
  const withExpert = chats.find((ch) => ch.expertId === expert.id);
  const fromChat = typeof c === "string" && isUuid(c) ? chats.find((ch) => ch.id === c) : undefined;
  const self = lead ? `/ekspert/${expert.id}?lead=${lead.id}${fromChat ? `&c=${fromChat.id}` : ""}` : "";

  return (
    <>
      <main className="page page--profile">
        {lead && (
          <p>
            {fromChat ? (
              <Link href={`/razbor/${lead.id}/chat?c=${fromChat.id}`}>← Вернуться в чат</Link>
            ) : (
              <Link href={`/razbor/${lead.id}/eksperty`}>← Все эксперты</Link>
            )}
          </p>
        )}

        <section className="profile">
          <PhotoGallery photos={gallery} name={expert.name} className="profile__photo" />
          <div className="profile__head">
            <h1>{expert.name}</h1>
            <span className={`status status--${status}`}>
              {status === "online" ? "в сети" : status === "busy" ? t["experts.busy"] : "не в сети"}
            </span>
            <div className="expert__rating profile__rating">
              <span className="rating">★ {formatRating(expert.rating)}</span>
              {expert.reviewsShown > 0 && <span className="muted">{reviewsCountLabel(expert.reviewsShown)}</span>}
            </div>
            {tags.length > 0 && (
              <ul className="tags">
                {tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            )}
            {expert.description && <p className="text profile__lead">{expert.description}</p>}

            {lead && (
              <div className="profile__action">
                {typeof error === "string" && (
                  <p className="form__error" role="alert">
                    {error}
                  </p>
                )}
                {withExpert ? (
                  <Link className="button" href={`/razbor/${lead.id}/chat?c=${withExpert.id}`}>
                    Открыть чат
                  </Link>
                ) : (
                  // Первый чат — только с экспертом в сети; когда чаты уже есть, написать можно любому
                  (chats.length > 0 || isOnline(expert, new Date())) && (
                    <form action={chooseExpert}>
                      <input type="hidden" name="leadId" value={lead.id} />
                      <input type="hidden" name="expertId" value={expert.id} />
                      <input type="hidden" name="return" value={self} />
                      <button className="button">{chats.length > 0 ? "Написать эксперту" : t["experts.choose"]}</button>
                    </form>
                  )
                )}
              </div>
            )}
          </div>
        </section>

        {expert.about && (
          <section className="card profile__section">
            <h2>О себе</h2>
            <p className="text">{expert.about}</p>
          </section>
        )}

        {certificates.length > 0 && (
          <section className="card profile__section">
            <h2>Сертификаты</h2>
            <Certificates items={certificates} />
          </section>
        )}

        {r && (
          <section className="card profile__section reviews reviews--open">
            <h2>Отзывы</h2>
            <ReviewsPager reviews={r.latest} pageSize={REVIEWS_PAGE_SIZE} />
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
