import { createTestDb } from "@/db";
import { createLead } from "./leads";
import { compatScores, compatView, runCompat } from "./quiz-compat";
import { runYesNo, yesNoView } from "./quiz-yesno";

const morning = new Date("2026-11-05T08:00:00Z");

describe("квизы с ИИ", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("совместимость — Opus 5.5 по схеме, с посчитанными процентами; «Да или нет» — ИИ отмечает деликатный вопрос", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const bodies: Record<string, unknown>[] = [];
    let reply: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const message = {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(reply) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      };
      return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
    });

    const db = await createTestDb();
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null);
    reply = { summary: "Рыбы и Рак — тёплая пара.", feelings: "Чувства глубокие.", life: "Быт складывается.", passion: "Искра есть.", teaser: "Что сближает вас сильнее всего?" };
    const row = await runCompat(db, lead, { partnerName: "Иван", partnerBirth: "1988-07-02" }, morning);
    if ("error" in row) throw new Error(row.error);
    expect(row.model).toBe("claude-opus-5-5");
    expect(compatView(row, lead.birthDate, true)!.result!.text).toEqual(reply);
    const s = compatScores(lead.birthDate, "1988-07-02");
    expect(bodies[0]).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { format: { type: "json_schema" } } });
    const prompt = JSON.stringify(bodies[0]!.messages);
    expect(prompt).toContain(`общая ${s.total}%`);
    expect(prompt).toContain("02.07.1988");

    // Слова не поймали, а ИИ отметил вопрос как деликатный — без «да» и «нет»
    reply = { sensitive: true, text: "На такой вопрос лучше спросить специалиста.", advice: "Поговорите с близким.", teaser: "Что поможет вам сейчас?" };
    const yn = await runYesNo(db, lead, "Всё ли будет хорошо с мамой?", morning);
    if ("error" in yn) throw new Error(yn.error);
    expect(yesNoView(yn, true)!.result).toMatchObject({ answer: null, text: "На такой вопрос лучше спросить специалиста." });

    // Слова поймали, а ИИ ответил как на обычный — его текст не берём
    reply = { sensitive: false, text: "Да, всё получится!", advice: "Верьте.", teaser: "?" };
    const yn2 = await runYesNo(db, lead, "Я выздоровею после операции?", morning);
    if ("error" in yn2) throw new Error(yn2.error);
    const v2 = yesNoView(yn2, true)!.result!;
    expect(v2.answer).toBeNull();
    expect(v2.text).not.toContain("Да, всё получится");
    expect(yn2.model).toBeNull();
  });
});
