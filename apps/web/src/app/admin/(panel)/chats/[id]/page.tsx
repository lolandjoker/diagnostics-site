import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { conversationHeader, getConversation } from "@/lib/chat";
import { getTexts } from "@/lib/texts";
import { CallPanel } from "../../../../CallPanel";
import { ChatThread } from "../../../../ChatThread";

export default async function AdminChatPage(props: PageProps<"/admin/chats/[id]">) {
  const { id } = await props.params;
  if (!(await isAdmin())) redirect(`/expert/chat/${id}`);
  const db = await getDb();
  const conversation = await getConversation(db, id);
  if (!conversation) notFound();
  const [header, t] = await Promise.all([
    conversationHeader(db, conversation),
    getTexts(db, ["chat.placeholder", "chat.send", "chat.admin_name"]),
  ]);
  return (
    <>
      <p>
        <Link href="/admin/chats">← Все чаты</Link>
      </p>
      <h1>{header?.leadName}</h1>
      <p className="muted">
        Дата рождения: {header?.birthDate.split("-").reverse().join(".")}. Эксперт: {header?.expertName}. Ваши сообщения
        клиент видит от имени эксперта — {header?.expertName}, с его фото. Подпись «{t["chat.admin_name"]}» видите
        только вы и эксперты.
      </p>
      <ChatThread
        url={`/admin/api/chat/${conversation.id}`}
        typingUrl={`/admin/api/chat/${conversation.id}/typing`}
        typingName={header?.leadName ?? "Клиент"}
        ownAuthors={["admin"]}
        labels={{ placeholder: t["chat.placeholder"], send: t["chat.send"] }}
        call={
          <CallPanel
            url={`/admin/api/chat/${conversation.id}/call`}
            role="staff"
            peer={{ name: header?.leadName ?? "Клиент" }}
            initialRequested={conversation.callRequestedAt !== null}
          />
        }
      />
    </>
  );
}
