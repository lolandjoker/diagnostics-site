/**
 * Меню клиента: Мой день · Чаты · Эксперты · Разбор. На телефоне — нижняя панель (внутри открытого чата её
 * нет, чтобы не мешала полю ввода), на компьютере — строка ссылок над страницей.
 */
import Link from "next/link";

export type ClientTab = "den" | "chaty" | "eksperty" | "razbor";

const ICONS: Record<ClientTab, string> = {
  den: '<path fill="currentColor" stroke="none" d="M11.2 2.6a9.6 9.6 0 1 0 10.2 12.6 8 8 0 0 1-10.2-12.6Z"/>',
  chaty: '<path d="M4 5h16v10H9l-5 4z"/>',
  eksperty: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.3c2.6-.4 4.5 1.2 5 4.2"/>',
  razbor: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
};

export function ClientTabs({ leadId, current, hasChats, unread = 0 }: { leadId: string; current: ClientTab; hasChats: boolean; unread?: number }) {
  const tabs: { key: ClientTab; label: string; href: string }[] = [
    { key: "den", label: "Мой день", href: `/razbor/${leadId}/den` },
    { key: "chaty", label: "Чаты", href: hasChats ? `/razbor/${leadId}/chaty` : `/razbor/${leadId}/eksperty` },
    { key: "eksperty", label: "Эксперты", href: `/razbor/${leadId}/eksperty` },
    { key: "razbor", label: "Разбор", href: `/razbor/${leadId}` },
  ];
  return (
    <nav className="ctabs" aria-label="Меню">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={t.key === current ? "ctabs__item is-current" : "ctabs__item"} aria-current={t.key === current ? "page" : undefined}>
          <span className="ctabs__icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[t.key] }} />
            {t.key === "chaty" && unread > 0 && <span className="ctabs__dot" aria-label={`Непрочитанных: ${unread}`} />}
          </span>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
