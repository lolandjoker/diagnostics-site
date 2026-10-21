import { GET } from "./route";

describe("GET /api/health", () => {
  it("отвечает 200 и статусом ok", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("не кэшируется", () => {
    expect(GET().headers.get("Cache-Control")).toBe("no-store");
  });
});
