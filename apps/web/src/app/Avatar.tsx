import type { CSSProperties } from "react";

/** Первая буква имени для заглушки вместо фото; эмодзи в начале («🪬 Зинаида») пропускаем. */
export function initial(name: string): string {
  return name.match(/\p{L}/u)?.[0]?.toUpperCase() ?? "?";
}

/** Круглая аватарка: фото или первая буква имени; online — точка статуса в углу (busy — жёлтая). */
export function Avatar({
  name,
  photo,
  size = 40,
  online,
  busy,
  tone,
}: {
  name: string;
  photo?: string | null | undefined;
  size?: number;
  online?: boolean;
  busy?: boolean;
  /** Цвет буквы, когда фото нет: gold — эксперты и разбор, plain — клиент. */
  tone?: "gold" | "plain";
}) {
  return (
    <span className={`avatar avatar--${tone ?? "gold"}`} style={{ "--avatar-size": `${size}px` } as CSSProperties}>
      {photo ? (
        <img src={photo} alt="" width={size} height={size} loading="lazy" />
      ) : (
        <span aria-hidden="true">{initial(name)}</span>
      )}
      {online !== undefined && (
        <span className={online ? (busy ? "avatar__dot avatar__dot--busy" : "avatar__dot avatar__dot--on") : "avatar__dot"} aria-hidden="true" />
      )}
    </span>
  );
}
