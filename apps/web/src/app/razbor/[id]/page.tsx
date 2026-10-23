import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { buildDiagnostic, parseIsoDate } from "@/lib/diagnostic";
import { getLead } from "@/lib/leads";
import { formatRub, offersForLead } from "@/lib/offers";
import { fillTemplate, getTexts } from "@/lib/texts";
import { Footer } from "../../Footer";

export const dynamic = "force-dynamic";

export default async function ResultPage(props: PageProps<"/razbor/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const lead = await getLead(db, id);
  if (!lead) notFound();

  const t = await getTexts(db, ["result.title", "result.intro", "result.offers_title", "result.buy_button"]);
  const vars = { name: lead.name };
  const sections = await buildDiagnostic(db, {
    birth: parseIsoDate(lead.birthDate),
    name: lead.name,
    year: new Date().getUTCFullYear(),
  });
  const offers = await offersForLead(db, lead.id);

  return (
    <>
      <main className="page">
        <h1>{fillTemplate(t["result.title"], vars)}</h1>
        {t["result.intro"] && <p className="lead text">{fillTemplate(t["result.intro"], vars)}</p>}

        {sections.map((s) => (
          <section key={s.blockId} className="card">
            <h2>
              {s.title}: <span className="accent">{s.valueLabel}</span>
            </h2>
            <p className="text">{fillTemplate(s.body, vars)}</p>
          </section>
        ))}

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
      </main>
      <Footer />
    </>
  );
}
