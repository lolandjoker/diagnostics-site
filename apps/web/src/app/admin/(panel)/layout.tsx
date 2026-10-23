import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin-auth";
import { smtpMailer } from "@/lib/mail";
import { logout } from "../auth-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Админка" };

const NAV = [
  ["/admin", "Сводка"],
  ["/admin/texts", "Тексты сайта"],
  ["/admin/diagnostic", "Разбор"],
  ["/admin/products", "Продукты и цены"],
  ["/admin/orders", "Заказы"],
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
      {!smtpMailer() && (
        <p className="notice notice--error">
          Почта не настроена: письма с заказами не уходят. Нужны SMTP_URL и MAIL_FROM в .env на сервере.
        </p>
      )}
      <main>{children}</main>
    </div>
  );
}
