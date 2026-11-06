"use client";

/**
 * Чаты для админа, операторов и экспертов как в мессенджере: слева список всех чатов, справа открытый чат.
 * Стоит в layout раздела чатов — при переходе из чата в чат список не перерисовывается (поиск
 * и вкладка сохраняются), меняется только правая часть. Открытый чат — по адресу страницы.
 * На телефоне — что-то одно: на странице «Чаты» список, в чате — чат на весь экран со стрелкой «назад»
 * в шапке (шапка панели в открытом чате прячется). Чат появляется плавно.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, createContext, useContext } from "react";
import { Avatar } from "./Avatar";
import { InboxList } from "./InboxList";
import { GeoTag, TelegramBadge } from "./StaffBits";

const ListHref = createContext<string | null>(null);

export function StaffMessenger({
  inboxUrl,
  linkBase,
  listHref,
  meId,
  children,
}: {
  inboxUrl: string;
  /** Адрес чата — `${linkBase}/<id>`. */
  linkBase: string;
  /** Страница со списком — для «назад» на телефоне. */
  listHref: string;
  meId?: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const prefix = `${linkBase}/`;
  const currentId = pathname.startsWith(prefix) ? pathname.slice(prefix.length).split("/")[0] : undefined;
  return (
    <ListHref.Provider value={listHref}>
      <div className={currentId ? "staff-messenger staff-messenger--open" : "staff-messenger"}>
        <aside className="staff-messenger__list">
          <InboxList url={inboxUrl} linkBase={linkBase} {...(meId !== undefined && { meId })} {...(currentId && { currentId })} />
        </aside>
        <section className="staff-messenger__chat">
          <div className="staff-messenger__pane" key={currentId ?? "empty"}>
            {children}
          </div>
        </section>
      </div>
    </ListHref.Provider>
  );
}

/** Правая часть, пока чат не выбран. */
export function StaffChatEmpty({ children }: { children?: ReactNode }) {
  return <div className="staff-messenger__placeholder muted">{children ?? <p>Выберите чат слева</p>}</div>;
}

/**
 * Шапка открытого чата: «назад» (телефон), клиент, пометки (Telegram, город), дата рождения и эксперт.
 * warning — всегда на виду (эксперт в архиве, чужой чат); info — пояснение, по кнопке «i».
 */
export function StaffChatHead({
  name,
  birthDate,
  expertName,
  mine,
  telegram,
  geoCountry,
  geoCity,
  warning,
  info,
}: {
  name: string;
  /** ГГГГ-ММ-ДД */
  birthDate: string | null;
  expertName: string | null;
  /** Эксперт открыл свой чат — «(вы)». */
  mine?: boolean;
  telegram: boolean;
  geoCountry: string | null;
  geoCity: string | null;
  warning?: ReactNode;
  info?: ReactNode;
}) {
  const listHref = useContext(ListHref);
  return (
    <>
      <header className="staff-chat__head">
        {listHref && (
          <Link className="staff-chat__back" href={listHref} aria-label="Все чаты" title="Все чаты">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        )}
        <Avatar name={name} size={42} tone="plain" />
        <div className="staff-chat__who">
          <h1>
            {name}
            {telegram && <TelegramBadge />}
          </h1>
          <p className="staff-chat__tags">
            <GeoTag country={geoCountry} city={geoCity} />
            {birthDate && <span>{birthDate.split("-").reverse().join(".")}</span>}
            {expertName && (
              <span>
                Эксперт: {expertName}
                {mine ? " (вы)" : ""}
              </span>
            )}
          </p>
        </div>
        {info && (
          <details className="staff-chat__info">
            <summary aria-label="Пояснение" title="Пояснение">
              i
            </summary>
            <div className="staff-chat__info-body">{info}</div>
          </details>
        )}
      </header>
      {warning}
    </>
  );
}
