import { count, countDistinct, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { calls, conversations, leads, messages } from "@/db/schema";

export default async function DashboardPage() {
  const db = await getDb();
  const [[leadRow], [chatRow], [repliedRow], [callRow]] = await Promise.all([
    db.select({ n: count() }).from(leads),
    // Людей, а не чатов: после перевода к другому эксперту у человека их несколько
    db.select({ n: countDistinct(conversations.leadId) }).from(conversations),
    db
      .select({ n: countDistinct(conversations.leadId) })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(eq(messages.author, "client")),
    db
      .select({ n: count() })
      .from(calls)
      .where(sql`${calls.answeredAt} is not null`),
  ]);

  return (
    <>
      <h1>Сводка</h1>
      <div className="stats">
        <div>
          <b>{leadRow?.n ?? 0}</b> заявок на разбор
        </div>
        <div>
          <b>{chatRow?.n ?? 0}</b> перешли в чат
        </div>
        <div>
          <b>{repliedRow?.n ?? 0}</b> написали в чат
        </div>
        <div>
          <b>{callRow?.n ?? 0}</b> состоявшихся звонков
        </div>
      </div>
      <p className="muted">Воронка по каждому варианту диагностики — в разделе «Варианты диагностики».</p>
    </>
  );
}
