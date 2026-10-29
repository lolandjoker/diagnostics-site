import type { Db } from "@/db";
import { getTexts } from "@/lib/texts";

const rub = new Intl.NumberFormat("ru-RU");

/**
 * «Консультация эксперта: ~~5 000 ₽~~ Бесплатно» — обычная цена консультации эксперта (настоящая,
 * задаётся в «Текстах сайта» → «Цена») и что сейчас бесплатно. Выключено или цена 0 — ничего.
 */
export async function PriceTag({ db, className }: { db: Db; className?: string }) {
  const t = await getTexts(db, ["price.show", "price.amount", "price.label", "price.free"]);
  const amount = Number(t["price.amount"]);
  if (t["price.show"] !== "1" || !Number.isFinite(amount) || amount <= 0) return null;
  return (
    <p className={className ? `price-tag ${className}` : "price-tag"}>
      {t["price.label"] && <span className="price-tag__label">{t["price.label"]}</span>}{" "}
      <s className="price-tag__old">
        {rub.format(amount)}
        {"\u00A0"}₽
      </s>{" "}
      <b className="price-tag__free">{t["price.free"]}</b>
    </p>
  );
}
