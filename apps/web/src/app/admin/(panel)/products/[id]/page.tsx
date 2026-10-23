import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { formatRub, getProduct, listVariants } from "@/lib/offers";
import { ActionForm } from "../../../ActionForm";
import { addVariantAction, toggleVariantAction, updateProductAction } from "../../../actions";

export default async function ProductPage(props: PageProps<"/admin/products/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const product = /^\d+$/.test(id) ? await getProduct(db, Number(id)) : null;
  if (!product) notFound();
  const variants = await listVariants(db, product.id);
  const activeCount = variants.filter((v) => v.active).length;

  return (
    <>
      <p>
        <Link href="/admin/products">← Все продукты</Link>
      </p>
      <h1>{product.title}</h1>
      {product.active && activeCount === 0 && (
        <p className="notice notice--error">Продукт включён, но активных цен нет — на сайте он не виден.</p>
      )}

      <ActionForm action={updateProductAction}>
        <input type="hidden" name="id" value={product.id} />
        <label className="field">
          <span>Название</span>
          <input name="title" defaultValue={product.title} required />
        </label>
        <label className="field">
          <span>Описание (на странице разбора)</span>
          <textarea name="description" defaultValue={product.description} rows={6} />
        </label>
        <label className="field">
          <span>Что получает человек (уходит письмом после оплаты: текст, ссылки)</span>
          <textarea name="delivery" defaultValue={product.delivery} rows={6} />
        </label>
        <div className="row">
          <label className="field field--short">
            <span>Порядок</span>
            <input name="sort" type="number" defaultValue={product.sort} />
          </label>
          <label className="check">
            <input name="active" type="checkbox" defaultChecked={product.active} />
            <span>Показывать на сайте</span>
          </label>
        </div>
        <button className="button">Сохранить</button>
      </ActionForm>

      <section className="admin-section">
        <h2>Варианты цены</h2>
        {variants.length === 0 ? (
          <p className="muted">Пока нет ни одной цены.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Вариант</th>
                  <th>Цена</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={v.id} className={v.active ? "" : "muted"}>
                    <td>{v.label || `№ ${v.id}`}</td>
                    <td>{formatRub(v.amountKopecks)}</td>
                    <td>{v.active ? "показывается" : "выключен"}</td>
                    <td>
                      <form action={toggleVariantAction}>
                        <input type="hidden" name="id" value={v.id} />
                        <input type="hidden" name="active" value={v.active ? "false" : "true"} />
                        <button className="link-button">{v.active ? "Выключить" : "Включить"}</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          Цену после создания изменить нельзя — иначе статистика смешает разные цены. Нужна другая — добавьте новый
          вариант и выключите старый.
        </p>
        <ActionForm action={addVariantAction} resetOnSuccess>
          <input type="hidden" name="productId" value={product.id} />
          <div className="row">
            <label className="field field--short">
              <span>Цена, ₽</span>
              <input name="price" inputMode="decimal" required placeholder="2950" />
            </label>
            <label className="field">
              <span>Подпись для себя (необязательно)</span>
              <input name="label" placeholder="например: «Низкая»" />
            </label>
          </div>
          <button className="button">Добавить цену</button>
        </ActionForm>
      </section>
    </>
  );
}
