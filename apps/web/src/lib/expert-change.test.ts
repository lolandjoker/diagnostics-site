import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { clientChats, conversationForLead, inbox, leadConversation, messageViews, startConversation } from "./chat";
import type { Conversation } from "./chat";
import {
  approveExpertChange,
  declineExpertChange,
  latestExpertChange,
  pendingExpertChange,
  requestExpertChange,
} from "./expert-change";
import { createExpert, deleteExpert, setExpertOnline } from "./experts";
import { createLead } from "./leads";

let db: Db;
let maria: number;
let olga: number;
let elena: number;
let chat: Conversation;

async function expert(name: string, login: string) {
  const res = await createExpert(db, { name, login, password: "пароль-эксперта" });
  if (!res.ok) throw new Error(res.error);
  await setExpertOnline(db, res.id, true, new Date());
  return res.id;
}

beforeEach(async () => {
  db = await createTestDb();
  maria = await expert("Мария", "maria");
  olga = await expert("Ольга", "olga");
  elena = await expert("Елена", "elena");
  const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, new Date(), null);
  const c = await startConversation(db, lead, maria, new Date());
  if (!c.ok) throw new Error(c.error);
  chat = c.conversation;
});

describe("смена эксперта по заявке", () => {
  it("заявка → отметка у сотрудников → перевод: у клиента второй чат, новый эксперт здоровается", async () => {
    expect(await requestExpertChange(db, chat, olga, new Date())).toEqual({ ok: true });
    expect((await inbox(db))[0]?.expertChangeRequested).toBe(true);
    const pending = await pendingExpertChange(db, chat.id);
    expect(pending).toMatchObject({ toExpertId: olga, toName: "Ольга" });

    expect(await approveExpertChange(db, pending!.id, new Date())).toEqual({ ok: true });
    // Старый чат остался у Марии, в нём — сообщение о переводе (от эксперта чата)
    const old = (await leadConversation(db, chat.leadId, chat.id))!;
    expect(old.expertId).toBe(maria);
    const oldMsgs = await messageViews(db, old, 0, "client");
    expect(oldMsgs.at(-1)).toMatchObject({ author: "expert", authorName: "Мария" });
    expect(oldMsgs.at(-1)?.body).toContain("Ольга");

    // Новый чат с Ольгой — теперь текущий, Ольга здоровается
    const current = (await conversationForLead(db, chat.leadId))!;
    expect(current.id).not.toBe(chat.id);
    expect(current.expertId).toBe(olga);
    expect(current.fullTextSentAt).not.toBeNull();
    const [hello] = await messageViews(db, current, 0, "client");
    expect(hello).toMatchObject({ author: "expert", expertId: olga, authorName: "Ольга" });
    expect(hello?.body).toContain("Анна, здравствуйте");

    const chats = await clientChats(db, chat.leadId);
    expect(chats.map((c) => c.expertName).sort()).toEqual(["Мария", "Ольга"]);
    expect((await inbox(db)).some((i) => i.expertChangeRequested)).toBe(false);
    expect(await latestExpertChange(db, chat.id)).toMatchObject({ status: "approved", fromExpertId: maria });
    // Повторно ту же заявку не провести; к Ольге второй раз — уже есть чат
    expect(await approveExpertChange(db, pending!.id, new Date())).toMatchObject({ ok: false });
    expect(await requestExpertChange(db, current, maria, new Date())).toMatchObject({ ok: false });
  });

  it("повторная заявка меняет эксперта в открытой, а не создаёт вторую", async () => {
    await requestExpertChange(db, chat, olga, new Date());
    await requestExpertChange(db, chat, elena, new Date());
    expect(await pendingExpertChange(db, chat.id)).toMatchObject({ toExpertId: elena });
  });

  it("отклонение: чат у прежнего эксперта, можно попросить снова", async () => {
    await requestExpertChange(db, chat, olga, new Date());
    const p = await pendingExpertChange(db, chat.id);
    expect(await declineExpertChange(db, p!.id, new Date())).toEqual({ ok: true });
    expect((await conversationForLead(db, chat.leadId))?.expertId).toBe(maria);
    expect(await latestExpertChange(db, chat.id)).toMatchObject({ status: "declined" });
    expect(await pendingExpertChange(db, chat.id)).toBeNull();
    expect(await requestExpertChange(db, chat, olga, new Date(Date.now() + 1000))).toEqual({ ok: true });
    expect(await latestExpertChange(db, chat.id)).toMatchObject({ status: "pending", toExpertId: olga });
  });

  it("нельзя попросить своего эксперта, удалённого или несуществующего", async () => {
    expect(await requestExpertChange(db, chat, maria, new Date())).toMatchObject({ ok: false });
    await deleteExpert(db, elena, new Date());
    expect(await requestExpertChange(db, chat, elena, new Date())).toMatchObject({ ok: false });
    expect(await requestExpertChange(db, chat, 999_999, new Date())).toMatchObject({ ok: false });
    expect(await pendingExpertChange(db, chat.id)).toBeNull();
  });
});
