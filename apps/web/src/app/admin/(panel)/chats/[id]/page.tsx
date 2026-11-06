import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { chatsOfLeads, conversationHeader, getConversation } from "@/lib/chat";
import { clubStatus } from "@/lib/club-status";
import { getTexts } from "@/lib/texts";
import { CallPanel } from "../../../../CallPanel";
import { ChatThread } from "../../../../ChatThread";
import { StaffChatHead } from "../../../../StaffMessenger";

export default async function AdminChatPage(props: PageProps<"/admin/chats/[id]">) {
  const { id } = await props.params;
  const { m } = await props.searchParams;
  const focusId = typeof m === "string" && /^\d+$/.test(m) ? Number(m) : undefined;
  if (!(await isAdmin())) redirect(`/expert/chat/${id}`);
  const db = await getDb();
  const conversation = await getConversation(db, id);
  if (!conversation) notFound();
  const [header, leadChats, club, t] = await Promise.all([
    conversationHeader(db, conversation),
    chatsOfLeads(db, [conversation.leadId]),
    clubStatus(db, conversation.leadId),
    getTexts(db, ["chat.placeholder", "chat.send", "chat.admin_name"]),
  ]);
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
        blockUrl={`/admin/api/chat/${conversation.id}/block`}
        warning={
          header?.expertArchived ? (
            <p className="notice notice--error staff-chat__note">
              Эксперт {header.expertName} в архиве — клиент этот чат сейчас не видит и уведомлений не получает. Сообщения
              сохранятся и появятся у него, когда эксперта достанут из архива.
            </p>
          ) : undefined
        }
        info={
          <>
            Ваши сообщения клиент видит от имени эксперта — {header?.expertName}, с его фото. Подпись «{t["chat.admin_name"]}» (у
            операторов — «Оператор: имя») видите только вы и эксперты.
          </>
        }
      />
      <ChatThread
        key={conversation.id}
        url={`/admin/api/chat/${conversation.id}`}
        typingUrl={`/admin/api/chat/${conversation.id}/typing`}
        typingName={header?.leadName ?? "Клиент"}
        ownAuthors={["admin"]}
        receipts="staff"
        {...(focusId !== undefined && { focusId })}
        manageUrl={`/admin/api/chat/${conversation.id}/messages`}
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
