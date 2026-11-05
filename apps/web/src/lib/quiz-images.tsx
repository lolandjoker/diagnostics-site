/**
 * Картинка результата теста «Ваш архетип» для сторис и TikTok, 1080×1920 (next/og). Без имени и даты
 * рождения — только архетип и адрес, по которому пройти тест самому: taromba.com/arhetip (источник в «Сводке»)
 * и бот, если он есть.
 */
import { ImageResponse } from "next/og";
import { arcanaSymbolSvg } from "./arcana";
import { loadFonts, svgUri } from "./arcana-image";
import { ARCHETYPES, type ArchetypeKey } from "./quiz-archetype";

const GOLD = "#d9b66f";

/** Звёзды на фоне — одни и те же на каждой картинке. */
const STARS = Array.from({ length: 70 }, (_, i) => ({ x: (i * 397) % 1080, y: (i * 233 + 57) % 1920, r: i % 4 === 0 ? 5 : i % 3 === 0 ? 3.5 : 2.5 }))
  // Только по краям и над заголовком — чтобы не ложились на текст и карту
  .filter((s) => s.x < 170 || s.x > 910 || s.y < 130);

export async function archetypeStoryPng(key: ArchetypeKey, site: string, bot: string | null): Promise<Buffer> {
  const a = ARCHETYPES[key];
  const symbol = svgUri(arcanaSymbolSvg(a.card).replace(/stroke-width="2(\.\d+)?"/g, 'stroke-width="2.6"'));
  const res = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          background: "radial-gradient(90% 60% at 50% 32%, #3a2a5e 0%, #1a1230 55%, #0b0816 100%)",
          fontFamily: "Manrope",
          color: "#f2ecdf",
          position: "relative",
        }}
      >
        {STARS.map((s, i) => (
          <div
            key={i}
            style={{ position: "absolute", left: s.x, top: s.y, width: s.r * 2, height: s.r * 2, borderRadius: 99, background: "#fff3d6", opacity: 0.55 }}
          />
        ))}
        <div style={{ marginTop: 170, fontSize: 40, fontWeight: 700, letterSpacing: 14, color: GOLD, display: "flex" }}>МОЙ АРХЕТИП</div>
        <div
          style={{
            marginTop: 70,
            width: 440,
            height: 704,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 34,
            border: `3px solid ${GOLD}`,
            background: "linear-gradient(160deg, #2e2250, #140e26)",
            boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
            position: "relative",
          }}
        >
          <div style={{ position: "absolute", top: 18, left: 18, right: 18, bottom: 18, borderRadius: 24, border: "1px solid rgba(217,182,111,0.45)", display: "flex" }} />
          <img src={symbol} width={400} height={640} alt="" />
        </div>
        <div style={{ marginTop: 80, fontFamily: "Cormorant", fontSize: 170, lineHeight: 1, color: "#f1d796", display: "flex" }}>{a.name}</div>
        <div style={{ marginTop: 28, fontSize: 48, color: "#e4dcef", display: "flex" }}>{a.tagline}</div>
        <div style={{ marginTop: 44, display: "flex" }}>
          {a.keywords.map((k) => (
            <div
              key={k}
              style={{ margin: "0 12px", padding: "12px 30px", border: "2px solid rgba(217,182,111,0.55)", borderRadius: 99, fontSize: 34, color: "#ead7a8", display: "flex" }}
            >
              {k}
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", bottom: 150, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ fontSize: 38, color: "#b9aecd", display: "flex" }}>Узнайте свой архетип</div>
          <div
            style={{ marginTop: 22, padding: "20px 54px", borderRadius: 99, background: GOLD, color: "#1a1328", fontSize: 50, fontWeight: 700, display: "flex" }}
          >
            {`${site}/arhetip`}
          </div>
          {bot && <div style={{ marginTop: 24, fontSize: 34, color: "#b9aecd", display: "flex" }}>{`или в Telegram: @${bot}`}</div>}
        </div>
      </div>
    ),
    { width: 1080, height: 1920, fonts: await loadFonts() },
  );
  return Buffer.from(await res.arrayBuffer());
}
