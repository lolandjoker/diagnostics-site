import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { clientChats, conversationForLead, leadConversation } from "@/lib/chat";
import { expertPhotoUrls, formatRating, getExpert } from "@/lib/experts";
import { expertGallery } from "@/lib/gallery";
import { getLead } from "@/lib/leads";
import { fillTemplate, getTexts } from "@/lib/texts";
import { CallPanel } from "../../../CallPanel";
import { ChatThread } from "../../../ChatThread";
import { ClientChatList } from "../../../ClientChatList";
import { ExpertPanel } from "../../../ExpertPanel";
import { ReviewButton } from "../../../ReviewButton";

export const dynamic = "force-dynamic";

/**
 * Чат клиента как в мессенджере: слева — переписки со всеми экспертами, по центру — открытый чат,
 * справа — мини-профиль эксперта. ?c=<id чата> — какой открыт (без него — текущий).
 * На узком экране остаётся только чат: переписки — отдельной страницей, профиль — по имени в шапке.
 */
export default async function ClientChatPage(props: PageProps<"/razbor/[id]/chat">) {
  const { id } = await props.params;
  const { c } = await props.searchParams;
  const db = await getDb();
  const lead = await getLead(db, id);
  if (!lead) notFound();
  const conversation = await leadConversation(db, lead.id, typeof c === "string" ? c : null);
  if (!conversation) {
    // Чужой или старый адрес чата — в текущий чат; чатов нет — к выбору эксперта
    if (await conversationForLead(db, lead.id)) redirect(`/razbor/${lead.id}/chat`);
    redirect(`/razbor/${lead.id}/eksperty`);
  }
  const [expert, photos, chats, t] = await Promise.all([
    getExpert(db, conversation.expertId),
    expertPhotoUrls(db),
    clientChats(db, lead.id),
    getTexts(db, ["chat.title", "chat.placeholder", "chat.send", "experts.busy"]),
  ]);

  const expertName = expert?.name ?? "Эксперт";
  const expertPhoto = expert ? (photos.get(expert.id) ?? null) : null;
  const gallery = expert ? await expertGallery(db, expert.id, expertPhoto) : [];
  const q = `?c=${conversation.id}`;
  const profileHref = `/ekspert/${conversation.expertId}?lead=${lead.id}&c=${conversation.id}`;

  return (
    <main className="messenger">
      {/* Заголовок из «Текстов сайта» — для программ чтения с экрана; видимая шапка — с фото эксперта */}
      <h1 className="sr-only">{fillTemplate(t["chat.title"], { expert: expert?.name ?? "" })}</h1>
      <div className="messenger__chats">
        <ClientChatList leadId={lead.id} currentId={conversation.id} initial={chats} />
      </div>
      <div className="messenger__chat">
        <ChatThread
          key={conversation.id}
          url={`/api/chat/${lead.id}${q}`}
          typingUrl={`/api/chat/${lead.id}/typing${q}`}
          typingName={expertName}
          ownAuthors={["client"]}
          labels={{ placeholder: t["chat.placeholder"], send: t["chat.send"] }}
          peer={{
            name: expertName,
            photo: expertPhoto,
            busyLabel: t["experts.busy"],
            ...(expert && { rating: formatRating(expert.rating) }),
            profileHref,
            backHref: `/razbor/${lead.id}`,
            backLabel: "К разбору",
          }}
          call={
            <>
              <Link
                className="chat__icon-button chat__icon-button--narrow"
                href={`/razbor/${lead.id}/chaty`}
                aria-label="Переписки"
                title="Все переписки"
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M4 5h16v10H9l-5 4z" strokeLinejoin="round" />
                  <path d="M8 9h8M8 12h5" strokeLinecap="round" />
                </svg>
              </Link>
              <Link
                className="chat__icon-button chat__icon-button--wide"
                href={`/razbor/${lead.id}/eksperty`}
                aria-label="Эксперты"
                title="Все эксперты и отзывы — можно попросить другого эксперта"
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="9" cy="8" r="3.2" />
                  <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" strokeLinecap="round" />
                  <circle cx="17" cy="9" r="2.5" />
                  <path d="M15.5 14.3c2.6-.4 4.5 1.2 5 4.2" strokeLinecap="round" />
                </svg>
              </Link>
              <ReviewButton url={`/api/chat/${lead.id}/review${q}`} expertName={expertName} clientName={lead.name} />
              <CallPanel
                url={`/api/chat/${lead.id}/call${q}`}
                role="client"
                peer={{ name: expertName, photo: expertPhoto }}
                initialRequested={conversation.callRequestedAt !== null}
              />
            </>
          }
        />
      </div>
      {expert && (
        <div className="messenger__profile">
          <ExpertPanel expert={expert} photos={gallery} busyLabel={t["experts.busy"]} profileHref={profileHref} />
        </div>
      )}
    </main>
  );
}
