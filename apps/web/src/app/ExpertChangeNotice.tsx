import { getDb } from "@/db";
import { pendingExpertChange } from "@/lib/expert-change";
import { approveExpertChangeAction, declineExpertChangeAction } from "./admin/actions";

/** Плашка в чате у админа и экспертов: клиент просит перевести его к другому эксперту. */
export async function ExpertChangeNotice({ conversationId }: { conversationId: string }) {
  const req = await pendingExpertChange(await getDb(), conversationId);
  if (!req) return null;
  return (
    <div className="notice notice--change">
      <span>
        🔁 Клиент просит перевести его к эксперту <b>{req.toName}</b>. Переписка сохранится, новый эксперт поздоровается
        в чате.
      </span>
      <span className="notice__actions">
        <form action={approveExpertChangeAction}>
          <input type="hidden" name="id" value={req.id} />
          <button className="button">Перевести</button>
        </form>
        <form action={declineExpertChangeAction}>
          <input type="hidden" name="id" value={req.id} />
          <button className="link-button link-button--danger">Отклонить</button>
        </form>
      </span>
    </div>
  );
}
