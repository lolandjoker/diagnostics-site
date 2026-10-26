import { createHmac } from "node:crypto";
import { createTestDb } from "@/db";
import type { Db } from "@/db";
import {
  RING_TIMEOUT_MS,
  SEEN_TIMEOUT_MS,
  addSignal,
  answerCall,
  hangupCall,
  iceServers,
  pollCall,
  requestCall,
  startCall,
} from "./calls";
import { inbox, messageViews, startConversation } from "./chat";
import type { Conversation } from "./chat";
import { createExpert, setExpertOnline } from "./experts";
import { createLead } from "./leads";

let db: Db;
let conv: Conversation;
let expertId: number;
const T0 = new Date("2026-10-25T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(async () => {
  db = await createTestDb();
  const res = await createExpert(db, { name: "Мария", login: "maria", password: "пароль-эксперта" });
  if (!res.ok) throw new Error(res.error);
  expertId = res.id;
  await setExpertOnline(db, expertId, true, new Date());
  const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, new Date(), null);
  const c = await startConversation(db, lead, expertId, new Date());
  if (!c.ok) throw new Error(c.error);
  conv = c.conversation;
});

const lastMessage = async () => (await messageViews(db, conv, 0, "client")).at(-1);

describe("звонки", () => {
  it("звонок от начала до конца: вызов → ответ → обмен описаниями → итог в чате", async () => {
    const started = await startCall(db, conv, { caller: "expert", expertId }, T0);
    if (!started.ok) throw new Error(started.error);
    const id = started.call.id;

    // Клиент видит входящий звонок без номера звонка в запросе
    const incoming = await pollCall(db, conv, "client", { after: 0 }, at(1000));
    expect(incoming.call).toMatchObject({ id, status: "ringing" });

    expect(await answerCall(db, conv, id, true, at(5000))).toMatchObject({ ok: true, call: { status: "active" } });
    expect(await addSignal(db, conv, id, "staff", "v=0 offer")).toMatchObject({ ok: true });

    const forClient = await pollCall(db, conv, "client", { callId: id, after: 0 }, at(6000));
    expect(forClient.signals).toEqual([expect.objectContaining({ kind: "offer", sdp: "v=0 offer" })]);
    await addSignal(db, conv, id, "client", "v=0 answer");
    const forStaff = await pollCall(db, conv, "staff", { callId: id, after: 0 }, at(7000));
    // Сотрудник получает только ответ клиента, свой offer — нет
    expect(forStaff.signals.map((s) => s.kind)).toEqual(["answer"]);
    expect((await pollCall(db, conv, "staff", { callId: id, after: forStaff.signals[0]!.id }, at(7500))).signals).toEqual([]);

    await hangupCall(db, conv, id, at(5000 + 192_000));
    expect((await pollCall(db, conv, "client", { callId: id, after: 0 }, at(200_000))).call?.status).toBe("ended");
    expect(await lastMessage()).toMatchObject({ author: "expert", authorName: "Мария", body: "📞 Звонок · 3:12" });
    // Повторное «положить трубку» не пишет итог второй раз
    await hangupCall(db, conv, id, at(300_000));
    expect((await messageViews(db, conv, 0, "client")).filter((m) => m.body.startsWith("📞"))).toHaveLength(1);
  });

  it("в чате одновременно только один звонок", async () => {
    expect(await startCall(db, conv, { caller: "admin" }, T0)).toMatchObject({ ok: true });
    expect(await startCall(db, conv, { caller: "expert", expertId }, at(1000))).toMatchObject({ ok: false });
  });

  it("не ответили — пропущенный; звонок админа клиент видит от эксперта чата", async () => {
    const s = await startCall(db, conv, { caller: "admin" }, T0);
    if (!s.ok) throw new Error(s.error);
    // Сотрудник ждёт и опрашивает — клиент не отвечает
    for (let t = 5000; t <= RING_TIMEOUT_MS; t += 5000) await pollCall(db, conv, "staff", { callId: s.call.id, after: 0 }, at(t));
    const poll = await pollCall(db, conv, "staff", { callId: s.call.id, after: 0 }, at(RING_TIMEOUT_MS + 1000));
    expect(poll.call?.status).toBe("missed");
    expect(poll.iceServers).toEqual([]);
    expect(await lastMessage()).toMatchObject({ author: "expert", authorName: "Мария", body: "📞 Пропущенный звонок" });
    expect(await answerCall(db, conv, s.call.id, true, at(RING_TIMEOUT_MS + 2000))).toMatchObject({ ok: false });
    // После пропущенного можно звонить снова
    expect(await startCall(db, conv, { caller: "admin" }, at(RING_TIMEOUT_MS + 3000))).toMatchObject({ ok: true });
  });

  it("клиент отклонил звонок", async () => {
    const s = await startCall(db, conv, { caller: "expert", expertId }, T0);
    if (!s.ok) throw new Error(s.error);
    expect(await answerCall(db, conv, s.call.id, false, at(3000))).toMatchObject({ ok: true, call: { status: "declined" } });
    expect(await lastMessage()).toMatchObject({ body: "📞 Звонок отклонён" });
    expect(await addSignal(db, conv, s.call.id, "staff", "v=0")).toMatchObject({ ok: false });
  });

  it("сторона пропала во время разговора — звонок завершается", async () => {
    const s = await startCall(db, conv, { caller: "expert", expertId }, T0);
    if (!s.ok) throw new Error(s.error);
    await answerCall(db, conv, s.call.id, true, at(2000));
    // Сотрудник продолжает опрашивать, клиент закрыл вкладку
    for (let t = 4000; t <= 2000 + SEEN_TIMEOUT_MS; t += 4000) {
      expect((await pollCall(db, conv, "staff", { callId: s.call.id, after: 0 }, at(t))).call?.status).toBe("active");
    }
    const poll = await pollCall(db, conv, "staff", { callId: s.call.id, after: 0 }, at(2000 + SEEN_TIMEOUT_MS + 5000));
    expect(poll.call?.status).toBe("ended");
  });

  it("клиент просит позвонить: отметка у сотрудников, сообщение не чаще раза в 10 минут, звонок её снимает", async () => {
    expect(await requestCall(db, conv, T0)).toEqual({ ok: true });
    await requestCall(db, conv, at(60_000));
    const asks = (await messageViews(db, conv, 0, "staff")).filter((m) => m.body === "📞 Прошу позвонить мне");
    expect(asks).toHaveLength(1);
    expect((await inbox(db))[0]?.callRequested).toBe(true);
    expect((await pollCall(db, conv, "client", { after: 0 }, at(61_000))).callRequested).toBe(true);

    await startCall(db, conv, { caller: "expert", expertId }, at(120_000));
    expect((await inbox(db))[0]?.callRequested).toBe(false);
  });

  it("сигнал проверяется: пустой или огромный не принимается, чужой звонок не найден", async () => {
    const s = await startCall(db, conv, { caller: "expert", expertId }, T0);
    if (!s.ok) throw new Error(s.error);
    expect(await addSignal(db, conv, s.call.id, "staff", "")).toMatchObject({ ok: false });
    expect(await addSignal(db, conv, s.call.id, "staff", "x".repeat(20_001))).toMatchObject({ ok: false });
    expect(await addSignal(db, conv, "00000000-0000-0000-0000-000000000000", "staff", "v=0")).toMatchObject({ ok: false });
  });
});

describe("пароли к TURN", () => {
  it("временный пароль по схеме TURN REST: HMAC-SHA1 от «срок:метка» общим секретом", () => {
    const servers = iceServers("call-1", T0, { TURN_SECRET: "s3cret", SITE_DOMAIN: "example.ru" });
    expect(servers[0]).toEqual({ urls: ["stun:example.ru:3478"] });
    const turn = servers[1]!;
    expect(turn.urls).toEqual(["turn:example.ru:3478?transport=udp", "turn:example.ru:3478?transport=tcp"]);
    const [expiry, label] = turn.username!.split(":");
    expect(label).toBe("call-1");
    expect(Number(expiry)).toBe(T0.getTime() / 1000 + 4 * 3600);
    expect(turn.credential).toBe(createHmac("sha1", "s3cret").update(turn.username!).digest("base64"));
  });

  it("без секрета — без TURN (разработка)", () => {
    expect(iceServers("call-1", T0, {})).toEqual([]);
  });
});
