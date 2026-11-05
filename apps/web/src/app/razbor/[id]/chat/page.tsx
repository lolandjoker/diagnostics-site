import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { clientChats, conversationForLead, leadConversation } from "@/lib/chat";
import { expertPhotoUrls, formatRating, getExpert } from "@/lib/experts";
import { expertGallery } from "@/lib/gallery";
import { MAX_LEAD_EDITS, getLead } from "@/lib/leads";
import { HEARD_FROM } from "@/lib/sources";
import { splitExpertName } from "@/lib/expert-name";
import { telegramLink } from "@/lib/telegram";
import { replyTimeLabel, replyTimes } from "@/lib/reply-time";
import { expertReviews, reviewsCount } from "@/lib/reviews";
import { fillTemplate, getTexts } from "@/lib/texts";
import { CallPanel } from "../../../CallPanel";
import { ChatThread } from "../../../ChatThread";
import { ClientChatList } from "../../../ClientChatList";
import { ExpertPanel } from "../../../ExpertPanel";
import { HeardFromPoll } from "../../../HeardFromPoll";
import { ReviewButton } from "../../../ReviewButton";

export const dynamic = "force-dynamic";

/**
 * Чат клиента как в мессенджере: слева — переписки со всеми экспертами, по центру — открытый чат,
 * справа — мини-профиль эксперта. ?c=<id чата> — какой открыт (без него — текущий).
 * На узком экране остаётся только чат: переписки — отдельной страницей, профиль — по имени в шапке.
 */
export default async function ClientChatPage(props: PageProps<"/razbor/[id]/chat">) {
  const { id } = await props.params;
  const { c, q: ask } = await props.searchParams;
  // Вопрос из «Моего дня» («Спросить эксперта об этой карте») — в поле ввода, отправляет сам человек
  const draft = typeof ask === "string" ? ask.slice(0, 300) : undefined;
  const db = await getDb();
  const lead = await getLead(db, id);
  // Заявки нет (удалена или чужой адрес из истории браузера) — к форме на главной
  if (!lead) redirect("/");
  const conversation = await leadConversation(db, lead.id, typeof c === "string" ? c : null);
  if (!conversation) {
    // Чужой или старый адрес чата — в текущий чат; чатов нет — к выбору эксперта
    if (await conversationForLead(db, lead.id)) redirect(`/razbor/${lead.id}/chat`);
    redirect(`/razbor/${lead.id}/eksperty`);
  }
  const [expert, photos, chats, t, telegram] = await Promise.all([
    getExpert(db, conversation.expertId),
    expertPhotoUrls(db),
    clientChats(db, lead.id),
    getTexts(db, [
      "chat.title",
      "chat.placeholder",
      "chat.send",
      "experts.busy",
      "chat.suggestions",
      "chat.tg_invite_title",
      "chat.tg_invite_text",
      "chat.tg_invite_button",
      "chat.offline_wait",
      "chat.offline_wait_tg",
    ]),
    telegramLink(lead),
  ]);

  const expertName = expert?.name ?? "Эксперт";
  const expertPhoto = expert ? (photos.get(expert.id) ?? null) : null;
  const [gallery, reviews, replies] = expert
    ? await Promise.all([
        expertGallery(db, expert.id, expertPhoto),
        expertReviews(db, [expert.id]),
        replyTimes(db, [expert.id], new Date()),
      ])
    : [[], new Map(), new Map<number, number>()];
  const replySeconds = replies.get(conversation.expertId);
  const replyTime = replySeconds === undefined ? undefined : replyTimeLabel(replySeconds);
  const q = `?c=${conversation.id}`;
  const profileHref = `/ekspert/${conversation.expertId}?lead=${lead.id}&c=${conversation.id}`;

  return (
    <main className="messenger">
      {/* Заголовок из «Текстов сайта» — для программ чтения с экрана; видимая шапка — с фото эксперта */}
      <h1 className="sr-only">{fillTemplate(t["chat.title"], { expert: expert?.name ?? "" })}</h1>
      <div className="messenger__chats">
        <ClientChatList leadId={lead.id} currentId={conversation.id} initial={chats} editsLeft={MAX_LEAD_EDITS - lead.edits} telegram={telegram} />
      </div>
      <div className="messenger__chat">
        <ChatThread
          draft={draft}
          key={conversation.id}
          url={`/api/chat/${lead.id}${q}`}
          typingUrl={`/api/chat/${lead.id}/typing${q}`}
          typingName={expertName}
          ownAuthors={["client"]}
          suggestions={t["chat.suggestions"]
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 4)}
          labels={{ placeholder: t["chat.placeholder"], send: t["chat.send"] }}
          peer={{
            name: expertName,
            photo: expertPhoto,
            busyLabel: t["experts.busy"],
            ...(expert && { rating: formatRating(expert.rating) }),
            profileHref,
            backHref: `/razbor/${lead.id}/eksperty`,
            backLabel: "К экспертам",
          }}
          // «Откуда узнали?» — только тем, кто открыл просто taromba.com: не по короткому адресу и не из Telegram-бота
          prompt={
            !lead.source &&
            !lead.heardFrom &&
            lead.telegramUserId === null && <HeardFromPoll leadId={lead.id} options={HEARD_FROM} />
          }
          offlineNotice={{
            text: fillTemplate(t["chat.offline_wait"], { expert: splitExpertName(expert?.name ?? "").name || "Эксперт" }),
            // Бот выключен — без призыва подключить Telegram
            connectedText: telegram
              ? fillTemplate(t["chat.offline_wait_tg"], { expert: splitExpertName(expert?.name ?? "").name || "Эксперт" })
              : `${splitExpertName(expert?.name ?? "").name || "Эксперт"} сейчас не в сети и ответит, как только появится.`,
            telegramHref: telegram && !telegram.connected ? telegram.href : undefined,
            button: t["chat.tg_invite_button"],
          }}
          telegramInvite={
            telegram && !telegram.connected
              ? {
                  key: lead.id,
                  href: telegram.href,
                  title: t["chat.tg_invite_title"],
                  text: t["chat.tg_invite_text"],
                  button: t["chat.tg_invite_button"],
                  later: "Не сейчас",
                }
              : undefined
          }
          notice={
            telegram &&
            !telegram.connected && (
              <a className="chat__notice" href={telegram.href} target="_blank" rel="noopener noreferrer">
                🔔 Получать ответы эксперта в Telegram <span aria-hidden="true">→</span>
              </a>
            )
          }
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
                <span className="chat__icon-label">Эксперты</span>
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
          <ExpertPanel
            expert={expert}
            photos={gallery}
            busyLabel={t["experts.busy"]}
            profileHref={profileHref}
            reviews={reviewsCount(expert.reviewsShown, reviews.get(expert.id)?.count ?? 0)}
            {...(replyTime && { replyTime })}
          />
        </div>
      )}
    </main>
  );
}
