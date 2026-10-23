"use client";

/**
 * Переписка: опрашивает сервер раз в 3 секунды и дописывает новые сообщения.
 * Один компонент для человека, эксперта и админа — отличаются адрес и что показывать «своим».
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { MessageView } from "@/lib/chat";

const POLL_MS = 3000;

export interface ChatLabels {
  placeholder: string;
  send: string;
  buy: string;
}

export function ChatThread({
  url,
  ownAuthors,
  ownExpertId,
  labels,
  products,
}: {
  /** GET ?after= и POST — один адрес. */
  url: string;
  /** Чьи сообщения показывать справа («свои»). */
  ownAuthors: MessageView["author"][];
  /** Для эксперта: справа — только его собственные сообщения, а не всех экспертов. */
  ownExpertId?: number;
  labels: ChatLabels;
  /** Для эксперта и админа: продукты, которые можно предложить. */
  products?: { id: number; title: string }[];
}) {
  const [items, setItems] = useState<MessageView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const lastId = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${url}?after=${lastId.current}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { messages: MessageView[] };
      if (data.messages.length > 0) {
        lastId.current = data.messages.at(-1)?.id ?? lastId.current;
        setItems((prev) => {
          const known = new Set(prev.map((m) => m.id));
          return [...prev, ...data.messages.filter((m) => !known.has(m.id))];
        });
      }
    } catch {
      // Нет связи — попробуем при следующем опросе
    }
  }, [url]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items.length]);

  async function send(payload: { body?: string; productId?: number }) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Не удалось отправить");
        return false;
      }
      await poll();
      return true;
    } catch {
      setError("Нет связи с сервером");
      return false;
    } finally {
      setSending(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (text.trim() === "") return;
    if (await send({ body: text })) setText("");
  }

  return (
    <div className="chat">
      <div className="chat__messages" aria-live="polite">
        {items.map((m) => (
          <div
            key={m.id}
            className={`msg msg--${m.author} ${
              ownAuthors.includes(m.author) || (ownExpertId !== undefined && m.expertId === ownExpertId) ? "msg--own" : ""
            }`}
          >
            <div className="msg__author">
              {m.authorName}
              <time dateTime={m.createdAt}>
                {new Date(m.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
              </time>
            </div>
            {m.body && <div className="text">{m.body}</div>}
            {m.offer !== undefined &&
              (m.offer ? (
                <div className="msg__offer">
                  <b>{m.offer.title}</b>
                  {m.offer.description && <p className="text">{m.offer.description}</p>}
                  <div className="offer__buy">
                    <span className="price">{m.offer.price}</span>
                    <Link className="button" href={m.offer.url}>
                      {labels.buy}
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="muted">Предложение больше не действует</div>
              ))}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form className="chat__form" onSubmit={onSubmit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={labels.placeholder}
          maxLength={4000}
          rows={2}
        />
        <button className="button" disabled={sending || text.trim() === ""}>
          {labels.send}
        </button>
      </form>
      {products && products.length > 0 && (
        <div className="chat__offer">
          <span className="muted">Предложить продукт:</span>
          {products.map((p) => (
            <button key={p.id} className="link-button" disabled={sending} onClick={() => void send({ productId: p.id })}>
              {p.title}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
