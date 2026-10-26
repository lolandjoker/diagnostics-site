import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { diagnosticBlocks, priceVariants, products } from "@/db/schema";
import { buildDiagnostic, getMethod, METHODS, saveBlockTexts } from "./diagnostic";
import { ageOn, createLead, validateLead } from "./leads";
import type { MailMessage } from "./mail";
import { formatRub, offerForLead, offersForLead, parseRub, variantStats } from "./offers";
import { cancelOrder, createOrder, getOrderWithProduct, markPaid } from "./orders";
import { fillTemplate, getTexts, saveTexts } from "./texts";

const NOW = new Date("2026-10-23T10:00:00Z");
const birth = { day: 15, month: 3, year: 1990 };
const input = { birth, name: "Анна", year: 2026 };

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

async function newLead(name = "Анна", birthDate = "1990-03-15") {
  return createLead(db, { name, birthDate }, NOW);
}

async function newProduct(prices: number[], opts: { active?: boolean; title?: string } = {}) {
  const [p] = await db
    .insert(products)
    .values({ title: opts.title ?? "Курс", delivery: "Ссылка на курс: https://example.ru/c", active: opts.active ?? true })
    .returning();
  const variants = [];
  for (const amountKopecks of prices) {
    const [v] = await db.insert(priceVariants).values({ productId: p!.id, amountKopecks }).returning();
    variants.push(v!);
  }
  return { product: p!, variants };
}

describe("тексты", () => {
  it("без правок — тексты по умолчанию, после сохранения — новые", async () => {
    expect((await getTexts(db, ["home.title"]))["home.title"]).toBe("Ваш разбор по дате рождения");
    expect(await saveTexts(db, { "home.title": "Новый заголовок" })).toBeNull();
    expect((await getTexts(db, ["home.title"]))["home.title"]).toBe("Новый заголовок");
    expect(await saveTexts(db, { "home.title": "Ещё раз" })).toBeNull();
    expect((await getTexts(db, ["home.title"]))["home.title"]).toBe("Ещё раз");
  });

  it("ссылки — только https, пустая ссылка допустима", async () => {
    expect(await saveTexts(db, { "links.telegram": "javascript:alert(1)" })).toMatch("https://");
    expect(await saveTexts(db, { "links.telegram": "http://t.me/x" })).toMatch("https://");
    expect(await saveTexts(db, { "links.telegram": "https://t.me/x" })).toBeNull();
    expect(await saveTexts(db, { "links.telegram": "" })).toBeNull();
  });

  it("подстановки", () => {
    expect(fillTemplate("{name}, ваш разбор: {x}", { name: "Анна" })).toBe("Анна, ваш разбор: {x}");
  });
});

describe("способы расчёта", () => {
  it.each([
    ["life_path", 1],
    ["archetype", 4],
    ["sun_sign", 12], // 15 марта — Рыбы
    ["matrix_a", 15],
    ["matrix_e", 11],
    ["expression", 5],
    ["personal_year", 1],
  ])("%s для 15.03.1990, Анна → %i", (id, expected) => {
    expect(getMethod(id)?.compute(input)).toBe(expected);
  });

  it("имя без русских букв — значение не определено, а не ошибка", () => {
    expect(getMethod("expression")?.compute({ ...input, name: "Anna" })).toBeNull();
  });

  it("каждый расчёт даёт значение из своего списка для всех дат 1940–2008", () => {
    for (let t = Date.UTC(1940, 0, 1); t <= Date.UTC(2008, 11, 31); t += 13 * 86_400_000) {
      const d = new Date(t);
      const b = { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
      for (const m of METHODS) {
        const v = m.compute({ birth: b, name: "Мария", year: 2026 });
        if (v !== null && !m.values.includes(v)) throw new Error(`${m.id}: ${v} нет в списке значений`);
      }
    }
  });
});

describe("разбор", () => {
  it("показывает активные блоки по порядку и пропускает блоки без текста для значения", async () => {
    const [b1, b2, b3, b4] = await db
      .insert(diagnosticBlocks)
      .values([
        { title: "Архетип", method: "archetype", sort: 2 },
        { title: "Путь", method: "life_path", sort: 1 },
        { title: "Нет текста", method: "matrix_a", sort: 3 },
        { title: "Выключен", method: "life_path", sort: 0, active: false },
      ])
      .returning();
    await saveBlockTexts(db, b1!.id, new Map([[4, "Текст архетипа 4"], [5, "не наш"]]));
    await saveBlockTexts(db, b2!.id, new Map([[1, "Текст пути 1"]]));
    await saveBlockTexts(db, b3!.id, new Map([[16, "не наше значение"]]));
    await saveBlockTexts(db, b4!.id, new Map([[1, "скрыт"]]));

    const sections = await buildDiagnostic(db, input);
    expect(sections.map((s) => s.body)).toEqual(["Текст пути 1", "Текст архетипа 4"]);
  });

  it("пустой текст удаляет значение", async () => {
    const [b] = await db.insert(diagnosticBlocks).values({ title: "Путь", method: "life_path" }).returning();
    await saveBlockTexts(db, b!.id, new Map([[1, "Текст"]]));
    await saveBlockTexts(db, b!.id, new Map([[1, "   "]]));
    expect(await buildDiagnostic(db, input)).toEqual([]);
  });
});

describe("заявка", () => {
  const ok = { name: "Анна", birthDate: "1990-03-15" };

  it("принимает верные данные", () => {
    expect(validateLead(ok, NOW)).toBeNull();
  });

  it("отклоняет пустое имя и неверную дату", () => {
    expect(validateLead({ ...ok, name: "  " }, NOW)).toMatch("имя");
    expect(validateLead({ ...ok, birthDate: "1990-02-30" }, NOW)).toMatch("не существует");
    expect(validateLead({ ...ok, birthDate: "" }, NOW)).toMatch("дату");
  });

  it("только с 18 лет: день в день — можно, днём раньше — нельзя", () => {
    expect(ageOn("2008-10-23", NOW)).toBe(18);
    expect(ageOn("2008-10-24", NOW)).toBe(17);
    expect(validateLead({ ...ok, birthDate: "2008-10-23" }, NOW)).toBeNull();
    expect(validateLead({ ...ok, birthDate: "2008-10-24" }, NOW)).toMatch("18");
  });
});

describe("цены", () => {
  it("формат и разбор цены", () => {
    expect(formatRub(295000)).toBe(`2${" "}950 ₽`);
    expect(formatRub(149950)).toBe(`1${" "}499,50 ₽`);
    expect(parseRub("2950")).toBe(295000);
    expect(parseRub("2 950 ₽")).toBe(295000);
    expect(parseRub("1499,5")).toBe(149950);
    expect(parseRub("0")).toBeNull();
    expect(parseRub("-5")).toBeNull();
    expect(parseRub("abc")).toBeNull();
  });

  it("вариант цены выбирается один раз и дальше не меняется", async () => {
    await newProduct([100000, 200000, 300000]);
    const lead = await newLead();
    const first = (await offersForLead(db, lead.id))[0]?.variant.id;
    for (let i = 0; i < 5; i++) {
      expect((await offersForLead(db, lead.id))[0]?.variant.id).toBe(first);
    }
  });

  it("разным людям достаются разные варианты", async () => {
    await newProduct([100000, 200000]);
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const lead = await newLead();
      seen.add((await offersForLead(db, lead.id))[0]!.variant.amountKopecks);
    }
    expect(seen.size).toBe(2);
  });

  it("выключенный продукт и продукт без активных цен не показываются", async () => {
    await newProduct([100000], { active: false, title: "Выключен" });
    const { variants } = await newProduct([100000], { title: "Без цен" });
    await db.update(priceVariants).set({ active: false });
    await newProduct([50000], { title: "Виден" });
    const lead = await newLead();
    expect((await offersForLead(db, lead.id)).map((o) => o.product.title)).toEqual(["Виден"]);
    expect(variants).toHaveLength(1);
  });
});

describe("заказ", () => {
  function fakeMailer() {
    const sent: MailMessage[] = [];
    return { sent, mailer: async (m: MailMessage) => void sent.push(m) };
  }

  it("цена — из показанного человеку варианта, а не из запроса", async () => {
    const { product } = await newProduct([100000, 200000, 300000]);
    const lead = await newLead();
    const shown = await offerForLead(db, lead.id, product.id);
    const res = await createOrder(db, { leadId: lead.id, productId: product.id, email: " Anna@Example.ru " });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.order.amountKopecks).toBe(shown?.variant.amountKopecks);
    expect(res.order.email).toBe("anna@example.ru");
    expect(res.order.status).toBe("pending");
  });

  it("неверная почта и выключенный продукт — понятные ошибки", async () => {
    const { product } = await newProduct([100000]);
    const lead = await newLead();
    expect(await createOrder(db, { leadId: lead.id, productId: product.id, email: "не почта" })).toEqual({
      ok: false,
      error: "Проверьте адрес почты",
    });
    await db.update(products).set({ active: false });
    const res = await createOrder(db, { leadId: lead.id, productId: product.id, email: "a@b.ru" });
    expect(res.ok).toBe(false);
  });

  it("оплата: письмо уходит один раз, повторное подтверждение ничего не делает", async () => {
    const { product } = await newProduct([295000]);
    const lead = await newLead();
    const res = await createOrder(db, { leadId: lead.id, productId: product.id, email: "a@b.ru" });
    if (!res.ok) throw new Error(res.error);
    const { sent, mailer } = fakeMailer();

    expect(await markPaid(db, res.order.id, mailer)).toBe(true);
    expect(await markPaid(db, res.order.id, mailer)).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("a@b.ru");
    expect(sent[0]?.subject).toBe("Ваш заказ: Курс");
    expect(sent[0]?.text).toContain("https://example.ru/c");

    const row = await getOrderWithProduct(db, res.order.id);
    expect(row?.order.status).toBe("paid");
    expect(row?.order.emailSentAt).not.toBeNull();

    const stats = await variantStats(db);
    expect(stats[0]).toMatchObject({ shown: 1, paid: 1, revenueKopecks: 295000, conversion: 1 });
  });

  it("почта не настроена — заказ оплачен, причина записана", async () => {
    const { product } = await newProduct([100000]);
    const lead = await newLead();
    const res = await createOrder(db, { leadId: lead.id, productId: product.id, email: "a@b.ru" });
    if (!res.ok) throw new Error(res.error);
    expect(await markPaid(db, res.order.id, null)).toBe(true);
    const row = await getOrderWithProduct(db, res.order.id);
    expect(row?.order.status).toBe("paid");
    expect(row?.order.emailError).toMatch("SMTP");
  });

  it("отменить можно только неоплаченный заказ", async () => {
    const { product } = await newProduct([100000]);
    const lead = await newLead();
    const a = await createOrder(db, { leadId: lead.id, productId: product.id, email: "a@b.ru" });
    const b = await createOrder(db, { leadId: lead.id, productId: product.id, email: "a@b.ru" });
    if (!a.ok || !b.ok) throw new Error("заказ не создан");
    expect(await cancelOrder(db, a.order.id)).toBe(true);
    await markPaid(db, b.order.id, null);
    expect(await cancelOrder(db, b.order.id)).toBe(false);
    expect(await markPaid(db, a.order.id, null)).toBe(false);
  });
});
