import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireStaff } from "@/lib/staff-auth";
import { logout } from "../auth-actions";
import { expertLogout } from "../../expert/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Админка" };

/** Эксперт видит всё, кроме «Текстов сайта»; чаты у него — в его панели. */
const NAV: { href: string; label: string; expertHref?: string; adminOnly?: boolean }[] = [
  { href: "/admin", label: "Сводка" },
  { href: "/admin/chats", label: "Чаты", expertHref: "/expert" },
  { href: "/admin/variations", label: "Варианты диагностики" },
  { href: "/admin/experts", label: "Эксперты" },
  { href: "/admin/reviews", label: "Отзывы" },
  { href: "/admin/texts", label: "Тексты сайта", adminOnly: true },
];

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const expert = staff.kind === "expert";
  return (
    <div className="admin">
      <header className="admin__header">
        <nav>
          {NAV.filter((n) => !(expert && n.adminOnly)).map((n) => (
            <Link key={n.href} href={expert ? (n.expertHref ?? n.href) : n.href}>
              {n.label}
            </Link>
          ))}
          {expert && <span className="muted">{staff.expert.name}</span>}
        </nav>
        <form action={expert ? expertLogout : logout}>
          <button className="link-button">Выйти</button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}
