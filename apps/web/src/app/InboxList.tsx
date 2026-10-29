"use client";

/**
 * Список чатов для админа и экспертов — слева в мессенджере (StaffMessenger), обновляется раз в 5 секунд.
 * Поиск по имени клиента или эксперта; вкладки «Все» / «Мои» (у эксперта) / «Непрочитанные».
 * currentId — открытый сейчас чат, подсвечен.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import type { InboxItem } from "@/lib/chat";

const POLL_MS = 5000;

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("ru-RU", today ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" });
}

type Tab = "all" | "mine" | "unread";

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

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok && alive) setItems(((await res.json()) as { items: InboxItem[] }).items);
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

  const q = query.trim().toLowerCase();
  const shown = (items ?? []).filter(
    (c) =>
      (tab !== "mine" || c.expertId === meId) &&
      (tab !== "unread" || c.unread > 0 || c.callRequested) &&
      (q === "" || c.leadName.toLowerCase().includes(q) || c.expertName.toLowerCase().includes(q)),
  );
  const unreadTotal = (items ?? []).filter((c) => c.unread > 0 || c.callRequested).length;
  const tabs: { key: Tab; label: string }[] = [
    ...(meId === undefined ? [] : [{ key: "mine" as const, label: "Мои" }]),
    { key: "all", label: "Все" },
    { key: "unread", label: unreadTotal > 0 ? `Непрочитанные · ${unreadTotal}` : "Непрочитанные" },
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
        <div className="inbox__tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={tab === t.key ? "is-current" : undefined}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {!items ? (
        <p className="muted inbox__empty">Загрузка…</p>
      ) : shown.length === 0 ? (
        <p className="muted inbox__empty">{q ? "Никого не нашли" : "Пока пусто"}</p>
      ) : (
        <ul className="inbox__list">
          {shown.map((c) => (
            <li key={c.id}>
              <Link
                href={`${linkBase}/${c.id}`}
                className={[
                  "inbox__item",
                  c.unread > 0 && "inbox__item--unread",
                  c.id === currentId && "is-current",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={c.id === currentId ? "page" : undefined}
              >
                <span className="inbox__who">
                  {c.leadName}
                  {(meId === undefined || c.expertId !== meId) && <span className="muted"> → {c.expertName}</span>}
                </span>
                <time className="muted" dateTime={c.lastMessageAt}>
                  {when(c.lastMessageAt)}
                </time>
                <span className="inbox__last">{c.lastMessage || "—"}</span>
                <span className="inbox__badges">
                  {c.callRequested && (
                    <span className="badge badge--call" title="Клиент просит позвонить">
                      📞
                    </span>
                  )}
                  {c.unread > 0 && <span className="badge">{c.unread}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
