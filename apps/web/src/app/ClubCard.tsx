/**
 * Карточка «Клуба Таромбы» — одна и та же везде: что внутри и как вступить (подключить Telegram).
 * Вступил — что уже открыто. soon — пометка «скоро» для того, чего ещё нет.
 */
const icon = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
);

const PERKS: { d: string; text: string; soon?: boolean }[] = [
  { d: '<rect x="5" y="3" width="12" height="18" rx="2"/><path d="m11 9 1 2 2 .5-1.5 1.5.4 2.2L11 14l-1.9 1.2.4-2.2L8 11.5l2-.5Z"/>', text: "Карта дня каждое утро" },
  { d: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>', text: "Серия дней подряд" },
  { d: '<path d="M4 5h16v10H9l-5 4z"/>', text: "Ответы экспертов в Telegram — отвечать можно оттуда же" },
  { d: '<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/>', text: "Совместимость пары по датам рождения" },
  { d: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>', text: "Тест «Ваш архетип» — с результатом для сторис" },
  { d: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9.5 10.5 11.5 12.5 15 9"/>', text: "«Да или нет» — карта на ваш вопрос" },
];

export function ClubCard({ connected, telegramHref }: { connected: boolean; telegramHref: string | null }) {
  return (
    <section className={`club ${connected ? "club--in" : ""}`} aria-labelledby="club-title">
      <span className="eyebrow">{connected ? "Вы в клубе" : "Бесплатно"}</span>
      <h2 id="club-title" className="club__title">
        Клуб Таромбы
      </h2>
      <ul className="club__perks">
        {PERKS.map((p) => (
          <li key={p.text} className={p.soon ? "is-soon" : undefined}>
            {icon(p.d)}
            <span>
              {p.text}
              {p.soon && <small> · скоро</small>}
            </span>
          </li>
        ))}
      </ul>
      {connected ? (
        <p className="club__ok">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="m5 12.5 4.5 4.5L19 7" />
          </svg>
          Telegram подключён — карта дня придёт утром
        </p>
      ) : (
        telegramHref && (
          <a className="button club__go" href={telegramHref} target="_blank" rel="noopener noreferrer">
            Вступить через Telegram
          </a>
        )
      )}
    </section>
  );
}
