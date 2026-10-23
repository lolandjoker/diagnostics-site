import { requireExpert } from "@/lib/expert-auth";
import { InboxList } from "../../InboxList";

export default async function ExpertInboxPage() {
  const expert = await requireExpert();
  return (
    <>
      <h1>Чаты</h1>
      <p className="muted">
        К вам попадают новые клиенты, только пока вы «в сети» и панель открыта: статус гаснет сам через 5 минут без
        панели.
      </p>
      <InboxList url="/expert/api/inbox" linkBase="/expert/chat" meId={expert.id} />
    </>
  );
}
