import { eq } from "drizzle-orm";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { addCertificate, deleteCertificate, getCertificate, listCertificates } from "./certificates";
import {
  FULL_TEXT_DELAY_MS,
  FULL_TEXT_TYPING_MS,
  clientChats,
  conversationForLead,
  fullTextTyping,
  leadConversation,
  markClientRead,
  postMessage,
  startConversation,
} from "./chat";
import { createExpert, expertTags, setExpertOnline } from "./experts";
import { MAX_LEAD_EDITS, createLead, editLead } from "./leads";
import { TYPING_TTL_MS, clearTyping, isTyping, setTyping } from "./typing";

let db: Db;
let maria: number;
let olga: number;

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
});

const newLead = (name = "Анна") => createLead(db, { name, birthDate: "1990-03-15" }, new Date(), null);

describe("переписки клиента", () => {
  it("написать можно любому эксперту: у каждого свой чат, разбор — только в первом", async () => {
    const lead = await newLead();
    const a = await startConversation(db, lead, maria, new Date());
    // Второй эксперт не в сети — написать ему всё равно можно
    await setExpertOnline(db, olga, false, new Date());
    const b = await startConversation(db, lead, olga, new Date());
    if (!a.ok || !b.ok) throw new Error("не открылся чат");
    expect(b.conversation.id).not.toBe(a.conversation.id);
    expect(b.conversation.expertId).toBe(olga);
    expect(a.conversation.fullTextSentAt).toBeNull();
    expect(b.conversation.fullTextSentAt).not.toBeNull();
    expect((await clientChats(db, lead.id)).map((c) => c.expertId).sort()).toEqual([maria, olga].sort());

    // К тому же эксперту — тот же чат
    const again = await startConversation(db, lead, maria, new Date());
    expect(again.ok && again.conversation.id).toBe(a.conversation.id);

    // За клиента ничего не пишем — чаты открываются пустыми (в чате — подсказки-вопросы)
    const count = async (id: string) => (await db.select().from(messages).where(eq(messages.conversationId, id))).length;
    expect(await count(a.conversation.id)).toBe(0);
    expect(await count(b.conversation.id)).toBe(0);
  });

  it("имя и дату можно изменить MAX_LEAD_EDITS раза; подробный разбор второй раз не приходит", async () => {
    const lead = await newLead();
    const started = await startConversation(db, lead, maria, new Date());
    if (!started.ok) throw new Error(started.error);
    await db.update(conversations).set({ fullTextSentAt: new Date() }).where(eq(conversations.id, started.conversation.id));
    for (let i = 1; i <= MAX_LEAD_EDITS; i++) {
      expect(await editLead(db, lead.id, { name: ` Анна ${i} `, birthDate: "1991-04-16" })).toMatchObject({
        name: `Анна ${i}`,
        birthDate: "1991-04-16",
        edits: i,
        variationId: lead.variationId,
      });
    }
    expect(await editLead(db, lead.id, { name: "Ещё", birthDate: "1991-04-16" })).toBeNull();
    expect(await editLead(db, "не-id", { name: "Ещё", birthDate: "1991-04-16" })).toBeNull();
    const [c] = await clientChats(db, lead.id);
    expect(c?.id).toBe(started.conversation.id);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, started.conversation.id));
    expect(conv?.fullTextSentAt).not.toBeNull();
  });

  it("первый чат — только с экспертом в сети", async () => {
    await setExpertOnline(db, olga, false, new Date());
    expect(await startConversation(db, await newLead(), olga, new Date())).toMatchObject({ ok: false });
  });

  it("чат открывается только своей заявкой; список чатов с непрочитанными", async () => {
    const lead = await newLead();
    const other = await newLead("Олег");
    const started = await startConversation(db, lead, maria, new Date());
    if (!started.ok) throw new Error(started.error);
    const c = started.conversation;
    expect(await leadConversation(db, other.id, c.id)).toBeNull();
    expect(await leadConversation(db, lead.id, "не-id")).toBeNull();
    expect((await leadConversation(db, lead.id, null))?.id).toBe(c.id);

    await postMessage(db, c.id, { author: "expert", expertId: maria, body: "Здравствуйте!" });
    await postMessage(db, c.id, { author: "admin", body: "Я на связи" });
    let [item] = await clientChats(db, lead.id);
    expect(item).toMatchObject({ id: c.id, expertName: "Мария", unread: 2, lastMessage: "Я на связи" });

    await markClientRead(db, c.id, new Date(Date.now() + 1000));
    await postMessage(db, c.id, { author: "client", body: "Спасибо" });
    [item] = await clientChats(db, lead.id);
    expect(item?.unread).toBe(0);
    expect(await clientChats(db, other.id)).toEqual([]);
    expect((await conversationForLead(db, lead.id))?.id).toBe(c.id);
  });
});

describe("«печатает…»", () => {
  it("держится TYPING_TTL_MS, гаснет после отправки; стороны независимы", () => {
    const t0 = new Date("2026-10-27T10:00:00Z");
    setTyping("chat-1", "client", t0);
    expect(isTyping("chat-1", "client", new Date(t0.getTime() + TYPING_TTL_MS - 1))).toBe(true);
    expect(isTyping("chat-1", "client", new Date(t0.getTime() + TYPING_TTL_MS + 1))).toBe(false);
    expect(isTyping("chat-1", "staff", t0)).toBe(false);
    expect(isTyping("chat-2", "client", t0)).toBe(false);
    clearTyping("chat-1", "client");
    expect(isTyping("chat-1", "client", t0)).toBe(false);
  });

  it("перед подробным разбором — имитация набора за FULL_TEXT_TYPING_MS", () => {
    const createdAt = new Date("2026-10-27T10:00:00Z");
    const due = createdAt.getTime() + FULL_TEXT_DELAY_MS;
    const c = { createdAt, fullTextSentAt: null };
    expect(fullTextTyping(c, new Date(due - FULL_TEXT_TYPING_MS - 1000))).toBe(false);
    expect(fullTextTyping(c, new Date(due - FULL_TEXT_TYPING_MS + 1000))).toBe(true);
    expect(fullTextTyping({ createdAt, fullTextSentAt: new Date(due) }, new Date(due + 1000))).toBe(false);
  });
});

describe("профиль эксперта", () => {
  it("сертификаты: только картинки до 5 МБ, удаляются только у своего эксперта", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    expect(await addCertificate(db, maria, " Диплом ", png)).toBeNull();
    expect(await addCertificate(db, maria, "", Buffer.from("не картинка"))).toMatch("JPEG");
    expect(await addCertificate(db, maria, "", Buffer.alloc(0))).not.toBeNull();
    const [cert] = await listCertificates(db, maria);
    expect(cert).toMatchObject({ title: "Диплом", url: `/experts/${maria}/certificates/${cert!.id}` });
    expect((await getCertificate(db, maria, cert!.id))?.mime).toBe("image/png");
    expect(await getCertificate(db, olga, cert!.id)).toBeNull();

    await deleteCertificate(db, olga, cert!.id);
    expect(await listCertificates(db, maria)).toHaveLength(1);
    await deleteCertificate(db, maria, cert!.id);
    expect(await listCertificates(db, maria)).toHaveLength(0);
  });

  it("теги: без пустых и повторов, не больше 8", () => {
    expect(expertTags(" Таро, Астрология,, таро ,Нумерология ")).toEqual(["Таро", "Астрология", "Нумерология"]);
    expect(expertTags("")).toEqual([]);
    expect(expertTags("1,2,3,4,5,6,7,8,9,10")).toHaveLength(8);
  });
});
