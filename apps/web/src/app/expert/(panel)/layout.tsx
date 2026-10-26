import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireExpert } from "@/lib/expert-auth";
import { expertStatus } from "@/lib/experts";
import type { ExpertStatus } from "@/lib/experts";
import { expertLogout, setMyStatus } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Панель эксперта" };

export default async function ExpertLayout({ children }: { children: ReactNode }) {
  const expert = await requireExpert();
  const current = expertStatus(expert, new Date());
  const options: [ExpertStatus, string][] = [
    ["online", "В сети"],
    ["busy", "Занят"],
    ["offline", "Не в сети"],
  ];
  return (
    <div className="admin">
      <header className="admin__header">
        <nav>
          <Link href="/expert">Чаты</Link>
          <span className="muted">{expert.name}</span>
        </nav>
        <div className="row">
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
