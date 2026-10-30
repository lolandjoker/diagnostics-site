import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { conversationHeader, getConversation } from "@/lib/chat";
import { requireOperator } from "@/lib/operator-auth";
import { getTexts } from "@/lib/texts";
import { CallPanel } from "../../../../CallPanel";
import { ChatThread } from "../../../../ChatThread";
import { StaffChatHead } from "../../../../StaffMessenger";

/** Чат у оператора: как у админа (те же API), свои сообщения — только его собственные. */
export default async function OperatorChatPage(props: PageProps<"/operator/chat/[id]">) {
  const operator = await requireOperator();
  const { id } = await props.params;
  const db = await getDb();
  const conversation = await getConversation(db, id);
  if (!conversation) notFound();
  const [header, t] = await Promise.all([conversationHeader(db, conversation), getTexts(db, ["chat.placeholder", "chat.send"])]);
  return (
    <>
      <StaffChatHead
        name={header?.leadName ?? "Клиент"}
        meta={
          <>
            Дата рождения: {header?.birthDate.split("-").reverse().join(".")} · Эксперт: {header?.expertName}
          </>
        }
        note={
          header?.expertArchived ? (
            <p className="notice notice--error staff-chat__note">
              Эксперт {header.expertName} в архиве — клиент этот чат сейчас не видит и уведомлений не получает. Сообщения
              сохранятся и появятся у него, когда эксперта достанут из архива.
            </p>
          ) : (
            <p className="muted staff-chat__note">
              Клиент видит ваши сообщения от имени эксперта — {header?.expertName}, с его фото.
            </p>
          )
        }
      />
      <ChatThread
        key={conversation.id}
        url={`/admin/api/chat/${conversation.id}`}
        typingUrl={`/admin/api/chat/${conversation.id}/typing`}
        typingName={header?.leadName ?? "Клиент"}
        ownAuthors={["admin"]}
        ownOperatorId={operator.id}
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
