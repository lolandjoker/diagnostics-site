/** Обёртка страницы квиза: меню, «← Мой день», заголовок и сам квиз в рамке. */
import Link from "next/link";
import type { ReactNode } from "react";
import { ClientTabs } from "./ClientTabs";
import type { QuizContext } from "./razbor/[id]/quiz-context";

export function QuizPage({ ctx, title, lead, children }: { ctx: QuizContext; title: string; lead: string; children: ReactNode }) {
  return (
    <main className="page page--den page--quiz has-tabs">
      <ClientTabs leadId={ctx.lead.id} current="den" hasChats={ctx.hasChats} unread={ctx.unread} />
      <Link className="quiz__back" href={`/razbor/${ctx.lead.id}/den`}>
        ← Мой день
      </Link>
      <header className="quiz__head">
        <span className="eyebrow">Клуб Таромбы</span>
        <h1>{title}</h1>
        <p>{lead}</p>
      </header>
      <section className="den__main quiz">{children}</section>
    </main>
  );
}
