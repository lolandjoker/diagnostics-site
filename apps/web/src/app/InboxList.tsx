"use client";

/**
 * Список чатов для сотрудников — слева в мессенджере (StaffMessenger).
 * - Эксперты — как аккаунты в Telegram: слева колонка с фото (на телефоне — строка сверху), точка «в сети»,
 *   непрочитанные. Выбрали эксперта — «вошли в его аккаунт»: только его чаты (фильтрует сервер — видны и старые),
 *   ответы клиент видит от его имени. «Все» — все чаты разом. Выбор запоминается.
 * - Папки: «Мои» (у эксперта) / «Все» / «Без ответа» / «Непрочитанные». «Без ответа» — клиент написал, а живого
 *   ответа ещё не было; там видно, сколько он ждёт (старые ожидания сверху).
 * - Поиск: по имени — сразу в списке; от 2 символов — ещё и по тексту сообщений, как в Telegram
 *   (нажали — открывается чат на этом сообщении).
 * - У клиента: значок Telegram, город, «↪ ранее: …» — пришёл из чата с другим экспертом, «разбор» — где получил
 *   подробный разбор, «ещё N» — сколько у него других чатов; у нашего последнего сообщения — птички.
 * Опрос раз в 5 секунд, в фоновой вкладке — раз в 30 (меньше нагрузки на сервер).
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { InboxItem } from "@/lib/chat";
import { cityName } from "@/lib/geo-label";
import type { InboxExpert, SearchHit } from "@/lib/staff-inbox";
import { Avatar } from "./Avatar";
import { ReadTicks, TelegramIcon } from "./StaffBits";

const POLL_MS = 5000;
const POLL_HIDDEN_MS = 30_000;
const SEARCH_DELAY_MS = 300;
const TAB_KEY = "inbox:tab";
const EXPERT_KEY = "inbox:expert";

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("ru-RU", today ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" });
}

/** «5 мин», «2 ч», «3 дн». */
export function waitedLabel(sinceIso: string, now: number): string {
  const min = Math.max(1, Math.floor((now - Date.parse(sinceIso)) / 60_000));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  return `${Math.floor(h / 24)} дн`;
}

/** Имя эксперта без специализации: «Ксения Никитина | Нумеролог» → «Ксения Никитина». */
const shortName = (name: string) => name.split("|")[0]!.trim();

/** Текст с выделенным совпадением. */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

type Tab = "all" | "mine" | "waiting" | "unread";

const withExpert = (url: string, expert: number | null) => (expert ? `${url}${url.includes("?") ? "&" : "?"}expert=${expert}` : url);

export function InboxList({
  url,
  searchUrl,
  linkBase,
  meId,
  currentId,
}: {
  url: string;
  /** Поиск по тексту сообщений (?q=). */
  searchUrl: string;
  linkBase: string;
  /** Эксперт: его id — вкладка «Мои» и число непрочитанных в заголовке вкладки браузера. */
  meId?: number;
  currentId?: string;
}) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [experts, setExperts] = useState<InboxExpert[]>([]);
  const [expert, setExpert] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [tab, setTab] = useState<Tab>(meId === undefined ? "all" : "mine");
  const [now, setNow] = useState(() => Date.now());
  const loadedFor = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as Tab | null;
      if (saved && (saved !== "mine" || meId !== undefined)) setTab(saved);
      const e = Number(localStorage.getItem(EXPERT_KEY));
      if (Number.isInteger(e) && e > 0) setExpert(e);
    } catch {
      // Без хранилища — по умолчанию
    }
  }, [meId]);

  const remember = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // не запомним — не страшно
    }
  };

  // Опрос: 5 с на виду, 30 с в фоне; при смене эксперта — сразу
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await fetch(withExpert(url, expert), { cache: "no-store" });
        if (res.ok && alive) {
          const data = (await res.json()) as { items: InboxItem[]; experts?: InboxExpert[] };
          setItems(data.items);
          if (data.experts) setExperts(data.experts);
          setNow(Date.now());
          loadedFor.current = expert;
        }
      } catch {
        // Нет связи — попробуем при следующем опросе
      }
      if (alive) timer = setTimeout(() => void load(), document.hidden ? POLL_HIDDEN_MS : POLL_MS);
    };
    const onVisible = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      void load();
    };
    if (loadedFor.current !== expert) setItems(null);
    void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, expert]);

  // Поиск по сообщениям — после паузы в наборе, прошлый запрос отменяется
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(withExpert(`${searchUrl}?q=${encodeURIComponent(q)}`, expert), { cache: "no-store", signal: ctrl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ hits: SearchHit[] }>) : null))
        .then((d) => d && setHits(d.hits))
        .catch(() => {});
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, searchUrl, expert]);

  useEffect(() => {
    if (!items || meId === undefined) return;
    const unread = items.filter((c) => c.expertId === meId).reduce((s, c) => s + c.unread, 0);
    document.title = unread > 0 ? `(${unread}) Панель эксперта` : "Панель эксперта";
  }, [items, meId]);

  const all = items ?? [];
  const q = query.trim().toLowerCase();
  const inTab = (c: InboxItem, t: Tab) =>
    t === "mine" ? c.expertId === meId : t === "waiting" ? c.waitingSince !== null : t === "unread" ? c.unread > 0 || c.callRequested : true;
  let shown = all.filter((c) => inTab(c, tab) && (q === "" || c.leadName.toLowerCase().includes(q) || c.expertName.toLowerCase().includes(q)));
  if (tab === "waiting") shown = [...shown].sort((a, b) => Date.parse(a.waitingSince!) - Date.parse(b.waitingSince!));

  const count = (t: Tab) => all.filter((c) => inTab(c, t)).length;
  const tabs: { key: Tab; label: string; n?: number; alert?: boolean }[] = [
    ...(meId === undefined ? [] : [{ key: "mine" as const, label: "Мои" }]),
    { key: "all", label: "Все" },
    { key: "waiting", label: "Без ответа", n: count("waiting"), alert: true },
    { key: "unread", label: "Непрочитанные", n: count("unread") },
  ];
  const totalUnread = experts.reduce((s, e) => s + e.unread, 0);
  const pickExpert = (v: number | null) => {
    setExpert(v);
    remember(EXPERT_KEY, v ? String(v) : "");
  };
  const account = expert !== null ? experts.find((e) => e.id === expert) : undefined;

  return (
    <nav className={experts.length > 1 ? "inbox inbox--rail" : "inbox"} aria-label="Чаты">
      {experts.length > 1 && (
        <div className="xrail" role="tablist" aria-label="Эксперты">
          <button
            type="button"
            role="tab"
            aria-selected={expert === null}
            className={expert === null ? "xrail__item is-current" : "xrail__item"}
            onClick={() => pickExpert(null)}
            title="Все чаты"
          >
            <span className="xrail__all" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <rect x="4" y="4" width="7" height="7" rx="2" />
                <rect x="13" y="4" width="7" height="7" rx="2" />
                <rect x="4" y="13" width="7" height="7" rx="2" />
                <rect x="13" y="13" width="7" height="7" rx="2" />
              </svg>
            </span>
            {totalUnread > 0 && <span className="xrail__badge">{totalUnread > 99 ? "99+" : totalUnread}</span>}
            <span className="xrail__name">Все</span>
          </button>
          {experts.map((e) => (
            <button
              key={e.id}
              type="button"
              role="tab"
              aria-selected={expert === e.id}
              className={expert === e.id ? "xrail__item is-current" : "xrail__item"}
              onClick={() => pickExpert(e.id)}
              title={`${e.name} · ${e.chats} чатов`}
            >
              <Avatar name={e.name} photo={e.photo} size={40} online={e.status !== "offline"} busy={e.status === "busy"} />
              {e.unread > 0 && <span className="xrail__badge">{e.unread > 99 ? "99+" : e.unread}</span>}
              <span className="xrail__name">{shortName(e.name).split(" ")[0]}</span>
            </button>
          ))}
        </div>
      )}
      <div className="inbox__main">
      <div className="inbox__tools">
        {account && (
          <div className="inbox__account">
            <Avatar name={account.name} photo={account.photo} size={34} online={account.status !== "offline"} busy={account.status === "busy"} />
            <span className="inbox__account-text">
              <b>{shortName(account.name)}</b>
              <small>Вы в аккаунте эксперта — клиенты видят ответы от его имени</small>
            </span>
            <button type="button" className="inbox__account-exit" onClick={() => pickExpert(null)} aria-label="Ко всем чатам" title="Ко всем чатам">
              ×
            </button>
          </div>
        )}
        <input
          className="inbox__search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск: имя или текст сообщения"
          aria-label="Поиск по имени и тексту сообщений"
        />
        <div className="inbox__tabs" role="tablist" aria-label="Папки">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={tab === t.key ? "is-current" : undefined}
              onClick={() => {
                setTab(t.key);
                remember(TAB_KEY, t.key);
              }}
            >
              {t.label}
              {t.n !== undefined && t.n > 0 && <span className={t.alert ? "inbox__count inbox__count--alert" : "inbox__count"}>{t.n}</span>}
            </button>
          ))}
        </div>
      </div>
      {!items ? (
        <p className="muted inbox__empty">Загрузка…</p>
      ) : (
        <div className="inbox__scroll">
          {q !== "" && hits !== null && shown.length > 0 && <p className="inbox__section">Чаты</p>}
          {shown.length === 0 && hits !== null && hits.length > 0 ? null : shown.length === 0 ? (
            <p className="muted inbox__empty">{q ? "По имени никого" : tab === "waiting" ? "Всем ответили — так держать" : "Пока пусто"}</p>
          ) : (
            <ul className="inbox__list">
              {shown.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`${linkBase}/${c.id}`}
                    className={["inbox__item", c.unread > 0 && "inbox__item--unread", c.id === currentId && "is-current"].filter(Boolean).join(" ")}
                    aria-current={c.id === currentId ? "page" : undefined}
                  >
                    <span className="inbox__ava">
                      <Avatar name={c.leadName} size={42} tone="plain" />
                      {c.telegram && (
                        <span className="inbox__tg" title="Подключил Telegram">
                          <TelegramIcon size={16} />
                        </span>
                      )}
                    </span>
                    <span className="inbox__body">
                      <span className="inbox__top">
                        <span className="inbox__who">
                          {c.leadName}
                          {c.geoCity && <span className="inbox__city"> · {cityName(c.geoCity)}</span>}
                          {c.blocked && <span className="block-badge">блок</span>}
                        </span>
                        <time dateTime={c.lastMessageAt}>{when(c.lastMessageAt)}</time>
                      </span>
                      {(meId === undefined || c.expertId !== meId) && (
                        <span className="inbox__expert">
                          → {shortName(c.expertName)}
                          {c.movedFrom && <span className="inbox__moved" title="Клиент пришёл сюда из чата с другим экспертом"> ↪ ранее: {shortName(c.movedFrom)}</span>}
                        </span>
                      )}
                      <span className="inbox__bottom">
                        <span className="inbox__last">
                          {c.lastOwnRead !== null && <ReadTicks read={c.lastOwnRead} />}
                          {c.lastMessage || "—"}
                        </span>
                        <span className="inbox__badges">
                          {c.callRequested && (
                            <span className="badge badge--call" title="Клиент просит позвонить">
                              📞
                            </span>
                          )}
                          {c.unread > 0 && <span className="badge">{c.unread}</span>}
                        </span>
                      </span>
                      {(c.waitingSince || c.diagnosis || c.otherChats.length > 0) && (
                        <span className="inbox__marks">
                          {c.waitingSince && (
                            <span className={Date.parse(c.waitingSince) < now - 30 * 60_000 ? "inbox__wait inbox__wait--long" : "inbox__wait"}>
                              ждёт ответа {waitedLabel(c.waitingSince, now)}
                            </span>
                          )}
                          {c.diagnosis && c.otherChats.length > 0 && (
                            <span className="inbox__mark" title="Подробный разбор клиент получил в этом чате">
                              разбор здесь
                            </span>
                          )}
                          {c.otherChats.length > 0 && (
                            <span className="inbox__mark" title={c.otherChats.map((o) => shortName(o.expertName) + (o.diagnosis ? " (разбор)" : "")).join(", ")}>
                              ещё {c.otherChats.length} {c.otherChats.length === 1 ? "чат" : c.otherChats.length < 5 ? "чата" : "чатов"}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {hits !== null && (
            <>
              <p className="inbox__section">Сообщения{hits.length > 0 ? ` · ${hits.length}${hits.length >= 50 ? "+" : ""}` : ""}</p>
              {hits.length === 0 ? (
                <p className="muted inbox__empty">В сообщениях не нашли</p>
              ) : (
                <ul className="inbox__list">
                  {hits.map((h) => (
                    <li key={h.messageId}>
                      <Link className={h.conversationId === currentId ? "inbox__hit is-current" : "inbox__hit"} href={`${linkBase}/${h.conversationId}?m=${h.messageId}`}>
                        <span className="inbox__top">
                          <span className="inbox__who">
                            {h.leadName} <span className="inbox__city">→ {shortName(h.expertName)}</span>
                          </span>
                          <time dateTime={h.createdAt}>{when(h.createdAt)}</time>
                        </span>
                        <span className="inbox__snippet">
                          {h.author === "client" ? "" : "Мы: "}
                          <Highlight text={h.snippet} q={query.trim()} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
      </div>
    </nav>
  );
}
