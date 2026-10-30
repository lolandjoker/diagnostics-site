import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { clientChats, conversationForLead, leadConversation, selectableExperts, startConversation } from "./chat";
import { createExpert, getExpert, setExpertArchived, setExpertOnline } from "./experts";
import { createLead } from "./leads";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

describe("архив экспертов", () => {
  it("эксперт в архиве скрыт от клиента вместе с чатами; из архива всё возвращается", async () => {
    const now = new Date();
    const maria = await createExpert(db, { name: "Мария", login: "maria", password: "пароль-эксперта" });
    const vera = await createExpert(db, { name: "Вера", login: "vera", password: "пароль-эксперта" });
    if (!maria.ok || !vera.ok) throw new Error("эксперты не созданы");
    await setExpertOnline(db, maria.id, true, now);
    await setExpertOnline(db, vera.id, true, now);
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, now, null);
    const chat = await startConversation(db, lead, maria.id, now);
    if (!chat.ok) throw new Error(chat.error);

    await setExpertArchived(db, maria.id, true, now);
    const archived = (await getExpert(db, maria.id))!;
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.online).toBe(false);
    expect((await selectableExperts(db, now)).map((e) => e.name)).toEqual(["Вера"]);
    expect(await clientChats(db, lead.id)).toEqual([]);
    expect(await conversationForLead(db, lead.id)).toBeNull();
    expect(await leadConversation(db, lead.id, chat.conversation.id)).toBeNull();
    expect(await startConversation(db, lead, maria.id, now)).toMatchObject({ ok: false });

    // Новый чат с другим экспертом — уже не первый: подробный разбор второй раз не придёт
    const second = await startConversation(db, lead, vera.id, now);
    if (!second.ok) throw new Error(second.error);
    expect(second.conversation.fullTextSentAt).not.toBeNull();

    await setExpertArchived(db, maria.id, false, now);
    expect((await getExpert(db, maria.id))!.archivedAt).toBeNull();
    expect((await clientChats(db, lead.id)).map((c) => c.expertName).sort()).toEqual(["Вера", "Мария"]);
    expect(await leadConversation(db, lead.id, chat.conversation.id)).toMatchObject({ id: chat.conversation.id });
  });
});
