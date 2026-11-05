import { createTestDb } from "@/db";
import { ARCANA } from "./arcana";
import { drawDailyCard } from "./club";
import { createLead } from "./leads";

const morning = new Date("2026-11-05T08:00:00Z");

describe("расшифровка от ИИ", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("с ключом — пишет Opus 5.5 с запасной моделью на случай отказа; отказ — запасной текст карты", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    let refuse = false;
    vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
      requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      const message = {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: refuse
          ? []
          : [
              {
                type: "text",
                text: JSON.stringify({
                  main: "Анна, сегодня Звезда напоминает о надежде.",
                  love: "Доверьтесь близким.",
                  work: "Запишите идеи.",
                  tip: "Сделайте маленький шаг.",
                  teaser: "Что Звезда значит для вашего ближайшего месяца?",
                }),
              },
            ],
        stop_reason: refuse ? "refusal" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      };
      return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
    });

    const db = await createTestDb();
    const lead = await createLead(db, { name: "Анна", birthDate: "1990-03-15" }, morning, null);
    const row = await drawDailyCard(db, lead.id, 2, morning);
    expect(row).toMatchObject({ text: "Анна, сегодня Звезда напоминает о надежде.", model: "claude-opus-5-5" });
    expect(JSON.parse(row!.details!)).toEqual({
      love: "Доверьтесь близким.",
      work: "Запишите идеи.",
      tip: "Сделайте маленький шаг.",
      teaser: "Что Звезда значит для вашего ближайшего месяца?",
    });
    const req = requests[0]!;
    expect(req.url).toContain("api.anthropic.com/v1/messages");
    expect(req.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(req.body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "low", format: { type: "json_schema" } } });
    const prompt = JSON.stringify(req.body.messages);
    expect(prompt).toContain("Имя: Анна");
    expect(prompt).toContain("15.03.1990");

    refuse = true;
    const other = await createLead(db, { name: "Ира", birthDate: "1991-01-01" }, morning, null);
    const fallback = await drawDailyCard(db, other.id, 1, morning);
    expect(fallback).toMatchObject({ model: null, details: null, text: ARCANA[fallback!.card]!.advice });
  });
});
