import { createTestDb } from "@/db";
import { ADMIN_CODE_MS, adminLoginCode, isOwner, ownerFromAdminCode, ownerTelegramIds } from "./owner";
import { botReply } from "./telegram";

const TOKEN = "123456789:AAHtestTOKENtestTOKENtestTOKENtest12";
const env = { OWNER_TELEGRAM_IDS: "837224525, 42" };
const now = new Date("2026-11-07T10:00:00Z");

describe("вход владельца из Telegram", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ID владельцев из .env; код входа — подпись ключом бота, 10 минут, только владельцу", () => {
    expect([...ownerTelegramIds(env)]).toEqual([837224525, 42]);
    expect(ownerTelegramIds({})).toEqual(new Set());
    expect(isOwner(837224525, env)).toBe(true);
    expect(isOwner(1, env)).toBe(false);

    const code = adminLoginCode(TOKEN, 837224525, now);
    expect(ownerFromAdminCode(TOKEN, code, now, env)).toBe(837224525);
    expect(ownerFromAdminCode(TOKEN, code, new Date(now.getTime() + ADMIN_CODE_MS + 1000), env)).toBeNull();
    expect(ownerFromAdminCode("999:other", code, now, env)).toBeNull();
    // Подделка: чужой ID с той же подписью
    expect(ownerFromAdminCode(TOKEN, code.replace("837224525", "42"), now, env)).toBeNull();
    // Код выдан тому, кого уже нет среди владельцев
    expect(ownerFromAdminCode(TOKEN, code, now, { OWNER_TELEGRAM_IDS: "42" })).toBeNull();
    expect(ownerFromAdminCode(TOKEN, "мусор", now, env)).toBeNull();
  });

  it("бот: /admin владельцу — кнопки входа, остальным — обычный ответ", async () => {
    vi.stubEnv("OWNER_TELEGRAM_IDS", "837224525");
    const db = await createTestDb();
    const cfg = { token: TOKEN, siteUrl: "https://example.com" };
    const mine = await botReply(db, cfg, 837224525, "/admin", now);
    expect(mine.text).toContain("Вход в админку");
    expect(mine.buttons.map((b) => b.text)).toEqual(["Админка в Telegram", "Админка в браузере"]);
    const b0 = mine.buttons[0]!;
    expect("webApp" in b0 && b0.webApp).toMatch(/^https:\/\/example\.com\/admin\/telegram\?t=837224525\.\d+\.[0-9a-f]{32}$/);
    const other = await botReply(db, cfg, 1001, "/admin", now);
    expect(other.text).not.toContain("Вход в админку");
  });
});
