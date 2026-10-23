import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { formatRub } from "@/lib/offers";
import { getOrderWithProduct, orderNumber } from "@/lib/orders";
import { fillTemplate, getTexts, isSafeUrl } from "@/lib/texts";
import { Footer } from "../../Footer";

export const dynamic = "force-dynamic";

const MESSENGERS = [
  ["links.telegram", "Telegram"],
  ["links.whatsapp", "WhatsApp"],
  ["links.max", "MAX"],
] as const;

export default async function OrderStatusPage(props: PageProps<"/zakaz/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const row = await getOrderWithProduct(db, id);
  if (!row) notFound();
  const { order, product } = row;

  const t = await getTexts(db, [
    "order.pending",
    "order.paid_title",
    "order.paid",
    "links.title",
    "links.telegram",
    "links.whatsapp",
    "links.max",
  ]);
  const vars = { product: product.title, order: orderNumber(order.id) };
  const links = MESSENGERS.filter(([key]) => isSafeUrl(t[key]));

  return (
    <>
      <main className="page page--narrow">
        {order.status === "paid" ? (
          <>
            <h1>{t["order.paid_title"]}</h1>
            <p className="lead text">{fillTemplate(t["order.paid"], vars)}</p>
            {links.length > 0 && (
              <section className="card">
                <h2>{t["links.title"]}</h2>
                <div className="links">
                  {links.map(([key, label]) => (
                    <a key={key} className="button button--ghost" href={t[key]} rel="noopener noreferrer" target="_blank">
                      {label}
                    </a>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : order.status === "cancelled" ? (
          <>
            <h1>Заказ № {vars.order} отменён</h1>
          </>
        ) : (
          <>
            <h1>Заказ № {vars.order}</h1>
            <section className="card">
              <h2>{product.title}</h2>
              <p className="price">{formatRub(order.amountKopecks)}</p>
              <p className="text">{fillTemplate(t["order.pending"], vars)}</p>
            </section>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
