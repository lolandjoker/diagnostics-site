"use client";

/**
 * Разделы панели в шапке: текущий подсвечен. На телефоне — одна строка, листается пальцем вбок
 * (текущий раздел сам прокручивается в вид).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export interface NavItem {
  href: string;
  label: string;
}

const isCurrent = (pathname: string, href: string) =>
  href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);

export function AdminNav({ items, who }: { items: NavItem[]; who?: string }) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.querySelector(".is-current")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);
  // Эксперт: «Чаты» — это /expert и /expert/chat/…
  const current = items.find((i) => isCurrent(pathname, i.href))?.href ?? (pathname.startsWith("/expert") ? "/expert" : null);
  return (
    <nav className="admin-nav" ref={ref} aria-label="Разделы">
      {items.map((n) => (
        <Link key={n.href} href={n.href} className={n.href === current ? "is-current" : undefined} aria-current={n.href === current ? "page" : undefined}>
          {n.label}
        </Link>
      ))}
      {who && <span className="admin-nav__who">{who}</span>}
    </nav>
  );
}
