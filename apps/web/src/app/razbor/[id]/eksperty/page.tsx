import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { conversationForLead, selectableExperts } from "@/lib/chat";
import { expertPhotoUrls, formatRating } from "@/lib/experts";
import { getLead } from "@/lib/leads";
import { REVIEWS_PAGE_SIZE, expertReviews, reviewsCountLabel } from "@/lib/reviews";
import { getTexts } from "@/lib/texts";
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
  if (await conversationForLead(db, lead.id)) redirect(`/razbor/${lead.id}/chat`);

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
        <h1>{t["experts.title"]}</h1>
        {typeof error === "string" && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}
        {!anyOnline && <p className="lead text">{t["experts.none_online"]}</p>}
        <div className="experts">
          {sorted.map((e) => {
            const photo = photos.get(e.id);
            const r = reviews.get(e.id);
            return (
              <article key={e.id} className={`card expert ${e.isOnline ? "" : "expert--offline"}`}>
                <div className="expert__head">
                  <Avatar name={e.name} photo={photo} size={72} online={e.isOnline} busy={e.status === "busy"} />
                  <div>
                    <h2>{e.name}</h2>
                    <div className="expert__rating">
                      <span className="rating">★ {formatRating(e.rating)}</span>
                      {e.reviewsShown > 0 && <span className="muted">{reviewsCountLabel(e.reviewsShown)}</span>}
                    </div>
                    <span className={`status status--${e.status}`}>
                      {e.status === "online" ? "в сети" : e.status === "busy" ? t["experts.busy"] : "не в сети"}
                    </span>
                  </div>
                </div>
                {e.description && <p className="text">{e.description}</p>}
                {r && (
                  <details className="reviews">
                    <summary>Отзывы</summary>
                    <ReviewsPager reviews={r.latest} pageSize={REVIEWS_PAGE_SIZE} />
                  </details>
                )}
                {e.isOnline && (
                  <form action={chooseExpert} className="card__action">
                    <input type="hidden" name="leadId" value={lead.id} />
                    <input type="hidden" name="expertId" value={e.id} />
                    <button className="button">{t["experts.choose"]}</button>
                  </form>
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
