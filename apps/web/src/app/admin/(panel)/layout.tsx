import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin-auth";
import { logout } from "../auth-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Админка" };

const NAV = [
  ["/admin", "Сводка"],
  ["/admin/chats", "Чаты"],
  ["/admin/variations", "Варианты диагностики"],
  ["/admin/experts", "Эксперты"],
  ["/admin/texts", "Тексты сайта"],
] as const;

export default async function PanelLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <div className="admin">
      <header className="admin__header">
        <nav>
          {NAV.map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <form action={logout}>
          <button className="link-button">Выйти</button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}
