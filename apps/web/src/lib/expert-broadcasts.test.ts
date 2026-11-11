import { eq } from "drizzle-orm";
import type { Mock } from "vitest";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { broadcasts, chatMedia, conversations, messages } from "@/db/schema";
import { clearCardCache } from "./bot-delivery";
import { remindUnread } from "./bot-chores";
import { messageViews, startConversation } from "./chat";
import { chatTargets, expertBroadcastTargets, startExpertBroadcast, testExpertBroadcast, withName } from "./expert-broadcasts";
import { createExpert, setExpertArchived, setExpertOnline } from "./experts";
import { createLead } from "./leads";

const TOKEN = "123456789:AAHtestTOKENtestTOKENtestTOKENtest12";
const realFetch = globalThis.fetch;
let db: Db;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
let nextId = 100;
let n = 0;

beforeEach(async () => {
  db = await createTestDb();
  clearCardCache();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
  vi.stubEnv("SITE_DOMAIN", "example.com");
  fetchMock = vi.fn(async (url: string) => {
    const method = String(url).split("/").pop();
    const id = ++nextId;
    const result =
      method === "sendPhoto"
        ? { message_id: id, photo: [{ file_id: "small" }, { file_id: `photo-${id}` }] }
        : method === "sendVideo"
          ? { message_id: id, video: { file_id: `video-${id}` } }
          : method === "sendMessage"
            ? { message_id: id }
            : true;
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  });
  vi.stubGlobal("fetch", (url: unknown, init?: RequestInit) =>
    String(url).startsWith("https://api.telegram.org/") ? fetchMock(String(url), init) : realFetch(url as string, init),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function expert(name = "Мария | Таролог") {
  const e = await createExpert(db, { name, login: `maria-${++n}`, password: "пароль-эксперта" });
  if (!e.ok) throw new Error(e.error);
  await setExpertOnline(db, e.id, true, new Date());
  return e.id;
}

async function chat(tg: number | null, expertId: number, name = "Анна Петрова") {
  const lead = await createLead(db, { name, birthDate: "1990-03-15" }, new Date(), null, tg);
  const res = await startConversation(db, lead, expertId, new Date());
  if (!res.ok) throw new Error(res.error);
  return { lead, c: res.conversation };
}

/** Вызовы Bot API к получателю: метод и поля (файл в multipart — «<file>»). */
const calls = () =>
  fetchMock.mock.calls
    .filter(([url]) => /\/send(Message|Photo|Video)$/.test(String(url)))
    .map(([url, init]) => {
      const raw = init?.body;
      let body: Record<string, unknown> = {};
      if (raw instanceof FormData) for (const [k, v] of raw.entries()) body[k] = typeof v === "string" ? v : "<file>";
      else body = JSON.parse(String(raw)) as Record<string, unknown>;
      return { method: String(url).split("/").pop(), body };
    });

/** Фоновая рассылка закончилась. */
async function finished(id: number) {
  for (let i = 0; i < 200; i++) {
    const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
    if (b?.finishedAt) return b;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("рассылка не закончилась");
}

describe("рассылка от экспертов", () => {
  it("кому: самый свежий чат человека, с выбранным экспертом; эксперт в архиве и люди без чата — нет", async () => {
    const maria = await expert();
    const olga = await expert("Ольга | Астролог");
    const archived = await expert("Вера | Руны");
    const a1 = await chat(5001, maria);
    const a2 = await chat(5001, olga);
    await db.update(conversations).set({ lastMessageAt: new Date(Date.now() + 60_000) }).where(eq(conversations.id, a2.c.id));
    const b = await chat(5002, maria, "Борис");
    await chat(5003, archived, "Ира");
    await setExpertArchived(db, archived, true, new Date());
    // Подключил Telegram, но чата нет
    await createLead(db, { name: "Без чата", birthDate: "1991-01-01" }, new Date(), null, 5004);

    expect(await chatTargets(db, [5001, 5002, 5003, 5004])).toEqual([
      { telegramUserId: 5001, conversationId: a2.c.id, expertId: olga, name: "Анна Петрова" },
      { telegramUserId: 5002, conversationId: b.c.id, expertId: maria, name: "Борис" },
    ]);
    // Клиентам Марии: у Анны берём чат с Марией, хоть он и не самый свежий
    expect((await expertBroadcastTargets(db, { audience: "all", expertId: maria })).map((t) => t.conversationId)).toEqual([a1.c.id, b.c.id]);
    expect(withName("{имя}, здравствуйте! {Имя}", "Анна Петрова")).toBe("Анна, здравствуйте! Анна");
  });

  it("серия в чаты от эксперта чата и в Telegram: файл хранится и грузится один раз, сотрудники видят «рассылка»", async () => {
    const maria = await expert();
    const olga = await expert("Ольга | Астролог");
    const anna = await chat(6001, maria);
    const boris = await chat(6002, olga, "Борис");
    const photo = { kind: "photo" as const, data: Buffer.from("png"), name: "a.png", type: "image/png" };
    const video = { kind: "video" as const, data: Buffer.from("mp4"), name: "v.mp4", type: "video/mp4" };
    fetchMock.mockClear();

    const { id, total } = await startExpertBroadcast(db, {
      audience: "all",
      messages: [{ body: "{имя}, добрый день!" }, { body: "", media: photo }, { body: "Смотрите видео", media: video }],
    });
    expect(total).toBe(2);
    const b = await finished(id);
    expect(b).toMatchObject({ kind: "chat", sent: 2, failed: 0, total: 2 });
    expect(b.parts).toEqual([
      { body: "{имя}, добрый день!", media: null },
      { body: "", media: { kind: "photo", name: "a.png", size: 3 } },
      { body: "Смотрите видео", media: { kind: "video", name: "v.mp4", size: 3 } },
    ]);

    // Файлы — по одному разу на всю рассылку
    const media = await db.select().from(chatMedia);
    expect(media).toHaveLength(2);
    expect(media.find((m) => m.kind === "photo")!.tgFileId).toMatch(/^photo-/);

    // В чатах — от эксперта своего чата, с именем, помечены и не считаются живым ответом
    const inAnna = (await db.select().from(messages).where(eq(messages.conversationId, anna.c.id))).filter((m) => m.broadcastId === id);
    expect(inAnna.map((m) => [m.author, m.expertId, m.body, m.automatic])).toEqual([
      ["expert", maria, "Анна, добрый день!", true],
      ["expert", maria, "", true],
      ["expert", maria, "Смотрите видео", true],
    ]);
    const inBoris = (await db.select().from(messages).where(eq(messages.conversationId, boris.c.id))).filter((m) => m.broadcastId === id);
    expect(inBoris[0]).toMatchObject({ expertId: olga, body: "Борис, добрый день!" });
    expect(inBoris[1]!.mediaId).toBe(inAnna[1]!.mediaId);

    const staff = (await messageViews(db, anna.c, 0, "staff")).filter((v) => v.broadcast);
    expect(staff).toHaveLength(3);
    expect(staff[0]!.authorName).toBe("Мария | Таролог · рассылка");
    expect(staff[1]!.photo).toBe(`/api/chat/media/${inAnna[1]!.mediaId}`);
    expect(staff[2]!.video).toBe(`/api/chat/media/${inAnna[2]!.mediaId}`);
    const client = await messageViews(db, anna.c, 0, "client");
    expect(client.some((v) => v.broadcast)).toBe(false);
    expect(client.at(-1)!.video).toBe(`/api/chat/media/${inAnna[2]!.mediaId}`);

    // Telegram: первому файлы загружаются, второму — по file_id (sendPhoto — ещё и плашки экспертов)
    const sent = calls();
    const videos = sent.filter((c) => c.method === "sendVideo");
    expect(videos.map((c) => [String(c.body.chat_id), c.body.video])).toEqual([
      ["6001", "<file>"],
      ["6002", media.find((m) => m.kind === "video")!.tgFileId],
    ]);
    const photoId = media.find((m) => m.kind === "photo")!.tgFileId;
    const byFileId = sent.filter((c) => c.method === "sendPhoto" && c.body.photo === photoId).map((c) => String(c.body.chat_id));
    expect(byFileId).toEqual(["6002"]);
    expect(sent.some((c) => String(c.body.caption ?? c.body.text ?? "").includes("Анна, добрый день!"))).toBe(true);

    // Через сутки о непрочитанной рассылке бот не напоминает
    expect(await remindUnread(db, new Date(Date.now() + 25 * 60 * 60 * 1000))).toBe(0);
  });

  it("проба — в свой чат; нет чата с выбранным экспертом — так и говорим", async () => {
    const maria = await expert();
    const olga = await expert("Ольга | Астролог");
    const own = await chat(7001, maria, "Владелец");
    const input = { audience: "all" as const, messages: [{ body: "Проба {имя}" }] };
    expect(await testExpertBroadcast(db, 7001, input)).toBe("ok");
    const [m] = (await db.select().from(messages).where(eq(messages.conversationId, own.c.id))).filter((x) => x.body === "Проба Владелец");
    expect(m).toMatchObject({ author: "expert", broadcastId: null, automatic: true });
    expect(await testExpertBroadcast(db, 7001, { ...input, expertId: olga })).toBe("no-chat");
    expect(await db.select().from(broadcasts)).toHaveLength(0);
  });
});
