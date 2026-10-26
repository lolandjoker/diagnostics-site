import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { conversationForLead } from "@/lib/chat";
import { expertPhotoUrls, formatRating, getExpert } from "@/lib/experts";
import { getLead } from "@/lib/leads";
import { fillTemplate, getTexts } from "@/lib/texts";
import { CallPanel } from "../../../CallPanel";
import { ChatThread } from "../../../ChatThread";
import { ReviewButton } from "../../../ReviewButton";

export const dynamic = "force-dynamic";

export default async function ClientChatPage(props: PageProps<"/razbor/[id]/chat">) {
  const { id } = await props.params;
  const db = await getDb();
  const lead = await getLead(db, id);
  if (!lead) notFound();
  const conversation = await conversationForLead(db, lead.id);
  if (!conversation) redirect(`/razbor/${lead.id}/eksperty`);
  const [expert, photos, t] = await Promise.all([
    getExpert(db, conversation.expertId),
    expertPhotoUrls(db),
    getTexts(db, ["chat.title", "chat.placeholder", "chat.send", "experts.busy"]),
  ]);

  const expertName = expert?.name ?? "Эксперт";
  const expertPhoto = expert ? (photos.get(expert.id) ?? null) : null;

  return (
    <main className="page page--chat">
      {/* Заголовок из «Текстов сайта» — для программ чтения с экрана; видимая шапка — с фото эксперта */}
      <h1 className="sr-only">{fillTemplate(t["chat.title"], { expert: expert?.name ?? "" })}</h1>
      <ChatThread
        url={`/api/chat/${lead.id}`}
        ownAuthors={["client"]}
        labels={{ placeholder: t["chat.placeholder"], send: t["chat.send"] }}
        peer={{
          name: expertName,
          photo: expertPhoto,
          busyLabel: t["experts.busy"],
          ...(expert && { rating: formatRating(expert.rating) }),
          backHref: `/razbor/${lead.id}`,
          backLabel: "К разбору",
        }}
        call={
          <>
            <ReviewButton url={`/api/chat/${lead.id}/review`} expertName={expertName} clientName={lead.name} />
            <CallPanel
              url={`/api/chat/${lead.id}/call`}
              role="client"
              peer={{ name: expertName, photo: expertPhoto }}
              initialRequested={conversation.callRequestedAt !== null}
            />
          </>
        }
      />
    </main>
  );
}
