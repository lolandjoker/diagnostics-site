"use client";

/**
 * Чаты для админа и экспертов как в мессенджере: слева список всех чатов, справа открытый чат.
 * Стоит в layout раздела чатов — при переходе из чата в чат список не перерисовывается (поиск
 * и вкладка сохраняются), меняется только правая часть. Открытый чат — по адресу страницы.
 * На телефоне — что-то одно: на странице «Чаты» список, в чате — чат со ссылкой «← Все чаты».
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { InboxList } from "./InboxList";

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
  /** Страница со списком — для «← Все чаты» на телефоне. */
  listHref: string;
  meId?: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const prefix = `${linkBase}/`;
  const currentId = pathname.startsWith(prefix) ? pathname.slice(prefix.length).split("/")[0] : undefined;
  return (
    <div className={currentId ? "staff-messenger staff-messenger--open" : "staff-messenger"}>
      <aside className="staff-messenger__list">
        <InboxList url={inboxUrl} linkBase={linkBase} {...(meId !== undefined && { meId })} {...(currentId && { currentId })} />
      </aside>
      <section className="staff-messenger__chat">
        {currentId && (
          <Link className="staff-messenger__back" href={listHref}>
            ← Все чаты
          </Link>
        )}
        {children}
      </section>
    </div>
  );
}

/** Правая часть, пока чат не выбран. */
export function StaffChatEmpty({ children }: { children?: ReactNode }) {
  return <div className="staff-messenger__placeholder muted">{children ?? <p>Выберите чат слева</p>}</div>;
}

/** Шапка открытого чата: клиент, дата рождения, эксперт и пояснение. */
export function StaffChatHead({ name, meta, note }: { name: string; meta: ReactNode; note?: ReactNode }) {
  return (
    <header className="staff-chat__head">
      <h1>{name}</h1>
      <p className="muted">{meta}</p>
      {note}
    </header>
  );
}
