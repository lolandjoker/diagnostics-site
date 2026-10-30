import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { conversationHeader, getConversation } from "@/lib/chat";
import { requireExpert } from "@/lib/expert-auth";
import { getTexts } from "@/lib/texts";
import { CallPanel } from "../../../../../CallPanel";
import { ChatThread } from "../../../../../ChatThread";
import { StaffChatHead } from "../../../../../StaffMessenger";

export default async function ExpertChatPage(props: PageProps<"/expert/chat/[id]">) {
  const expert = await requireExpert();
  const { id } = await props.params;
  const db = await getDb();
  const conversation = await getConversation(db, id);
  if (!conversation) notFound();
  const [header, t] = await Promise.all([
    conversationHeader(db, conversation),
    getTexts(db, ["chat.placeholder", "chat.send"]),
  ]);
  const mine = conversation.expertId === expert.id;
  const birth = header?.birthDate.split("-").reverse().join(".");

  return (
    <>
      <StaffChatHead
        name={header?.leadName ?? "Клиент"}
        meta={
          <>
            Дата рождения: {birth} · Эксперт чата: {header?.expertName}
            {mine ? " (вы)" : ""}
          </>
        }
        note={
          header?.expertArchived ? (
            <p className="notice notice--error staff-chat__note">
              Эксперт {header.expertName} в архиве — клиент этот чат сейчас не видит и уведомлений не получает. Сообщения
              сохранятся и появятся у него, когда эксперта достанут из архива.
            </p>
          ) : !mine && (
            <p className="notice notice--error staff-chat__note">
              Это чат эксперта {header?.expertName}. Если ответите, клиент увидит ваше имя — {expert.name}.
            </p>
          )
        }
      />
      <ChatThread
        key={conversation.id}
        url={`/expert/api/chat/${conversation.id}`}
        typingUrl={`/expert/api/chat/${conversation.id}/typing`}
        typingName={header?.leadName ?? "Клиент"}
        ownAuthors={[]}
        ownExpertId={expert.id}
        labels={{ placeholder: t["chat.placeholder"], send: t["chat.send"] }}
        call={
          <CallPanel
            url={`/expert/api/chat/${conversation.id}/call`}
            role="staff"
            peer={{ name: header?.leadName ?? "Клиент" }}
            initialRequested={conversation.callRequestedAt !== null}
          />
        }
      />
    </>
  );
}
