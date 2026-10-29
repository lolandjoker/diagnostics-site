import Link from "next/link";

export const BRAND = "Таромба";

const TICKS = Array.from({ length: 12 }, (_, i) => i * 30);

/**
 * Эмблема: зодиакальный круг (12 делений, как на круге загрузки разбора), внутри полумесяц и звезда.
 * Полумесяц — две дуги окружностей, без масок: эмблем на странице может быть несколько.
 */
export function Emblem({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" stroke="currentColor" aria-hidden="true">
      <g className="brand__wheel">
        <circle cx="32" cy="32" r="30" strokeWidth="1.1" />
        <circle cx="32" cy="32" r="25.6" strokeWidth="0.6" opacity="0.5" />
        {TICKS.map((deg) => (
          <path key={deg} d="M32 2.6v3.6" strokeWidth="1" transform={`rotate(${deg} 32 32)`} />
        ))}
        {TICKS.map((deg) => (
          <circle key={deg} cx="32" cy="4.4" r="0.55" fill="currentColor" stroke="none" transform={`rotate(${deg + 15} 32 32)`} />
        ))}
      </g>
      <path d="M29.91 19.03A13 13 0 1 0 39.92 39.06A11.2 11.2 0 0 1 29.91 19.03Z" fill="currentColor" stroke="none" />
      <path
        className="brand__star"
        d="M41 22.6 42.05 26.45 45.9 27.5 42.05 28.55 41 32.4 39.95 28.55 36.1 27.5 39.95 26.45Z"
        fill="#fff3d6"
        stroke="none"
      />
      <circle cx="45.6" cy="35.4" r="0.9" fill="#fff3d6" stroke="none" />
    </svg>
  );
}

/**
 * Знак и название сервиса — ссылка на главную. hero — крупно над формой на главной (с подписью),
 * bar — в шапке остальных страниц.
 */
export function Brand({ variant }: { variant: "hero" | "bar" }) {
  return (
    <Link href="/" className={`brand brand--${variant}`} aria-label={`${BRAND} — на главную`}>
      <Emblem className="brand__mark" />
      <span className="brand__text">
        <span className="brand__name">{BRAND}</span>
        {variant === "hero" && <span className="brand__tagline">астрология · таро · нумерология</span>}
      </span>
    </Link>
  );
}
