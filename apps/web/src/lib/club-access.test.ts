import { clubUnlocked } from "./club-access";

describe("результат клуба: Telegram или почта", () => {
  const tg = (connected: boolean) => ({ connected, href: "https://t.me/bot?start=x" });
  it("закрыт без Telegram и без почты; открыт с любым из двух; бот выключен — открыт", () => {
    expect(clubUnlocked({ email: null }, tg(false))).toBe(false);
    expect(clubUnlocked({ email: "anna@mail.ru" }, tg(false))).toBe(true);
    expect(clubUnlocked({ email: null }, tg(true))).toBe(true);
    expect(clubUnlocked({ email: null }, null)).toBe(true);
  });
});
