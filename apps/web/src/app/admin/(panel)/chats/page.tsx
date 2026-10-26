import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { InboxList } from "../../../InboxList";

export default async function AdminChatsPage() {
  // Эксперт отвечает от своего имени — в своей панели
  if (!(await isAdmin())) redirect("/expert");
  return (
    <>
      <h1>Чаты</h1>
      <p className="muted">
        Все переписки клиентов с экспертами. Вы можете ответить в любой — клиент увидит сообщение от эксперта чата.
      </p>
      <InboxList url="/admin/api/inbox" linkBase="/admin/chats" />
    </>
  );
}
