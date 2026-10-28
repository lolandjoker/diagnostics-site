"use client";

/** Список чатов, обновляется раз в 5 секунд. Для эксперта делится на «мои» и «коллег». */
import Link from "next/link";
import { useEffect, useState } from "react";
import type { InboxItem } from "@/lib/chat";

const POLL_MS = 5000;

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("ru-RU", today ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Rows({ items, linkBase, showExpert }: { items: InboxItem[]; linkBase: string; showExpert: boolean }) {
  if (items.length === 0) return <p className="muted">Пока пусто.</p>;
  return (
    <ul className="inbox">
      {items.map((c) => (
        <li key={c.id} className={c.unread > 0 ? "inbox__item inbox__item--unread" : "inbox__item"}>
          <Link href={`${linkBase}/${c.id}`}>
            <span className="inbox__who">
              {c.leadName}
              {showExpert && <span className="muted"> → {c.expertName}</span>}
              {c.unread > 0 && <span className="badge">{c.unread}</span>}
              {c.callRequested && (
                <span className="badge badge--call" title="Клиент просит позвонить">
                  📞 звонок
                </span>
              )}
            </span>
            <span className="inbox__last">{c.lastMessage || "—"}</span>
            <time className="muted" dateTime={c.lastMessageAt}>
              {when(c.lastMessageAt)}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function InboxList({ url, linkBase, meId }: { url: string; linkBase: string; meId?: number }) {
  const [items, setItems] = useState<InboxItem[] | null>(null);

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

  if (!items) return <p className="muted">Загрузка…</p>;
  if (meId === undefined) return <Rows items={items} linkBase={linkBase} showExpert />;
  return (
    <>
      <h2>Мои чаты</h2>
      <Rows items={items.filter((c) => c.expertId === meId)} linkBase={linkBase} showExpert={false} />
      <h2>Чаты коллег</h2>
      <p className="muted">Ответить можно в любом — клиент увидит ваше имя.</p>
      <Rows items={items.filter((c) => c.expertId !== meId)} linkBase={linkBase} showExpert />
    </>
  );
}
