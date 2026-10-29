import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { MAX_LEAD_EDITS, RESULT_LOADING_MS, getLead } from "@/lib/leads";
import { birthPortrait } from "@/lib/portrait";
import { fillTemplate, getTexts } from "@/lib/texts";
import { typograph } from "@/lib/typograph";
import { variationFor } from "@/lib/variations";
import { Footer } from "../../Footer";
import { Portrait } from "../../Portrait";
import { ResultLoading } from "../../ResultLoading";

export const dynamic = "force-dynamic";

export default async function ResultPage(props: PageProps<"/razbor/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const lead = await getLead(db, id);
  if (!lead) notFound();
  // Сразу после заявки разбор «считается» — анимация, потом страница обновится сама
  const loadingLeft = lead.createdAt.getTime() + RESULT_LOADING_MS - Date.now();
  if (loadingLeft > 0) return <ResultLoading leftMs={loadingLeft} totalMs={RESULT_LOADING_MS} />;

  const t = await getTexts(db, [
    "result.title",
    "result.intro",
    "result.expert_title",
    "result.expert_text",
    "result.expert_button",
  ]);
  const vars = { name: lead.name };
  const variation = await variationFor(db, lead.variationId);
  const editsLeft = MAX_LEAD_EDITS - lead.edits;

  return (
    <>
      <main className="page">
        <h1>{fillTemplate(t["result.title"], vars)}</h1>
        {t["result.intro"] && <p className="lead text">{typograph(fillTemplate(t["result.intro"], vars))}</p>}

        <Portrait portrait={birthPortrait(lead.name, lead.birthDate)} birthIso={lead.birthDate} />

        {variation?.shortText && (
          <section className="card">
            <p className="text">{typograph(fillTemplate(variation.shortText, vars))}</p>
          </section>
        )}

        <section className="card card--accent">
          <h2>{t["result.expert_title"]}</h2>
          {t["result.expert_text"] && <p className="text">{typograph(fillTemplate(t["result.expert_text"], vars))}</p>}
          <p className="card__action">
            {/* Сначала — список экспертов: человек сам выбирает, кому написать */}
            <Link className="button" href={`/razbor/${lead.id}/eksperty`}>
              {t["result.expert_button"]}
            </Link>
          </p>
        </section>

        <p className="again">
          {editsLeft > 0 ? (
            <Link className="button button--ghost" href={`/razbor/${lead.id}/izmenit`}>
              Изменить дату рождения
            </Link>
          ) : (
            "Имя и дату рождения больше изменить нельзя"
          )}
        </p>
      </main>
      <Footer />
    </>
  );
}
