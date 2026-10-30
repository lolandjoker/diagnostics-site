import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { messageViews, postMessage, startConversation } from "./chat";
import { createExpert, setExpertOnline, verifyPassword } from "./experts";
import { createLead } from "./leads";
import {
  createOperator,
  createOperatorToken,
  deleteOperator,
  getOperatorWithSecret,
  listOperators,
  setOperatorPassword,
  tokenOperatorId,
  verifyOperatorToken,
} from "./operators";

let db: Db;
const SECRET = "s".repeat(40);

beforeEach(async () => {
  db = await createTestDb();
});

describe("операторы чатов", () => {
  it("заводятся с проверкой имени, логина и пароля; логин не повторяется", async () => {
    expect(await createOperator(db, { name: "", login: "ira", password: "пароль-оператора" })).toMatchObject({ ok: false });
    expect(await createOperator(db, { name: "Ира", login: "и", password: "пароль-оператора" })).toMatchObject({ ok: false });
    expect(await createOperator(db, { name: "Ира", login: "ira", password: "коротко" })).toMatchObject({ ok: false });
    const ok = await createOperator(db, { name: " Ира ", login: " IRA ", password: "пароль-оператора" });
    expect(ok.ok).toBe(true);
    expect(await createOperator(db, { name: "Ира 2", login: "ira", password: "пароль-оператора" })).toMatchObject({
      ok: false,
      error: "Такой логин уже есть",
    });
    const o = (await getOperatorWithSecret(db, { login: "ira" }))!;
    expect(o.name).toBe("Ира");
    expect(await verifyPassword("пароль-оператора", o.passwordHash)).toBe(true);
  });

  it("сессия: подпись, срок; смена пароля завершает вход; удалённого нет", async () => {
    const res = await createOperator(db, { name: "Ира", login: "ira", password: "пароль-оператора" });
    if (!res.ok) throw new Error(res.error);
    const o = (await getOperatorWithSecret(db, { id: res.id }))!;
    const now = Date.now();
    const token = createOperatorToken(o, now, SECRET);
    expect(tokenOperatorId(token)).toBe(o.id);
    expect(verifyOperatorToken(token, o, now, SECRET)).toBe(true);
    expect(verifyOperatorToken(token, o, now + 15 * 86_400_000, SECRET)).toBe(false);
    expect(verifyOperatorToken(token, o, now, "x".repeat(40))).toBe(false);

    await setOperatorPassword(db, o.id, "новый-пароль-оператора");
    const changed = (await getOperatorWithSecret(db, { id: o.id }))!;
    expect(verifyOperatorToken(token, changed, now, SECRET)).toBe(false);

    await deleteOperator(db, o.id, new Date());
    expect(await getOperatorWithSecret(db, { id: o.id })).toBeNull();
    expect(await listOperators(db)).toEqual([]);
  });

  it("сообщение оператора: клиент видит эксперта чата, сотрудники — «Оператор: имя»", async () => {
    const e = await createExpert(db, { name: "Мария", login: "maria", password: "пароль-эксперта" });
    if (!e.ok) throw new Error(e.error);
    await setExpertOnline(db, e.id, true, new Date());
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, new Date(), null);
    const chat = await startConversation(db, lead, e.id, new Date());
    if (!chat.ok) throw new Error(chat.error);
    const op = await createOperator(db, { name: "Ира", login: "ira", password: "пароль-оператора" });
    if (!op.ok) throw new Error(op.error);

    await postMessage(db, chat.conversation.id, { author: "admin", operatorId: op.id, body: "Здравствуйте!" });
    await postMessage(db, chat.conversation.id, { author: "admin", body: "Это админ" });

    const staff = await messageViews(db, chat.conversation, 0, "staff");
    expect(staff.map((m) => [m.authorName, m.operatorId])).toEqual([
      ["Оператор: Ира", op.id],
      ["Администратор", null],
    ]);
    const client = await messageViews(db, chat.conversation, 0, "client");
    expect(client.map((m) => [m.author, m.authorName, m.operatorId])).toEqual([
      ["expert", "Мария", null],
      ["expert", "Мария", null],
    ]);
  });
});
