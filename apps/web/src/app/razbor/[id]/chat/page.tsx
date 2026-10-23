import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { conversationForLead } from "@/lib/chat";
import { expertPhotoUrls, getExpert } from "@/lib/experts";
import { getLead } from "@/lib/leads";
import { fillTemplate, getTexts } from "@/lib/texts";
import { ChatThread } from "../../../ChatThread";

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
    getTexts(db, ["chat.title", "chat.placeholder", "chat.send", "result.buy_button"]),
  ]);

  return (
    <main className="page page--chat">
      {/* Заголовок из «Текстов сайта» — для программ чтения с экрана; видимая шапка — с фото эксперта */}
      <h1 className="sr-only">{fillTemplate(t["chat.title"], { expert: expert?.name ?? "" })}</h1>
      <ChatThread
        url={`/api/chat/${lead.id}`}
        ownAuthors={["client"]}
        labels={{ placeholder: t["chat.placeholder"], send: t["chat.send"], buy: t["result.buy_button"] }}
        peer={{
          name: expert?.name ?? "Эксперт",
          photo: expert ? (photos.get(expert.id) ?? null) : null,
          backHref: `/razbor/${lead.id}`,
          backLabel: "К разбору",
        }}
      />
    </main>
  );
}
