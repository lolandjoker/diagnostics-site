import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireOperator } from "@/lib/operator-auth";
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
  return (
    <div className="admin">
      <header className="admin__header">
        <nav>
          <b>Чаты</b>
          <span className="muted">Оператор: {operator.name}</span>
        </nav>
        <form action={operatorLogout}>
          <button className="link-button">Выйти</button>
        </form>
      </header>
      <main>
        <StaffMessenger inboxUrl="/admin/api/inbox" linkBase="/operator/chat" listHref="/operator">
          {children}
        </StaffMessenger>
      </main>
    </div>
  );
}
