import { cookies } from "next/headers";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getDb } from "@/db";
import { requireStaff } from "@/lib/staff-auth";
import { staffTelegramStatus } from "@/lib/staff-telegram";
import { AdminNav } from "../../AdminNav";
import { StaffTelegramLink } from "../../StaffTelegramLink";
import { ThemePicker } from "../../ThemePicker";
import { STAFF_THEME_COOKIE, isStaffTheme } from "@/lib/staff-theme";
import { logout } from "../auth-actions";
import { expertLogout } from "../../expert/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Админка" };

/** Эксперт видит всё, кроме «Текстов сайта»; чаты у него — в его панели. */
const NAV: { href: string; label: string; expertHref?: string; adminOnly?: boolean }[] = [
  { href: "/admin", label: "Сводка" },
  { href: "/admin/chats", label: "Чаты", expertHref: "/expert" },
  { href: "/admin/experts", label: "Эксперты" },
  { href: "/admin/reviews", label: "Отзывы" },
  { href: "/admin/texts", label: "Тексты сайта", adminOnly: true },
  { href: "/admin/rassylki", label: "Рассылки", adminOnly: true },
  { href: "/admin/operators", label: "Операторы", adminOnly: true },
];

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const expert = staff.kind === "expert";
  const ref = expert ? { kind: "expert" as const, staffId: staff.expert.id } : { kind: "admin" as const, staffId: 0 };
  const tg = await staffTelegramStatus(await getDb(), ref);
  const savedTheme = (await cookies()).get(STAFF_THEME_COOKIE)?.value;
  const theme = isStaffTheme(savedTheme) ? savedTheme : "light";
  return (
    <div className="admin" data-theme={theme}>
      <header className="admin__header">
        <AdminNav
          items={NAV.filter((n) => !(expert && n.adminOnly)).map((n) => ({ href: expert ? (n.expertHref ?? n.href) : n.href, label: n.label }))}
          {...(expert && { who: staff.expert.name })}
        />
        <div className="row">
          <ThemePicker current={theme} />
          <StaffTelegramLink kind={ref.kind} connected={tg.connected} name={tg.name} />
          <form action={expert ? expertLogout : logout}>
            <button className="link-button">Выйти</button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
