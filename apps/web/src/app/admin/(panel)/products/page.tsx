import Link from "next/link";
import { getDb } from "@/db";
import { listProducts } from "@/lib/offers";
import { ActionForm } from "../../ActionForm";
import { createProductAction } from "../../actions";

export default async function ProductsPage() {
  const list = await listProducts(await getDb());
  return (
    <>
      <h1>Продукты и цены</h1>
      <p className="muted">
        Включённый продукт с хотя бы одной активной ценой можно предложить в чате, а с галочкой «под разбором» — он
        ещё и виден на странице разбора.
        Вариантов цены может быть несколько: каждому человеку достаётся один, случайно, и дальше не меняется.
      </p>

      {list.length > 0 && (
        <ul className="list">
          {list.map((p) => (
            <li key={p.id} className={p.active ? "" : "muted"}>
              <Link href={`/admin/products/${p.id}`}>{p.title}</Link>
              {!p.active && " (выключен)"}
            </li>
          ))}
        </ul>
      )}

      <section className="admin-section">
        <h2>Новый продукт</h2>
        <ActionForm action={createProductAction}>
          <label className="field">
            <span>Название</span>
            <input name="title" required />
          </label>
          <button className="button">Создать</button>
        </ActionForm>
      </section>
    </>
  );
}
