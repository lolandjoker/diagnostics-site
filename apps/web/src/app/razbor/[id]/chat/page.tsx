import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { conversationForLead } from "@/lib/chat";
import { getExpert } from "@/lib/experts";
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
  const expert = await getExpert(db, conversation.expertId);
  const t = await getTexts(db, ["chat.title", "chat.placeholder", "chat.send", "result.buy_button"]);

  return (
    <main className="page page--chat">
      <p>
        <Link href={`/razbor/${lead.id}`}>← К разбору</Link>
      </p>
      <h1 className="chat__title">{fillTemplate(t["chat.title"], { expert: expert?.name ?? "" })}</h1>
      <ChatThread
        url={`/api/chat/${lead.id}`}
        canReply
        ownAuthors={["client"]}
        labels={{ placeholder: t["chat.placeholder"], send: t["chat.send"], buy: t["result.buy_button"] }}
      />
    </main>
  );
}
