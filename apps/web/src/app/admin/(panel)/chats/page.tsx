import { InboxList } from "../../../InboxList";

export default function AdminChatsPage() {
  return (
    <>
      <h1>Чаты</h1>
      <p className="muted">
        Все переписки клиентов с экспертами. Вы можете ответить в любой — сообщение будет подписано «Администратор».
      </p>
      <InboxList url="/admin/api/inbox" linkBase="/admin/chats" />
    </>
  );
}
