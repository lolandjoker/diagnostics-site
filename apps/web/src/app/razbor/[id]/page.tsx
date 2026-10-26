import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { conversationForLead } from "@/lib/chat";
import { getLead } from "@/lib/leads";
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
    "result.expert_title",
    "result.expert_text",
    "result.expert_button",
  ]);
  const vars = { name: lead.name };
  const [variation, chat] = await Promise.all([variationFor(db, lead.variationId), conversationForLead(db, lead.id)]);

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

        <section className="card card--accent">
          <h2>{t["result.expert_title"]}</h2>
          {t["result.expert_text"] && <p className="text">{fillTemplate(t["result.expert_text"], vars)}</p>}
          <p className="card__action">
            <Link className="button" href={chat ? `/razbor/${lead.id}/chat` : `/razbor/${lead.id}/eksperty`}>
              {t["result.expert_button"]}
            </Link>
          </p>
        </section>

        <p className="again">
          <Link href="/?new=1">Сделать разбор для другого человека</Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
