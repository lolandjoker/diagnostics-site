import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getLead } from "@/lib/leads";
import { formatRub, offerForLead } from "@/lib/offers";
import { getTexts } from "@/lib/texts";
import { Footer } from "../../../../Footer";
import { OrderForm } from "./OrderForm";

export const dynamic = "force-dynamic";

export default async function OrderPage(props: PageProps<"/razbor/[id]/zakaz/[productId]">) {
  const { id, productId } = await props.params;
  const db = await getDb();
  const lead = await getLead(db, id);
  const pid = Number(productId);
  if (!lead || !Number.isInteger(pid)) notFound();
  const offer = await offerForLead(db, lead.id, pid);
  if (!offer) notFound();

  const t = await getTexts(db, ["order.title", "order.email_hint", "order.button"]);
  return (
    <>
      <main className="page page--narrow">
        <h1>{t["order.title"]}</h1>
        <section className="card">
          <h2>{offer.product.title}</h2>
          {offer.product.description && <p className="text">{offer.product.description}</p>}
          <p className="price">{formatRub(offer.variant.amountKopecks)}</p>
        </section>
        <OrderForm leadId={lead.id} productId={offer.product.id} hint={t["order.email_hint"]} button={t["order.button"]} />
      </main>
      <Footer />
    </>
  );
}
