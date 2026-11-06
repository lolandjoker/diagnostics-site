import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getDb } from "@/db";
import { requireExpert } from "@/lib/expert-auth";
import { staffTelegramStatus } from "@/lib/staff-telegram";
import { AdminNav } from "../../AdminNav";
import { StaffTelegramLink } from "../../StaffTelegramLink";
import { expertStatus } from "@/lib/experts";
import type { ExpertStatus } from "@/lib/experts";
import { expertLogout, setMyStatus } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Панель эксперта" };

export default async function ExpertLayout({ children }: { children: ReactNode }) {
  const expert = await requireExpert();
  const current = expertStatus(expert, new Date());
  const tg = await staffTelegramStatus(await getDb(), { kind: "expert", staffId: expert.id });
  const options: [ExpertStatus, string][] = [
    ["online", "В сети"],
    ["busy", "Занят"],
    ["offline", "Не в сети"],
  ];
  return (
    <div className="admin">
      <header className="admin__header">
        <AdminNav
          items={[
            { href: "/expert", label: "Чаты" },
            { href: "/admin", label: "Сводка" },
            { href: "/admin/experts", label: "Эксперты" },
            { href: "/admin/reviews", label: "Отзывы" },
          ]}
          who={expert.name}
        />
        <div className="row">
          <StaffTelegramLink kind="expert" connected={tg.connected} name={tg.name} />
          <form action={setMyStatus} className="status-switch" aria-label="Мой статус">
            {options.map(([status, label]) => (
              <button
                key={status}
                name="status"
                value={status}
                className={status === current ? `status-switch__btn status-switch__btn--${status} is-current` : "status-switch__btn"}
                aria-pressed={status === current}
              >
                {label}
              </button>
            ))}
          </form>
          <form action={expertLogout}>
            <button className="link-button">Выйти</button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
