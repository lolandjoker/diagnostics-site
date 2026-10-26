import { requireExpert } from "@/lib/expert-auth";
import { InboxList } from "../../InboxList";

export default async function ExpertInboxPage() {
  const expert = await requireExpert();
  return (
    <>
      <h1>Чаты</h1>
      <p className="muted">
        Новые клиенты могут выбрать вас, пока вы «в сети» или «занят» (занятому пишут, но ждут ответа позже).
        Статус держится, пока вы его не смените, — даже если панель закрыта. Уходите — нажмите «Не в сети».
      </p>
      <InboxList url="/expert/api/inbox" linkBase="/expert/chat" meId={expert.id} />
    </>
  );
}
