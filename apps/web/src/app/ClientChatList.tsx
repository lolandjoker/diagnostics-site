"use client";

/**
 * Переписки клиента — список слева в чате (на телефоне — отдельной страницей): с кем переписывался,
 * последнее сообщение, непрочитанные. Обновляется раз в 5 секунд — новый чат после перевода к другому
 * эксперту появляется сам.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ClientChatItem } from "@/lib/chat";
import { Avatar } from "./Avatar";

const POLL_MS = 5000;

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("ru-RU", today ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" });
}

export function ClientChatList({
  leadId,
  currentId,
  initial,
}: {
  leadId: string;
  /** Открытый сейчас чат — подсвечен; null — список на отдельной странице. */
  currentId: string | null;
  initial: ClientChatItem[];
}) {
  const [items, setItems] = useState(initial);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/chat/${leadId}/list`, { cache: "no-store" });
        if (res.ok && alive) setItems(((await res.json()) as { items: ClientChatItem[] }).items);
      } catch {
        // Нет связи — попробуем при следующем опросе
      }
    };
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [leadId]);

  return (
    <nav className="chats" aria-label="Переписки">
      <div className="chats__title">Переписки</div>
      <ul className="chats__list">
        {items.map((c) => {
          const current = c.id === currentId;
          return (
            <li key={c.id}>
              <Link
                href={`/razbor/${leadId}/chat?c=${c.id}`}
                className={current ? "chats__item is-current" : "chats__item"}
                aria-current={current ? "page" : undefined}
              >
                <Avatar name={c.expertName} photo={c.expertPhoto} size={46} />
                <span className="chats__body">
                  <span className="chats__top">
                    <b title={c.expertName}>{c.expertName}</b>
                    <time dateTime={c.lastMessageAt}>{when(c.lastMessageAt)}</time>
                  </span>
                  <span className="chats__last">
                    <span className="chats__preview">{c.lastMessage || "Задайте первый вопрос"}</span>
                    {!current && c.unread > 0 && <span className="chats__unread">{c.unread}</span>}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link className="chats__more" href={`/razbor/${leadId}/eksperty`}>
        <span>
          Познакомиться с другим экспертом
          <small>Отзывы, рейтинг — написать можно любому</small>
        </span>
        <span aria-hidden="true">→</span>
      </Link>
    </nav>
  );
}
