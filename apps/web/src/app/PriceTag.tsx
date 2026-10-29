import type { Db } from "@/db";
import { getTexts } from "@/lib/texts";

const rub = new Intl.NumberFormat("ru-RU");

export interface Price {
  /** «5 000 ₽» */
  old: string;
  label: string;
  free: string;
}

/**
 * Обычная цена консультации эксперта (настоящая, задаётся в «Текстах сайта» → «Цена») и что сейчас
 * бесплатно. null — показ выключен или цена 0.
 */
export async function getPrice(db: Db): Promise<Price | null> {
  const t = await getTexts(db, ["price.show", "price.amount", "price.label", "price.free"]);
  const amount = Number(t["price.amount"]);
  if (t["price.show"] !== "1" || !Number.isFinite(amount) || amount <= 0) return null;
  return { old: `${rub.format(amount)}\u00A0₽`, label: t["price.label"], free: t["price.free"] };
}

/** «Консультация эксперта: ~~5 000 ₽~~ Бесплатно» — у формы на главной и у «Написать эксперту» на разборе. */
export async function PriceTag({ db, className }: { db: Db; className?: string }) {
  const price = await getPrice(db);
  if (!price) return null;
  return (
    <p className={className ? `price-tag ${className}` : "price-tag"}>
      {price.label && <span className="price-tag__label">{price.label}</span>}{" "}
      <s className="price-tag__old">{price.old}</s> <b className="price-tag__free">{price.free}</b>
    </p>
  );
}

/** Справа от кнопки «Написать»: «~~5 000 ₽~~ Бесплатно» — в списке экспертов и в профиле. */
export function PriceInline({ price }: { price: Price | null }) {
  if (!price) return null;
  return (
    <span className="price-inline">
      <s className="price-tag__old">{price.old}</s> <b className="price-tag__free">{price.free}</b>
    </span>
  );
}
