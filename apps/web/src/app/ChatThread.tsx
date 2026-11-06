"use client";

/**
 * Переписка: опрашивает сервер раз в 3 секунды и дописывает новые сообщения.
 * Один компонент для человека, эксперта и админа — отличаются адрес и что показывать «своим».
 * Фото перед отправкой уменьшается в браузере (до PHOTO_MAX_SIDE по большей стороне).
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { MessageView } from "@/lib/chat";
import { Avatar } from "./Avatar";
import { ReadTicks, TelegramIcon } from "./StaffBits";
import { pageAway, telegramInitData } from "./telegramWebApp";

const POLL_MS = 3000;
/** Как часто сообщать «я печатаю», пока человек набирает текст (на той стороне «печатает» держится 5 с). */
const TYPING_PING_MS = 2500;

/** Добавить параметр к адресу, в котором уже может быть «?c=…». */
const withParam = (url: string, key: string, value: string) =>
  `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
const PHOTO_MAX_SIDE = 1600;
/** Уже небольшое фото нужного формата отправляем как есть. */
const PHOTO_KEEP_BYTES = 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Окно «Подключите Telegram» после первого сообщения клиента; key — один раз на заявку. */
export interface TelegramInvite {
  key: string;
  href: string;
  title: string;
  text: string;
  button: string;
  later: string;
}

/**
 * Эксперт не в сети, а клиент ждёт ответа (последнее сообщение — его): честно говорим, что ответ будет позже,
 * и как его не пропустить. text — без Telegram (с кнопкой подключить), connectedText — Telegram подключён.
 */
export interface OfflineNotice {
  text: string;
  connectedText: string;
  telegramHref?: string | undefined;
  button: string;
}

export interface ChatLabels {
  placeholder: string;
  send: string;
}

/** Собеседник в шапке чата (для человека — эксперт). */
export interface ChatPeer {
  name: string;
  /** Подпись статуса «занят» (из «Текстов сайта»). */
  busyLabel: string;
  /** Рейтинг эксперта, «4,8». */
  rating?: string;
  photo?: string | null;
  /** Профиль эксперта — по имени в шапке (на узком экране мини-профиля справа нет). */
  profileHref?: string;
  backHref: string;
  backLabel: string;
}

/** Уменьшает фото с телефона; если браузер не смог его прочитать — отдаёт как есть (сервер проверит). */
async function preparePhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= PHOTO_KEEP_BYTES && PHOTO_TYPES.includes(file.type)) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // Прозрачный PNG в JPEG — на белом фоне, а не на чёрном
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === yesterday.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== today.getFullYear() && { year: "numeric" }),
  });
}

/** Сообщения подряд от одного автора в один день — одна группа: имя и аватарка только у первого. */
const sameSender = (a: MessageView, b: MessageView) =>
  a.author === b.author && a.expertId === b.expertId && dayLabel(a.createdAt) === dayLabel(b.createdAt);

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path
        d="M20.5 11.5l-8.1 8.1a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M3.4 20.4l17.4-7.5a1 1 0 000-1.8L3.4 3.6a.9.9 0 00-1.3 1l1.8 6.1a1 1 0 00.8.7l7.3 1.1-7.3 1.1a1 1 0 00-.8.7l-1.8 6.1a.9.9 0 001.3 1z" />
    </svg>
  );
}

export function ChatThread({
  url,
  ownAuthors,
  ownExpertId,
  ownOperatorId,
  labels,
  peer,
  call,
  notice,
  telegramInvite,
  offlineNotice,
  draft,
  prompt,
  suggestions = [],
  typingUrl,
  typingName,
  receipts = "own",
  manageUrl,
}: {
  /** GET ?after= и POST — один адрес. */
  url: string;
  /** Чьи сообщения показывать справа («свои»). */
  ownAuthors: MessageView["author"][];
  /** Для эксперта: справа — только его собственные сообщения, а не всех экспертов. */
  ownExpertId?: number;
  /**
   * Оператор чатов: свои — его сообщения (author = admin с его operatorId). У админа (ownAuthors = admin)
   * без этого свои — только сообщения самого админа, без операторских.
   */
  ownOperatorId?: number;
  labels: ChatLabels;
  /** Шапка чата с собеседником; статус берётся из ответа сервера (expertStatus). */
  peer?: ChatPeer;
  /** Звонок (CallPanel): с шапкой — справа в ней, без шапки — полосой над перепиской. */
  call?: ReactNode;
  /** Полоса под шапкой («Получать ответы в Telegram»); пропадает, когда Telegram подключили. */
  notice?: ReactNode;
  /** Клиенту: после первого сообщения — окно с приглашением в Telegram-бот (если ещё не подключён). */
  telegramInvite?: TelegramInvite | undefined;
  /** Текст в поле ввода при открытии (например, вопрос о карте дня из «Моего дня»). */
  draft?: string | undefined;
  /** Клиенту: эксперт не в сети, а он ждёт ответа — плашка под перепиской. */
  offlineNotice?: OfflineNotice | undefined;
  /** Карточка над подсказками и полем ввода (например, «Откуда вы о нас узнали?»). */
  prompt?: ReactNode;
  /** Подсказки-вопросы: видны, пока человек ничего не написал в этом чате; нажал — вопрос отправлен. */
  suggestions?: string[];
  /** Куда сообщать «я печатаю» (POST); без него — не сообщаем. */
  typingUrl?: string;
  /** Кто печатает на той стороне — подпись «… печатает» (клиенту — эксперт, сотрудникам — клиент). */
  typingName?: string;
  /**
   * У каких сообщений птички прочтения: own — у своих; staff — у всех не от клиента (эксперт, админ, операторы,
   * автоматические): прочитано, если клиент открывал чат после сообщения или ответил после него (в том числе из Telegram).
   */
  receipts?: "own" | "staff";
  /**
   * Админ и операторы: можно исправить и удалить сообщение — `${manageUrl}/<id>` (PATCH { body } / DELETE).
   * Исправить — только наши сообщения (эксперт, админ/оператор), удалить — любое.
   */
  manageUrl?: string;
}) {
  const [items, setItems] = useState<MessageView[]>([]);
  const [typing, setTyping] = useState(false);
  const lastTypingPing = useRef(0);
  const [status, setStatus] = useState<"online" | "busy" | "offline" | undefined>(undefined);
  /** До какого момента та сторона прочитала чат: свои сообщения раньше — ✓✓, позже — ✓. */
  const [readUpTo, setReadUpTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState(draft ?? "");
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const lastId = useRef(0);
  /** Время сервера с прошлого опроса — сервер пришлёт сообщения, исправленные после него. */
  const since = useRef<string | null>(null);
  /** Меню у сообщения (админ/оператор): какое открыто, правка, подтверждение удаления. */
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [managing, setManaging] = useState(false);
  /** Клиента заблокировали — писать нельзя. */
  const [blocked, setBlocked] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  /** Человек внизу переписки — догрузившееся фото не должно утащить последние сообщения из вида. */
  const atBottom = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const poll = useCallback(async () => {
    try {
      // Человек не смотрит на чат — сообщения не считаются прочитанными (и клиенту из Telegram придёт уведомление)
      const after = withParam(url, "after", String(lastId.current));
      const next = since.current ? withParam(after, "since", since.current) : after;
      const res = await fetch(pageAway() ? withParam(next, "hidden", "1") : next, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages: MessageView[];
        expertStatus?: "online" | "busy" | "offline";
        typing?: boolean;
        readUpTo?: string | null;
        telegramConnected?: boolean;
        ids?: number[];
        edited?: MessageView[];
        now?: string;
        blocked?: boolean;
      };
      setBlocked(data.blocked === true);
      if (data.now) since.current = data.now;
      if (data.telegramConnected) {
        setTelegramConnected(true);
        setInviteOpen(false);
      }
      if (data.expertStatus) setStatus(data.expertStatus);
      if (data.readUpTo !== undefined) setReadUpTo(data.readUpTo);
      setTyping(data.typing === true);
      if (data.messages.length > 0) lastId.current = data.messages.at(-1)?.id ?? lastId.current;
      const alive = data.ids ? new Set(data.ids) : null;
      const edited = new Map((data.edited ?? []).map((m) => [m.id, m]));
      if (data.messages.length > 0 || edited.size > 0 || alive) {
        setItems((prev) => {
          const known = new Set(prev.map((m) => m.id));
          let next = [...prev, ...data.messages.filter((m) => !known.has(m.id))];
          // Удалённые пропадают, исправленные — с новым текстом
          if (alive && next.some((m) => !alive.has(m.id))) next = next.filter((m) => alive.has(m.id));
          if (edited.size > 0) next = next.map((m) => edited.get(m.id) ?? m);
          return next.length === prev.length && next.every((m, i) => m === prev[i]) ? prev : next;
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
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, typing]);

  function keepAtBottom() {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }

  /** Человек набирает текст — раз в TYPING_PING_MS сообщаем той стороне «печатает…». */
  function pingTyping(value: string) {
    if (!typingUrl || value.trim() === "") return;
    const now = Date.now();
    if (now - lastTypingPing.current < TYPING_PING_MS) return;
    lastTypingPing.current = now;
    void fetch(typingUrl, { method: "POST" }).catch(() => {});
  }

  // Предпросмотр фото: освобождаем память, когда фото убрали или отправили
  useEffect(() => {
    return () => {
      if (photo) URL.revokeObjectURL(photo.preview);
    };
  }, [photo]);

  useEffect(() => {
    if (!inviteOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setInviteOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inviteOpen]);

  /** Первое сообщение клиента — зовём в Telegram-бот: один раз на заявку, не внутри Telegram и не тем, кто уже подключил. */
  function maybeInvite() {
    if (!telegramInvite || telegramConnected || telegramInitData()) return;
    const key = `tgInvite:${telegramInvite.key}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      // Без хранилища окно может показаться ещё раз — не страшно
    }
    setInviteOpen(true);
  }

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  // Поле ввода растёт вместе с текстом (до предела в CSS)
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  async function send(payload: { body?: string; photo?: File }) {
    const firstOwn = !items.some(isOwn);
    setSending(true);
    setError(null);
    try {
      let init: RequestInit;
      if (payload.photo) {
        const form = new FormData();
        form.set("body", payload.body ?? "");
        form.set("photo", await preparePhoto(payload.photo), "photo.jpg");
        init = { method: "POST", body: form };
      } else {
        init = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: payload.body }),
        };
      }
      const res = await fetch(url, init);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Не удалось отправить");
        return false;
      }
      await poll();
      if (firstOwn) maybeInvite();
      return true;
    } catch {
      setError("Нет связи с сервером");
      return false;
    } finally {
      setSending(false);
    }
  }

  async function manage(id: number, method: "PATCH" | "DELETE", body?: string) {
    if (!manageUrl || managing) return;
    setManaging(true);
    setError(null);
    try {
      const res = await fetch(`${manageUrl}/${id}`, {
        method,
        ...(method === "PATCH" && { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Не получилось");
        return;
      }
      setItems((prev) =>
        method === "DELETE"
          ? prev.filter((m) => m.id !== id)
          : prev.map((m) => (m.id === id ? { ...m, body: (body ?? "").trim(), editedAt: new Date().toISOString() } : m)),
      );
      setEditing(null);
      setConfirmDelete(null);
      setMenuFor(null);
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setManaging(false);
    }
  }

  const canEdit = (m: MessageView) => m.author === "expert" || m.author === "admin";

  /** Кнопка «⋯» и меню у сообщения — только админу и операторам. */
  const messageMenu = (m: MessageView) => {
    if (!manageUrl) return null;
    const open = menuFor === m.id;
    return (
      <div className={open ? "msg-menu is-open" : "msg-menu"}>
        <button
          type="button"
          className="msg-menu__more"
          aria-label="Действия с сообщением"
          aria-expanded={open}
          onClick={() => {
            setMenuFor(open ? null : m.id);
            setConfirmDelete(null);
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
        {open &&
          (confirmDelete === m.id ? (
            <div className="msg-menu__bar" role="group" aria-label="Удалить сообщение">
              <span>Удалить у всех?</span>
              <button type="button" className="msg-menu__danger" disabled={managing} onClick={() => void manage(m.id, "DELETE")}>
                Удалить
              </button>
              <button type="button" onClick={() => setConfirmDelete(null)}>
                Отмена
              </button>
            </div>
          ) : (
            <div className="msg-menu__bar" role="group" aria-label="Действия">
              {canEdit(m) && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing({ id: m.id, text: m.body });
                    setMenuFor(null);
                  }}
                >
                  Изменить
                </button>
              )}
              <button type="button" className="msg-menu__danger" onClick={() => setConfirmDelete(m.id)}>
                Удалить
              </button>
            </div>
          ))}
      </div>
    );
  };

  /** Текст сообщения или поле правки. */
  const messageBody = (m: MessageView) => {
    if (editing?.id !== m.id) return m.body ? <div className="text">{m.body}</div> : null;
    return (
      <form
        className="msg-edit"
        onSubmit={(e) => {
          e.preventDefault();
          void manage(m.id, "PATCH", editing.text);
        }}
      >
        <textarea
          autoFocus
          value={editing.text}
          maxLength={4000}
          rows={Math.min(8, Math.max(2, Math.ceil(editing.text.length / 40)))}
          onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(null);
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="msg-edit__actions">
          <button type="button" onClick={() => setEditing(null)}>
            Отмена
          </button>
          <button type="submit" className="msg-edit__save" disabled={managing}>
            Сохранить
          </button>
        </div>
      </form>
    );
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (text.trim() === "" && !photo) return;
    if (await send({ body: text, ...(photo && { photo: photo.file }) })) {
      setText("");
      setPhoto(null);
    }
  }

  function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Можно отправить только фото");
      return;
    }
    setError(null);
    setPhoto({ file, preview: URL.createObjectURL(file) });
  }

  const lastClientId = receipts === "staff" ? items.reduce((max, m) => (m.author === "client" && m.id > max ? m.id : max), 0) : 0;
  const ticksFor = (m: MessageView) => (receipts === "staff" ? m.author !== "client" : isOwn(m));
  const isRead = (m: MessageView) => (readUpTo !== null && m.createdAt <= readUpTo) || lastClientId > m.id;

  const isOwn = (m: MessageView) =>
    (m.author === "admin"
      ? ownAuthors.includes("admin") && (m.operatorId ?? undefined) === ownOperatorId
      : ownAuthors.includes(m.author)) ||
    (ownExpertId !== undefined && m.expertId === ownExpertId);

  return (
    <div className="chat">
      {peer && (
        <header className="chat__head">
          <Link className="chat__back" href={peer.backHref} aria-label={peer.backLabel} title={peer.backLabel}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <Avatar
            name={peer.name}
            photo={peer.photo}
            size={44}
            {...(status !== undefined && { online: status !== "offline", busy: status === "busy" })}
          />
          <div className="chat__peer">
            {peer.profileHref ? (
              <Link className="chat__peer-name" href={peer.profileHref} title="Открыть профиль эксперта">
                {peer.name}
              </Link>
            ) : (
              <b>{peer.name}</b>
            )}
            <span className="chat__meta">
              {peer.rating && <span className="rating">★ {peer.rating}</span>}
              {typing ? (
                <span className="status status--typing">печатает…</span>
              ) : (
                <span className={`status status--${status ?? "offline"}`}>
                  {status === undefined ? " " : status === "online" ? "в сети" : status === "busy" ? peer.busyLabel : "не в сети"}
                </span>
              )}
            </span>
          </div>
          {call && <div className="chat__head-actions">{call}</div>}
        </header>
      )}
      {!peer && call}
      {!telegramConnected && notice}

      <div
        className="chat__messages"
        ref={scroller}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {items.map((m, i) => {
          const prev = items[i - 1];
          const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
          const first = !prev || newDay || !sameSender(prev, m);
          const own = isOwn(m);
          return (
            <div key={m.id} className="chat__row-wrap">
              {newDay && (
                <div className="chat__day">
                  <span>{dayLabel(m.createdAt)}</span>
                </div>
              )}
              {m.author === "system" ? (
                <article className="msg-system">
                  <div className="msg-system__title">
                    <span aria-hidden="true">✦</span> {m.authorName}
                  </div>
                  {m.body && <div className="text">{m.body}</div>}
                  <time dateTime={m.createdAt}>
                    {time(m.createdAt)}
                    {ticksFor(m) && <ReadTicks read={isRead(m)} />}
                  </time>
                  {messageMenu(m)}
                </article>
              ) : (
                <div className={`chat__row ${own ? "chat__row--own" : ""} ${first ? "chat__row--first" : ""}`}>
                  {!own && (
                    <div className="chat__avatar">
                      {first && (
                        <Avatar
                          name={m.authorName}
                          photo={m.avatar}
                          size={34}
                          tone={m.author === "client" ? "plain" : "gold"}
                        />
                      )}
                    </div>
                  )}
                  <div className={`msg msg--${m.author} ${own ? "msg--own" : ""} ${m.photo && !m.body ? "msg--photo" : ""}`}>
                    {first && !own && <div className="msg__author">{m.authorName}</div>}
                    {m.photo && (
                      <button type="button" className="msg__photo" onClick={() => setZoom(m.photo ?? null)}>
                        <img src={m.photo} alt="Фото" loading="lazy" onLoad={keepAtBottom} />
                      </button>
                    )}
                    {messageBody(m)}
                    <time className="msg__time" dateTime={m.createdAt}>
                      {m.editedAt && <span className="msg__edited">изменено</span>}
                      {m.viaTelegram && (
                        <span className="msg__via" title="Клиент ответил из Telegram">
                          <TelegramIcon size={12} /> из Telegram
                        </span>
                      )}
                      {time(m.createdAt)}
                      {ticksFor(m) && <ReadTicks read={isRead(m)} />}
                    </time>
                    {messageMenu(m)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {typing && (
          <div className="chat__typing" aria-live="polite">
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="chat__typing-text">{typingName ? `${typingName} печатает…` : "печатает…"}</span>
          </div>
        )}
      </div>

      {offlineNotice && status === "offline" && !typing && items.length > 0 && isOwn(items[items.length - 1]!) && (
        <p className="chat__offline" role="status">
          <span>{telegramConnected || !offlineNotice.telegramHref ? offlineNotice.connectedText : offlineNotice.text}</span>
          {!telegramConnected && offlineNotice.telegramHref && (
            <a href={offlineNotice.telegramHref} target="_blank" rel="noopener noreferrer">
              {offlineNotice.button} →
            </a>
          )}
        </p>
      )}

      {error && (
        <p className="form__error chat__error" role="alert">
          {error}
        </p>
      )}

      {blocked && (
        <p className="chat__blocked" role="status">
          Переписка недоступна.
        </p>
      )}
      {!blocked && prompt}
      {!blocked && suggestions.length > 0 && !items.some(isOwn) && (
        <div className="chat__suggestions" aria-label="Можно спросить">
          {suggestions.map((s) => (
            <button key={s} type="button" className="chat__suggestion" disabled={sending} onClick={() => void send({ body: s })}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form className="chat__form" onSubmit={onSubmit} hidden={blocked}>
        {photo && (
          <div className="chat__attach">
            <img src={photo.preview} alt="Фото к отправке" />
            <button type="button" className="chat__attach-remove" onClick={() => setPhoto(null)} aria-label="Убрать фото">
              ×
            </button>
          </div>
        )}
        <div className="chat__composer">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              pickPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="chat__icon-button"
            onClick={() => fileInput.current?.click()}
            disabled={sending}
            aria-label="Прикрепить фото"
            title="Прикрепить фото"
          >
            <PaperclipIcon />
          </button>
          <textarea
            ref={textarea}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              pingTyping(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            onPaste={(e) => {
              const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
              if (file) {
                e.preventDefault();
                pickPhoto(file);
              }
            }}
            placeholder={labels.placeholder}
            maxLength={4000}
            rows={1}
          />
          <button
            className="chat__send"
            disabled={sending || (text.trim() === "" && !photo)}
            aria-label={labels.send}
            title={labels.send}
          >
            {sending ? <span className="spinner" aria-hidden="true" /> : <SendIcon />}
          </button>
        </div>
      </form>

      {inviteOpen && telegramInvite && (
        <div className="tg-invite" role="dialog" aria-modal="true" aria-labelledby="tg-invite-title" onClick={() => setInviteOpen(false)}>
          <div className="tg-invite__card" onClick={(e) => e.stopPropagation()}>
            <span className="tg-invite__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                <path d="M21 4.5 2.8 11.4c-.9.4-.9 1.2 0 1.5l4.6 1.5 1.8 5.4c.2.6.9.8 1.4.4l2.6-2.2 4.6 3.4c.6.4 1.3.1 1.5-.6L22 5.6c.2-.8-.4-1.4-1-1.1Z" />
                <path d="m7.4 14.4 9.8-6.6-7 7.4" />
              </svg>
            </span>
            <h2 id="tg-invite-title" className="tg-invite__title">
              {telegramInvite.title}
            </h2>
            <p className="tg-invite__text">{telegramInvite.text}</p>
            <a
              className="tg-invite__go"
              href={telegramInvite.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setInviteOpen(false)}
            >
              {telegramInvite.button}
            </a>
            <button type="button" className="tg-invite__later" onClick={() => setInviteOpen(false)}>
              {telegramInvite.later}
            </button>
          </div>
        </div>
      )}

      {zoom && (
        <div className="lightbox" role="dialog" aria-label="Фото" onClick={() => setZoom(null)}>
          <img src={zoom} alt="Фото" />
          <button type="button" className="lightbox__close" aria-label="Закрыть">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
