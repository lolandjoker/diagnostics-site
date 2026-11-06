import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { chatsOfLeads, conversationHeader, getConversation } from "@/lib/chat";
import { clubStatus } from "@/lib/club-status";
import { requireExpert } from "@/lib/expert-auth";
import { getTexts } from "@/lib/texts";
import { CallPanel } from "../../../../../CallPanel";
import { ChatThread } from "../../../../../ChatThread";
import { StaffChatHead } from "../../../../../StaffMessenger";

export default async function ExpertChatPage(props: PageProps<"/expert/chat/[id]">) {
  const expert = await requireExpert();
  const { id } = await props.params;
  const { m } = await props.searchParams;
  const focusId = typeof m === "string" && /^\d+$/.test(m) ? Number(m) : undefined;
  const db = await getDb();
  const conversation = await getConversation(db, id);
  if (!conversation) notFound();
  const [header, leadChats, club, t] = await Promise.all([
    conversationHeader(db, conversation),
    chatsOfLeads(db, [conversation.leadId]),
    clubStatus(db, conversation.leadId),
    getTexts(db, ["chat.placeholder", "chat.send"]),
  ]);
  const mine = conversation.expertId === expert.id;

  return (
    <>
      <StaffChatHead
        name={header?.leadName ?? "Клиент"}
        birthDate={header?.birthDate ?? null}
        expertName={header?.expertName ?? null}
        telegram={header?.telegram ?? false}
        geoCountry={header?.geoCountry ?? null}
        geoCity={header?.geoCity ?? null}
        chats={(leadChats.get(conversation.leadId) ?? []).map((c) => ({ id: c.id, expertName: c.expertName, diagnosis: c.diagnosis }))}
        currentId={conversation.id}
        club={club}
        blocked={header?.blocked ?? false}
        mine={mine}
        warning={
          header?.expertArchived ? (
            <p className="notice notice--error staff-chat__note">
              Эксперт {header.expertName} в архиве — клиент этот чат сейчас не видит и уведомлений не получает. Сообщения
              сохранятся и появятся у него, когда эксперта достанут из архива.
            </p>
          ) : !mine ? (
            <p className="notice notice--error staff-chat__note">
              Это чат эксперта {header?.expertName}. Если ответите, клиент увидит ваше имя — {expert.name}.
            </p>
          ) : undefined
        }
      />
      <ChatThread
        key={conversation.id}
        url={`/expert/api/chat/${conversation.id}`}
        typingUrl={`/expert/api/chat/${conversation.id}/typing`}
        typingName={header?.leadName ?? "Клиент"}
        ownAuthors={[]}
        receipts="staff"
        {...(focusId !== undefined && { focusId })}
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
