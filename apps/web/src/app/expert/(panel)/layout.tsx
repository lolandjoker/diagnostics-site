import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireExpert } from "@/lib/expert-auth";
import { isOnline } from "@/lib/experts";
import { expertLogout, toggleOnline } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Панель эксперта" };

export default async function ExpertLayout({ children }: { children: ReactNode }) {
  const expert = await requireExpert();
  const online = isOnline(expert, new Date());
  return (
    <div className="admin">
      <header className="admin__header">
        <nav>
          <Link href="/expert">Чаты</Link>
          <span className="muted">{expert.name}</span>
        </nav>
        <div className="row">
          <form action={toggleOnline}>
            <input type="hidden" name="online" value={online ? "false" : "true"} />
            <button className={online ? "status-toggle status-toggle--on" : "status-toggle"}>
              {online ? "● В сети — нажмите, чтобы уйти" : "○ Не в сети — нажмите, чтобы выйти на связь"}
            </button>
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
