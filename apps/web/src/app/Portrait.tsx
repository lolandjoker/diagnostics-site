import type { BirthPortrait, Element } from "@/lib/portrait";

/** Алхимические знаки стихий: огонь △, вода ▽, воздух и земля — с чертой. */
function ElementIcon({ element }: { element: Element }) {
  const up = element === "fire" || element === "air";
  const bar = element === "air" || element === "earth";
  return (
    <svg className="portrait__icon" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={up ? "M20 6 35 32H5Z" : "M20 34 35 8H5Z"} strokeLinejoin="round" />
      {bar && <path d={up ? "M10 23h20" : "M10 17h20"} strokeLinecap="round" />}
    </svg>
  );
}

const dateLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Шапка разбора: знаки Солнца и Луны, стихия и числа — посчитаны из даты и имени (lib/portrait.ts). */
export function Portrait({ portrait, birthIso }: { portrait: BirthPortrait; birthIso: string }) {
  const { sun, moon, element, lifePath, nameNumber } = portrait;
  const changed = [sun.signs.length > 1 && "Солнце", moon.signs.length > 1 && "Луна"].filter(Boolean);
  return (
    <section className="portrait" aria-label="Ваш портрет по дате рождения">
      <p className="portrait__date">{dateLabel.format(new Date(`${birthIso}T00:00:00Z`))}</p>
      <ul className="portrait__grid">
        <li className="portrait__item portrait__item--main">
          <span className="portrait__glyph" aria-hidden="true">
            {sun.glyphs}
          </span>
          <span>
            <span className="portrait__label">Знак Солнца</span>
            <b className="portrait__value portrait__value--main">{sun.label}</b>
          </span>
        </li>
        <li className="portrait__item">
          <span className="portrait__glyph portrait__glyph--small" aria-hidden="true">
            {"☾\uFE0E"}
          </span>
          <span className="portrait__label">Луна</span>
          <b className="portrait__value">{moon.label}</b>
        </li>
        <li className="portrait__item">
          <ElementIcon element={element.key} />
          <span className="portrait__label">Стихия</span>
          <b className="portrait__value">{element.name}</b>
          <span className="portrait__hint">{element.hint}</span>
        </li>
        <li className="portrait__item">
          <span className="portrait__number">{lifePath.value}</span>
          <span className="portrait__label">Число жизненного пути</span>
          <span className="portrait__hint">{lifePath.hint}</span>
        </li>
        {nameNumber && (
          <li className="portrait__item">
            <span className="portrait__number">{nameNumber.value}</span>
            <span className="portrait__label">Число имени</span>
            <span className="portrait__hint">{nameNumber.hint}</span>
          </li>
        )}
      </ul>
      {changed.length > 0 && (
        <p className="portrait__note">
          В день вашего рождения {changed.join(" и ")} {changed.length > 1 ? "сменили" : "сменила"} знак — точнее подскажет
          эксперт, если вы знаете время рождения.
        </p>
      )}
    </section>
  );
}
