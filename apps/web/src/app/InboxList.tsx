"use client";

/**
 * Список чатов для сотрудников — слева в мессенджере (StaffMessenger), обновляется раз в 5 секунд.
 * Поиск по имени клиента или эксперта; папки «Мои» (у эксперта) / «Все» / «Без ответа» / «Непрочитанные».
 * «Без ответа» — клиент написал, а живого ответа после этого ещё не было; там же видно, сколько он ждёт
 * (старые ожидания сверху). У клиента — значок Telegram и город; у нашего последнего сообщения — птички.
 * currentId — открытый сейчас чат, подсвечен. Выбранная папка запоминается в этом браузере.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import type { InboxItem } from "@/lib/chat";
import { cityName } from "@/lib/geo-label";
import { Avatar } from "./Avatar";
import { ReadTicks, TelegramIcon } from "./StaffBits";

const POLL_MS = 5000;
const TAB_KEY = "inbox:tab";

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

type Tab = "all" | "mine" | "waiting" | "unread";

export function InboxList({
  url,
  linkBase,
  meId,
  currentId,
}: {
  url: string;
  linkBase: string;
  /** Эксперт: его id — вкладка «Мои» и число непрочитанных в заголовке вкладки браузера. */
  meId?: number;
  currentId?: string;
}) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>(meId === undefined ? "all" : "mine");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as Tab | null;
      if (saved && (saved !== "mine" || meId !== undefined)) setTab(saved);
    } catch {
      // Без хранилища — папка по умолчанию
    }
  }, [meId]);

  function pick(t: Tab) {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // не запомним — не страшно
    }
  }

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok && alive) {
          setItems(((await res.json()) as { items: InboxItem[] }).items);
          setNow(Date.now());
        }
      } catch {
        // Нет связи — попробуем при следующем опросе
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [url]);

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
  // Без ответа — дольше всех ждущие сверху
  if (tab === "waiting") shown = [...shown].sort((a, b) => Date.parse(a.waitingSince!) - Date.parse(b.waitingSince!));

  const count = (t: Tab) => all.filter((c) => inTab(c, t)).length;
  const tabs: { key: Tab; label: string; n?: number; alert?: boolean }[] = [
    ...(meId === undefined ? [] : [{ key: "mine" as const, label: "Мои" }]),
    { key: "all", label: "Все" },
    { key: "waiting", label: "Без ответа", n: count("waiting"), alert: true },
    { key: "unread", label: "Непрочитанные", n: count("unread") },
  ];

  return (
    <nav className="inbox" aria-label="Чаты">
      <div className="inbox__tools">
        <input
          className="inbox__search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по имени"
          aria-label="Поиск по имени клиента или эксперта"
        />
        <div className="inbox__tabs" role="tablist" aria-label="Папки">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={tab === t.key ? "is-current" : undefined}
              onClick={() => pick(t.key)}
            >
              {t.label}
              {t.n !== undefined && t.n > 0 && <span className={t.alert ? "inbox__count inbox__count--alert" : "inbox__count"}>{t.n}</span>}
            </button>
          ))}
        </div>
      </div>
      {!items ? (
        <p className="muted inbox__empty">Загрузка…</p>
      ) : shown.length === 0 ? (
        <p className="muted inbox__empty">{q ? "Никого не нашли" : tab === "waiting" ? "Всем ответили — так держать" : "Пока пусто"}</p>
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
                  {(meId === undefined || c.expertId !== meId) && <span className="inbox__expert">→ {c.expertName}</span>}
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
                  {c.waitingSince && (
                    <span className={Date.parse(c.waitingSince) < now - 30 * 60_000 ? "inbox__wait inbox__wait--long" : "inbox__wait"}>
                      ждёт ответа {waitedLabel(c.waitingSince, now)}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
