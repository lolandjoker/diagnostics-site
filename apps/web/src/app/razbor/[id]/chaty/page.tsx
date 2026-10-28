import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { clientChats } from "@/lib/chat";
import { MAX_LEAD_EDITS, getLead } from "@/lib/leads";
import { telegramLink } from "@/lib/telegram";
import { ClientChatList } from "../../../ClientChatList";

export const dynamic = "force-dynamic";

/** Переписки клиента отдельной страницей — для телефона, где списка слева от чата нет. */
export default async function ClientChatsPage(props: PageProps<"/razbor/[id]/chaty">) {
  const { id } = await props.params;
  const db = await getDb();
  const lead = await getLead(db, id);
  if (!lead) notFound();
  const [chats, telegram] = await Promise.all([clientChats(db, lead.id), telegramLink(lead)]);
  if (chats.length === 0) redirect(`/razbor/${lead.id}/eksperty`);
  return (
    <main className="page page--chats">
      <p>
        <Link href={`/razbor/${lead.id}`}>← К разбору</Link>
      </p>
      <h1>Переписки</h1>
      <ClientChatList leadId={lead.id} currentId={null} initial={chats} editsLeft={MAX_LEAD_EDITS - lead.edits} telegram={telegram} />
    </main>
  );
}
