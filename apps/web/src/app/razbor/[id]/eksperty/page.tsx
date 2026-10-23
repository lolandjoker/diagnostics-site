import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { conversationForLead, selectableExperts } from "@/lib/chat";
import { expertPhotoUrls } from "@/lib/experts";
import { getLead } from "@/lib/leads";
import { getTexts } from "@/lib/texts";
import { Footer } from "../../../Footer";
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
    getTexts(db, ["experts.title", "experts.none_online", "experts.choose"]),
  ]);
  // Сначала те, кто в сети
  const sorted = [...list.filter((e) => e.isOnline), ...list.filter((e) => !e.isOnline)];
  const anyOnline = sorted.some((e) => e.isOnline);

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
            return (
              <article key={e.id} className={`card expert ${e.isOnline ? "" : "expert--offline"}`}>
                <div className="expert__head">
                  {photo ? (
                    <img className="expert__photo" src={photo} alt="" width={72} height={72} />
                  ) : (
                    <div className="expert__photo expert__photo--empty" aria-hidden="true">
                      {e.name.slice(0, 1)}
                    </div>
                  )}
                  <div>
                    <h2>{e.name}</h2>
                    <span className={e.isOnline ? "status status--online" : "status"}>
                      {e.isOnline ? "в сети" : "не в сети"}
                    </span>
                  </div>
                </div>
                {e.description && <p className="text">{e.description}</p>}
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
