import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { MAX_LEAD_EDITS, getLead, isoToBirthDate } from "@/lib/leads";
import { Footer } from "../../../Footer";
import { LeadForm } from "../../../LeadForm";

export const dynamic = "force-dynamic";

/** Изменить имя и дату рождения — не больше MAX_LEAD_EDITS раз. Разбор после этого тот же. */
export default async function EditLeadPage(props: PageProps<"/razbor/[id]/izmenit">) {
  const { id } = await props.params;
  const lead = await getLead(await getDb(), id);
  if (!lead) notFound();
  const left = MAX_LEAD_EDITS - lead.edits;

  return (
    <>
      <main className="page page--narrow">
        <p className="back-link">
          <Link href={`/razbor/${lead.id}`}>← Назад к разбору</Link>
        </p>
        <h1>Изменить имя и дату рождения</h1>
        {left > 0 ? (
          <>
            <p className="lead text">
              Осталось изменений: {left} из {MAX_LEAD_EDITS}
            </p>
            <LeadForm button="Сохранить" edit={{ leadId: lead.id, name: lead.name, birthDate: isoToBirthDate(lead.birthDate) }} />
          </>
        ) : (
          <p className="lead text">Имя и дату рождения можно изменить только {MAX_LEAD_EDITS} раза — попытки закончились.</p>
        )}
      </main>
      <Footer />
    </>
  );
}
