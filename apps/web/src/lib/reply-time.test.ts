import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { messages } from "@/db/schema";
import { startConversation } from "./chat";
import { createExpert, setExpertOnline } from "./experts";
import { createLead } from "./leads";
import { replyTimeLabel, replyTimes } from "./reply-time";

let db: Db;
let expertId: number;

beforeEach(async () => {
  db = await createTestDb();
  const e = await createExpert(db, { name: "Мария", login: "maria", password: "пароль-эксперта" });
  if (!e.ok) throw new Error(e.error);
  expertId = e.id;
  await setExpertOnline(db, expertId, true, new Date());
});

const now = new Date();
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

/** Чат с перепиской: [автор, минут назад]. */
async function chatWith(script: [author: "client" | "expert" | "admin" | "system", minAgo: number][]) {
  const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, new Date(), null);
  const c = await startConversation(db, lead, expertId, new Date());
  if (!c.ok) throw new Error(c.error);
  for (const [author, minAgo] of script) {
    await db.insert(messages).values({
      conversationId: c.conversation.id,
      author,
      expertId: author === "expert" ? expertId : null,
      body: "…",
      createdAt: ago(minAgo),
    });
  }
}

describe("время ответа эксперта", () => {
  it("медиана ожидания: от первого неотвеченного сообщения клиента до ответа; разбор не считается", async () => {
    // Ждали 10 минут (два сообщения клиента подряд — от первого), разбор не ответ
    await chatWith([
      ["client", 100],
      ["client", 95],
      ["system", 93],
      ["expert", 90],
    ]);
    // Ждали 4 и 6 минут, ответ админа тоже ответ
    await chatWith([
      ["client", 60],
      ["expert", 56],
      ["client", 50],
      ["admin", 44],
    ]);
    expect((await replyTimes(db, [expertId], now)).get(expertId)).toBe(360);
    expect(replyTimeLabel(360)).toBe("обычно отвечает за 6 минут");
  });

  it("меньше трёх ответов или давно — не показываем", async () => {
    await chatWith([
      ["client", 30],
      ["expert", 25],
      ["client", 20],
      ["expert", 18],
    ]);
    await chatWith([
      ["client", 60 * 24 * 40],
      ["expert", 60 * 24 * 40 - 5],
    ]);
    expect((await replyTimes(db, [expertId], now)).has(expertId)).toBe(false);
  });

  it("подписи", () => {
    expect(replyTimeLabel(20)).toBe("обычно отвечает меньше чем за минуту");
    expect(replyTimeLabel(60)).toBe("обычно отвечает за 1 минуту");
    expect(replyTimeLabel(3 * 60)).toBe("обычно отвечает за 3 минуты");
    expect(replyTimeLabel(2 * 3600)).toBe("обычно отвечает в течение 2 часов");
    expect(replyTimeLabel(3 * 86_400)).toBe("обычно отвечает в течение суток");
  });
});
