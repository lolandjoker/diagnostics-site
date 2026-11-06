"use client";

/**
 * Чаты для админа, операторов и экспертов как в мессенджере: слева список всех чатов, справа открытый чат.
 * Стоит в layout раздела чатов — при переходе из чата в чат список не перерисовывается (поиск
 * и вкладка сохраняются), меняется только правая часть. Открытый чат — по адресу страницы.
 * На телефоне — что-то одно: на странице «Чаты» список, в чате — чат на весь экран со стрелкой «назад»
 * в шапке (шапка панели в открытом чате прячется). Чат появляется плавно.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, createContext, useContext, useState } from "react";
import { Avatar } from "./Avatar";
import { InboxList } from "./InboxList";
import { GeoTag, TelegramBadge } from "./StaffBits";

/** Куда «назад» (список) и база адресов чатов — для шапки открытого чата. */
const Nav = createContext<{ listHref: string; linkBase: string } | null>(null);

/** Чат клиента в шапке: с каким экспертом, где разбор. */
export interface HeadChat {
  id: string;
  expertName: string;
  diagnosis: boolean;
}

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
    <Nav.Provider value={{ listHref, linkBase }}>
      <div className={currentId ? "staff-messenger staff-messenger--open" : "staff-messenger"}>
        <aside className="staff-messenger__list">
          <InboxList
            url={inboxUrl}
            searchUrl={inboxUrl.replace(/inbox$/, "search")}
            linkBase={linkBase}
            {...(meId !== undefined && { meId })}
            {...(currentId && { currentId })}
          />
        </aside>
        <section className="staff-messenger__chat">
          <div className="staff-messenger__pane" key={currentId ?? "empty"}>
            {children}
          </div>
        </section>
      </div>
    </Nav.Provider>
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
  blocked = false,
  blockUrl,
  chats = [],
  currentId,
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
  /** Клиент заблокирован. */
  blocked?: boolean;
  /** Админ и операторы: блокировать / разблокировать (POST / DELETE). */
  blockUrl?: string;
  /** Все чаты клиента (по времени начала) — если их больше одного, показываем, где он был и где получил разбор. */
  chats?: HeadChat[];
  /** Открытый чат. */
  currentId?: string;
}) {
  const nav = useContext(Nav);
  const listHref = nav?.listHref;
  const shortName = (n: string) => n.split("|")[0]!.trim();
  const here = chats.findIndex((c) => c.id === currentId);
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
            {blocked && <span className="block-badge">заблокирован</span>}
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
        {blockUrl && <BlockControl url={blockUrl} blocked={blocked} />}
        {info && (
          <details className="staff-chat__info">
            <summary aria-label="Пояснение" title="Пояснение">
              i
            </summary>
            <div className="staff-chat__info-body">{info}</div>
          </details>
        )}
      </header>
      {chats.length > 1 && (
        <nav className="staff-chat__chats" aria-label="Чаты клиента">
          <span className="muted">
            {here > 0 ? "Перешёл сюда от другого эксперта. Все чаты клиента:" : "Чаты клиента:"}
          </span>
          {chats.map((c) =>
            c.id === currentId ? (
              <span key={c.id} className="staff-chat__chat is-current">
                {shortName(c.expertName)} · здесь{c.diagnosis ? " · разбор" : ""}
              </span>
            ) : (
              <Link key={c.id} className="staff-chat__chat" href={`${nav?.linkBase ?? ""}/${c.id}`}>
                {shortName(c.expertName)}
                {c.diagnosis ? " · разбор" : ""}
              </Link>
            ),
          )}
        </nav>
      )}
      {blocked && (
        <p className="notice notice--error staff-chat__note">
          Клиент заблокирован: не может писать на сайте и в Telegram, бот ему ничего не отправляет.
        </p>
      )}
      {warning}
    </>
  );
}

/** «Заблокировать» с подтверждением прямо в шапке (без окон браузера); «Разблокировать» — сразу. */
function BlockControl({ url, blocked }: { url: string; blocked: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(block: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: block ? "POST" : "DELETE" });
      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Не получилось");
        return;
      }
      setConfirm(false);
      router.refresh();
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  if (blocked) {
    return (
      <button type="button" className="block-btn" disabled={busy} onClick={() => void run(false)}>
        Разблокировать
      </button>
    );
  }
  return confirm ? (
    <div className="block-confirm" role="group" aria-label="Заблокировать клиента">
      <span>Заблокировать клиента на сайте и в Telegram?</span>
      <button type="button" className="block-btn block-btn--danger" disabled={busy} onClick={() => void run(true)}>
        Заблокировать
      </button>
      <button type="button" className="block-btn" onClick={() => setConfirm(false)}>
        Отмена
      </button>
      {error && <span className="block-confirm__error">{error}</span>}
    </div>
  ) : (
    <button type="button" className="block-btn" onClick={() => setConfirm(true)} title="Заблокировать клиента">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="m6 6 12 12" />
      </svg>
      <span className="block-btn__label">Заблокировать</span>
    </button>
  );
}
