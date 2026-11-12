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
import type { ClubStatus } from "@/lib/club-status";
import { GeoTag, MailIcon, TelegramBadge } from "./StaffBits";

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
  email,
  hasEmail = false,
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
  club,
}: {
  name: string;
  /** ГГГГ-ММ-ДД */
  birthDate: string | null;
  /** Админ и операторы: почта клиента для писем; null — не указал. */
  email?: string | null;
  /** Эксперт: клиент указал почту (без адреса). */
  hasEmail?: boolean;
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
  /** Что клиент прошёл в Клубе Таромбы — и кнопки напомнить о непройденном. */
  club?: ClubStatus | null;
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
            {(email || hasEmail) && (
              <span className="staff-chat__mail" title="Клиент указал почту — подробный разбор приходит и письмом">
                <MailIcon size={14} /> {email || "почта"}
              </span>
            )}
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
      {club && <ClubBar club={club} />}
      {blocked && (
        <p className="notice notice--error staff-chat__note">
          Клиент заблокирован: не может писать на сайте и в Telegram, бот ему ничего не отправляет.
        </p>
      )}
      {warning}
    </>
  );
}

/** Подставить текст в поле ввода открытого чата (ChatThread слушает событие). */
const insertIntoChat = (text: string) => window.dispatchEvent(new CustomEvent("chat:insert", { detail: text }));

const ago = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short" });

/**
 * «Клуб»: карта дня (серия), совместимость, архетип, «Да или нет». Пройдено — результат; не пройдено — кнопка
 * «напомнить», она подставляет готовое сообщение в поле ввода (его можно поправить перед отправкой).
 */
function ClubBar({ club }: { club: ClubStatus }) {
  const remind = (kind: keyof ClubStatus["reminders"], label: string) => (
    <button type="button" className="club-chip club-chip--todo" onClick={() => insertIntoChat(club.reminders[kind])} title="Подставить напоминание в поле ввода">
      {label} · <b>напомнить</b>
    </button>
  );
  return (
    <div className="club-bar" aria-label="Клуб Таромбы">
      <span className="club-bar__title">Клуб:</span>
      {club.cards.total > 0 ? (
        <span className="club-chip" title={`Всего карт: ${club.cards.total}${club.forecast ? ", карта по утрам в боте включена" : ""}`}>
          Карта дня{club.cards.streak > 1 ? ` · серия ${club.cards.streak}` : ""}
          {club.cards.today ? ` · сегодня «${club.cards.today}»` : " · сегодня не тянул(а)"}
        </span>
      ) : (
        remind("card", "Карта дня — не тянул(а)")
      )}
      {club.compat ? (
        <span className="club-chip" title={`Прошёл(ла) ${ago.format(new Date(club.compat.at))}`}>
          Совместимость{club.compat.total !== null ? ` ${club.compat.total}%` : ""}
          {club.compat.partner ? ` · ${club.compat.partner}` : ""}
        </span>
      ) : (
        remind("compat", "Совместимость — нет")
      )}
      {club.archetype ? (
        <span className="club-chip" title={`Прошёл(ла) ${ago.format(new Date(club.archetype.at))}`}>
          Архетип · {club.archetype.name}
        </span>
      ) : (
        remind("archetype", "Архетип — нет")
      )}
      {club.yesno ? (
        <span className="club-chip" title={`«${club.yesno.question}» → ${club.yesno.card}`}>
          Да/нет · {club.yesno.answer ?? "без ответа"}
        </span>
      ) : (
        remind("yesno", "Да/нет — нет")
      )}
      {!club.telegram && !club.email && <span className="club-chip club-chip--muted">без Telegram и почты — результаты у клиента закрыты</span>}
    </div>
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
