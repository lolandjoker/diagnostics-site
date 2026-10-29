import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { clientChats, conversationForLead, selectableExperts } from "@/lib/chat";
import { expertPhotoUrls, formatRating } from "@/lib/experts";
import { MAX_LEAD_EDITS, getLead } from "@/lib/leads";
import { REVIEWS_PAGE_SIZE, expertReviews, reviewsCountLabel } from "@/lib/reviews";
import { getTexts } from "@/lib/texts";
import { typograph } from "@/lib/typograph";
import { Avatar } from "../../../Avatar";
import { Footer } from "../../../Footer";
import { ReviewsPager } from "../../../ReviewsPager";
import { chooseExpert } from "./actions";

export const dynamic = "force-dynamic";

export default async function ExpertsPage(props: PageProps<"/razbor/[id]/eksperty">) {
  const { id } = await props.params;
  const { error } = await props.searchParams;
  const db = await getDb();
  const lead = await getLead(db, id);
  if (!lead) notFound();
  // Чат уже есть — написать можно любому эксперту, у каждого свой чат
  const chat = await conversationForLead(db, lead.id);
  const chatWith = new Map((chat ? await clientChats(db, lead.id) : []).map((c) => [c.expertId, c.id]));

  const [list, photos, t] = await Promise.all([
    selectableExperts(db, new Date()),
    expertPhotoUrls(db),
    getTexts(db, ["experts.title", "experts.none_online", "experts.choose", "experts.busy"]),
  ]);
  // Сначала свободные, потом занятые, в конце — не в сети
  const order = { online: 0, busy: 1, offline: 2 } as const;
  const sorted = [...list].sort((a, b) => order[a.status] - order[b.status]);
  const anyOnline = sorted.some((e) => e.isOnline);
  const reviews = await expertReviews(
    db,
    sorted.map((e) => e.id),
  );

  return (
    <>
      <main className="page">
        <p className="page__links">
          {chat ? <Link href={`/razbor/${lead.id}/chat`}>← Вернуться в чат</Link> : <Link href={`/razbor/${lead.id}`}>← К разбору</Link>}
          {lead.edits < MAX_LEAD_EDITS && <Link href={`/razbor/${lead.id}/izmenit`}>Изменить дату рождения</Link>}
        </p>
        <h1>{chat ? "Эксперты" : t["experts.title"]}</h1>
        {chat && (
          <p className="lead text">
            Написать можно любому эксперту — у каждого свой чат, все переписки сохраняются в списке.
          </p>
        )}
        {typeof error === "string" && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}
        {!chat && !anyOnline && <p className="lead text">{t["experts.none_online"]}</p>}
        <div className="experts">
          {sorted.map((e) => {
            const photo = photos.get(e.id);
            const r = reviews.get(e.id);
            return (
              <article key={e.id} className={`card expert ${e.isOnline ? "" : "expert--offline"}`}>
                <div className="expert__head">
                  <Avatar name={e.name} photo={photo} size={72} online={e.isOnline} busy={e.status === "busy"} />
                  <div>
                    <h2>
                      <Link className="expert__name-link" href={`/ekspert/${e.id}?lead=${lead.id}`}>
                        {e.name}
                      </Link>
                    </h2>
                    <div className="expert__rating">
                      <span className="rating">★ {formatRating(e.rating)}</span>
                      {e.reviewsShown > 0 && <span className="muted">{reviewsCountLabel(e.reviewsShown)}</span>}
                    </div>
                    <span className={`status status--${e.status}`}>
                      {e.status === "online" ? "в сети" : e.status === "busy" ? t["experts.busy"] : "не в сети"}
                    </span>
                  </div>
                </div>
                {e.description && <p className="text">{typograph(e.description)}</p>}
                <p className="expert__profile-link">
                  <Link href={`/ekspert/${e.id}?lead=${lead.id}`}>Профиль, сертификаты и все отзывы →</Link>
                </p>
                {r && (
                  <details className="reviews">
                    <summary>Отзывы</summary>
                    <ReviewsPager reviews={r.latest} pageSize={REVIEWS_PAGE_SIZE} />
                  </details>
                )}
                {chat ? (
                  chatWith.has(e.id) ? (
                    <p className="card__action">
                      {e.id === chat.expertId && <span className="your-expert">Ваш эксперт</span>}{" "}
                      <Link className="button button--ghost" href={`/razbor/${lead.id}/chat?c=${chatWith.get(e.id)}`}>
                        Открыть чат
                      </Link>
                    </p>
                  ) : (
                    <form action={chooseExpert} className="card__action">
                      <input type="hidden" name="leadId" value={lead.id} />
                      <input type="hidden" name="expertId" value={e.id} />
                      <button className="button button--ghost">Написать эксперту</button>
                    </form>
                  )
                ) : (
                  e.isOnline && (
                    <form action={chooseExpert} className="card__action">
                      <input type="hidden" name="leadId" value={lead.id} />
                      <input type="hidden" name="expertId" value={e.id} />
                      <button className="button">{t["experts.choose"]}</button>
                    </form>
                  )
                )}
              </article>
            );
          })}
        </div>
      </main>
      <Footer />
    </>
  );
}
