import { messagePayload } from "./http";

const URL_ = "http://localhost/api/chat/x";
const LIMIT = 1024 * 1024;

describe("тело отправки в чат", () => {
  it("JSON: текст и предложение продукта", async () => {
    const req = new Request(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "привет", productId: 3 }),
    });
    expect(await messagePayload(req, LIMIT)).toEqual({ body: "привет", productId: 3 });
  });

  it("JSON: productId не число — не берётся", async () => {
    const req = new Request(URL_, { method: "POST", body: JSON.stringify({ body: "а", productId: "3" }) });
    expect(await messagePayload(req, LIMIT)).toEqual({ body: "а" });
  });

  it("form-data: подпись и фото", async () => {
    const form = new FormData();
    form.set("body", "смотрите");
    form.set("photo", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2])], { type: "image/jpeg" }), "p.jpg");
    const res = await messagePayload(new Request(URL_, { method: "POST", body: form }), LIMIT);
    if (typeof res === "string") throw new Error(res);
    expect(res.body).toBe("смотрите");
    expect(res.photo && [...res.photo]).toEqual([0xff, 0xd8, 0xff, 1, 2]);
  });

  it("слишком большой запрос отклоняется по заголовку, тело не читается", async () => {
    const req = new Request(URL_, {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=x", "Content-Length": String(LIMIT * 2) },
      body: "x",
    });
    expect(typeof (await messagePayload(req, LIMIT))).toBe("string");
  });
});
