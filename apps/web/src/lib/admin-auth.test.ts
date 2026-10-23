import {
  authConfig,
  checkPassword,
  createSessionToken,
  loginBlocked,
  recordLoginFail,
  resetLoginFails,
  verifySessionToken,
} from "./admin-auth";

const env = { ADMIN_PASSWORD: "очень-длинный-пароль", SESSION_SECRET: "s".repeat(40) };
const cfg = authConfig(env);
if (typeof cfg === "string") throw new Error(cfg);
const NOW = 1_800_000_000_000;

describe("настройки входа", () => {
  it("без пароля или с коротким секретом вход выключен", () => {
    expect(authConfig({})).toMatch("ADMIN_PASSWORD");
    expect(authConfig({ ...env, ADMIN_PASSWORD: "short" })).toMatch("ADMIN_PASSWORD");
    expect(authConfig({ ...env, SESSION_SECRET: "short" })).toMatch("SESSION_SECRET");
  });

  it("пароль сверяется точно", () => {
    expect(checkPassword("очень-длинный-пароль", cfg)).toBe(true);
    expect(checkPassword("очень-длинный-парол", cfg)).toBe(false);
    expect(checkPassword("", cfg)).toBe(false);
  });
});

describe("сессия", () => {
  const token = createSessionToken(NOW, cfg);

  it("действует 7 дней", () => {
    expect(verifySessionToken(token, NOW, cfg)).toBe(true);
    expect(verifySessionToken(token, NOW + 7 * 86_400_000 - 1, cfg)).toBe(true);
    expect(verifySessionToken(token, NOW + 7 * 86_400_000 + 1, cfg)).toBe(false);
  });

  it("подделка и мусор не проходят", () => {
    const [exp, mac] = token.split(".");
    expect(verifySessionToken(`${Number(exp) + 1000}.${mac}`, NOW, cfg)).toBe(false);
    expect(verifySessionToken(`${exp}.${mac}x`, NOW, cfg)).toBe(false);
    expect(verifySessionToken(undefined, NOW, cfg)).toBe(false);
    expect(verifySessionToken("abc", NOW, cfg)).toBe(false);
  });

  it("смена пароля или секрета завершает сессии", () => {
    const other = authConfig({ ...env, ADMIN_PASSWORD: "другой-длинный-пароль" });
    const otherSecret = authConfig({ ...env, SESSION_SECRET: "t".repeat(40) });
    if (typeof other === "string" || typeof otherSecret === "string") throw new Error("config");
    expect(verifySessionToken(token, NOW, other)).toBe(false);
    expect(verifySessionToken(token, NOW, otherSecret)).toBe(false);
  });
});

describe("ограничение попыток", () => {
  it("5 неудач за 15 минут — блок; через 15 минут — снова можно", () => {
    const ip = "203.0.113.7";
    resetLoginFails(ip);
    for (let i = 0; i < 4; i++) recordLoginFail(ip, NOW + i);
    expect(loginBlocked(ip, NOW + 10)).toBe(false);
    recordLoginFail(ip, NOW + 5);
    expect(loginBlocked(ip, NOW + 10)).toBe(true);
    expect(loginBlocked("203.0.113.8", NOW + 10)).toBe(false);
    expect(loginBlocked(ip, NOW + 15 * 60_000 + 10)).toBe(false);
  });
});
