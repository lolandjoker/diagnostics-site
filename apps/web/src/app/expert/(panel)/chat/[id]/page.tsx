import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { conversationHeader, getConversation, offerableProducts } from "@/lib/chat";
import { requireExpert } from "@/lib/expert-auth";
import { getTexts } from "@/lib/texts";
import { ChatThread } from "../../../../ChatThread";

export default async function ExpertChatPage(props: PageProps<"/expert/chat/[id]">) {
  const expert = await requireExpert();
  const { id } = await props.params;
  const db = await getDb();
  const conversation = await getConversation(db, id);
  if (!conversation) notFound();
  const [header, products, t] = await Promise.all([
    conversationHeader(db, conversation),
    offerableProducts(db),
    getTexts(db, ["chat.placeholder", "chat.send", "result.buy_button"]),
  ]);
  const mine = conversation.expertId === expert.id;
  const birth = header?.birthDate.split("-").reverse().join(".");

  return (
    <>
      <p>
        <Link href="/expert">← Все чаты</Link>
      </p>
      <h1>{header?.leadName}</h1>
      <p className="muted">
        Дата рождения: {birth}. Эксперт чата: {header?.expertName}
        {mine ? " (вы)" : ""}.
      </p>
      {!mine && (
        <p className="notice notice--error">
          Это чат эксперта {header?.expertName}. Если ответите, клиент увидит ваше имя — {expert.name}.
        </p>
      )}
      <ChatThread
        url={`/expert/api/chat/${conversation.id}`}
        ownAuthors={[]}
        ownExpertId={expert.id}
        labels={{ placeholder: t["chat.placeholder"], send: t["chat.send"], buy: t["result.buy_button"] }}
        products={products}
      />
    </>
  );
}
