import { createTestDb } from "@/db";
import type { Db } from "@/db";
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
import { createLead } from "./leads";
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
  it("второй чат самому не начать — возвращается текущий", async () => {
    const lead = await newLead();
    const a = await startConversation(db, lead, maria, new Date());
    const b = await startConversation(db, lead, olga, new Date());
    if (!a.ok || !b.ok) throw new Error("не открылся чат");
    expect(b.conversation.id).toBe(a.conversation.id);
    expect(b.conversation.expertId).toBe(maria);
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
