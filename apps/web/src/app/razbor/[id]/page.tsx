import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { conversationForLead } from "@/lib/chat";
import { buildDiagnostic, parseIsoDate } from "@/lib/diagnostic";
import { getLead } from "@/lib/leads";
import { formatRub, offersForLead } from "@/lib/offers";
import { fillTemplate, getTexts } from "@/lib/texts";
import { variationFor } from "@/lib/variations";
import { Footer } from "../../Footer";

export const dynamic = "force-dynamic";

export default async function ResultPage(props: PageProps<"/razbor/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const lead = await getLead(db, id);
  if (!lead) notFound();

  const t = await getTexts(db, [
    "result.title",
    "result.intro",
    "result.offers_title",
    "result.buy_button",
    "result.expert_title",
    "result.expert_text",
    "result.expert_button",
  ]);
  const vars = { name: lead.name };
  const input = { birth: parseIsoDate(lead.birthDate), name: lead.name, year: new Date().getUTCFullYear() };
  const [variation, sections, offers, chat] = await Promise.all([
    variationFor(db, lead.variationId),
    buildDiagnostic(db, input),
    offersForLead(db, lead.id),
    conversationForLead(db, lead.id),
  ]);

  return (
    <>
      <main className="page">
        <h1>{fillTemplate(t["result.title"], vars)}</h1>
        {t["result.intro"] && <p className="lead text">{fillTemplate(t["result.intro"], vars)}</p>}

        {variation?.shortText && (
          <section className="card">
            <p className="text">{fillTemplate(variation.shortText, vars)}</p>
          </section>
        )}

        {sections.map((s) => (
          <section key={s.blockId} className="card">
            <h2>
              {s.title}: <span className="accent">{s.valueLabel}</span>
            </h2>
            <p className="text">{fillTemplate(s.body, vars)}</p>
          </section>
        ))}

        <section className="card card--accent">
          <h2>{t["result.expert_title"]}</h2>
          {t["result.expert_text"] && <p className="text">{fillTemplate(t["result.expert_text"], vars)}</p>}
          <p className="card__action">
            <Link className="button" href={chat ? `/razbor/${lead.id}/chat` : `/razbor/${lead.id}/eksperty`}>
              {t["result.expert_button"]}
            </Link>
          </p>
        </section>

        {offers.length > 0 && (
          <section className="offers">
            <h2>{t["result.offers_title"]}</h2>
            {offers.map(({ product, variant }) => (
              <article key={product.id} className="card offer">
                <h3>{product.title}</h3>
                {product.description && <p className="text">{product.description}</p>}
                <div className="offer__buy">
                  <span className="price">{formatRub(variant.amountKopecks)}</span>
                  <Link className="button" href={`/razbor/${lead.id}/zakaz/${product.id}`}>
                    {t["result.buy_button"]}
                  </Link>
                </div>
              </article>
            ))}
          </section>
        )}

        <p className="again">
          <Link href="/?new=1">Сделать разбор для другого человека</Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
