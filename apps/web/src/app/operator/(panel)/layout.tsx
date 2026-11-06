import { cookies } from "next/headers";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getDb } from "@/db";
import { requireOperator } from "@/lib/operator-auth";
import { staffTelegramStatus } from "@/lib/staff-telegram";
import { AdminNav } from "../../AdminNav";
import { StaffTelegramLink } from "../../StaffTelegramLink";
import { ThemePicker } from "../../ThemePicker";
import { STAFF_THEME_COOKIE, isStaffTheme } from "@/lib/staff-theme";
import { StaffMessenger } from "../../StaffMessenger";
import { operatorLogout } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Чаты" };

/**
 * Панель оператора чатов: только чаты — все переписки слева, открытая справа. Остальной админки
 * у оператора нет (API чатов — общие с админом, /admin/api/*, пускают и оператора).
 */
export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const operator = await requireOperator();
  const tg = await staffTelegramStatus(await getDb(), { kind: "operator", staffId: operator.id });
  const savedTheme = (await cookies()).get(STAFF_THEME_COOKIE)?.value;
  const theme = isStaffTheme(savedTheme) ? savedTheme : "light";
  return (
    <div className="admin" data-theme={theme}>
      <header className="admin__header">
        <AdminNav items={[{ href: "/operator", label: "Чаты" }]} who={`Оператор: ${operator.name}`} />
        <div className="row">
          <ThemePicker current={theme} />
          <StaffTelegramLink kind="operator" connected={tg.connected} name={tg.name} />
          <form action={operatorLogout}>
            <button className="link-button">Выйти</button>
          </form>
        </div>
      </header>
      <main>
        <StaffMessenger inboxUrl="/admin/api/inbox" linkBase="/operator/chat" listHref="/operator">
          {children}
        </StaffMessenger>
      </main>
    </div>
  );
}
