import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { conversationHeader, getConversation, offerableProducts } from "@/lib/chat";
import { getTexts } from "@/lib/texts";
import { ChatThread } from "../../../../ChatThread";

export default async function AdminChatPage(props: PageProps<"/admin/chats/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const conversation = await getConversation(db, id);
  if (!conversation) notFound();
  const [header, products, t] = await Promise.all([
    conversationHeader(db, conversation),
    offerableProducts(db),
    getTexts(db, ["chat.placeholder", "chat.send", "result.buy_button", "chat.admin_name"]),
  ]);
  return (
    <>
      <p>
        <Link href="/admin/chats">← Все чаты</Link>
      </p>
      <h1>{header?.leadName}</h1>
      <p className="muted">
        Дата рождения: {header?.birthDate.split("-").reverse().join(".")}. Эксперт: {header?.expertName}. Ваши сообщения
        клиент видит с подписью «{t["chat.admin_name"]}».
      </p>
      <ChatThread
        url={`/admin/api/chat/${conversation.id}`}
        ownAuthors={["admin"]}
        labels={{ placeholder: t["chat.placeholder"], send: t["chat.send"], buy: t["result.buy_button"] }}
        products={products}
      />
    </>
  );
}
