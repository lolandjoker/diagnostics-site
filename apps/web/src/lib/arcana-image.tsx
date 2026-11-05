/**
 * Картинки карты дня для бота (next/og): широкая плашка — карта слева, название и смыслы справа, — чтобы
 * в Telegram она не занимала пол-экрана. И пять рубашек для утреннего «выберите карту».
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { ARCANA, arcanaBackSvg, arcanaSymbolSvg } from "./arcana";

type Font = { name: string; data: ArrayBuffer; weight: 500 | 600 | 700; style: "normal" };
let fonts: Promise<Font[]> | null = null;

export function loadFonts(): Promise<Font[]> {
  const file = async (name: string, family: string, weight: Font["weight"]): Promise<Font> => {
    const buf = await readFile(path.join(process.cwd(), "assets/fonts", name));
    return { name: family, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), weight, style: "normal" };
  };
  fonts ??= Promise.all([
    file("manrope-cyrillic-500-normal.woff", "Manrope", 500),
    file("manrope-latin-500-normal.woff", "Manrope", 500),
    file("manrope-cyrillic-700-normal.woff", "Manrope", 700),
    file("manrope-latin-700-normal.woff", "Manrope", 700),
    file("cormorant-garamond-cyrillic-600-normal.woff", "Cormorant", 600),
    file("cormorant-garamond-latin-600-normal.woff", "Cormorant", 600),
  ]);
  return fonts;
}

export const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const GOLD = "#d9b66f";
const dateLabel = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long" });

/** Плашка карты, 1200×600; label — строка над названием (по умолчанию «Карта дня · дата»). */
export async function arcanaCardPng(index: number, now: Date, label?: string): Promise<Buffer> {
  const c = ARCANA[index] ?? ARCANA[0]!;
  const res = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 70px",
          background: "linear-gradient(110deg, #2a2047 0%, #160f29 60%, #0d0918 100%)",
          fontFamily: "Manrope",
          color: "#f2ecdf",
        }}
      >
        <div
          style={{
            width: 300,
            height: 480,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "30px 0 34px",
            borderRadius: 22,
            border: `2px solid ${GOLD}`,
            background: "linear-gradient(160deg, #2c214b, #120d22)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ fontFamily: "Cormorant", fontSize: 34, color: GOLD, letterSpacing: 4 }}>{c.n}</div>
          <img src={svgUri(arcanaSymbolSvg(index))} width={240} height={384} style={{ position: "absolute", top: 48 }} alt="" />
          <div style={{ fontFamily: "Cormorant", fontSize: c.name.length > 11 ? 30 : 38, color: "#f1d796" }}>{c.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 70, flexGrow: 1, minWidth: 0 }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: GOLD, letterSpacing: 5 }}>
            {label ?? `КАРТА ДНЯ · ${dateLabel.format(now).toUpperCase()}`}
          </div>
          <div style={{ fontFamily: "Cormorant", fontSize: 96, color: "#f1d796", lineHeight: 1.05, marginTop: 18 }}>{c.name}</div>
          <div style={{ fontSize: 30, color: "#c9bfd8", marginTop: 22, lineHeight: 1.4 }}>{c.keywords}</div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 40, fontSize: 24, color: "#a99fbe" }}>
            <div style={{ width: 40, height: 2, background: GOLD, marginRight: 16 }} />
            {`Таромба · аркан ${c.n}`}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 600, fonts: await loadFonts() },
  );
  return Buffer.from(await res.arrayBuffer());
}

/** Пять рубашек с номерами — к утреннему «выберите карту», 1200×420. */
export async function arcanaBacksPng(): Promise<Buffer> {
  const back = svgUri(arcanaBackSvg("b"));
  const res = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(110deg, #2a2047 0%, #160f29 60%, #0d0918 100%)",
          fontFamily: "Manrope",
        }}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "0 18px" }}>
            <img src={back} width={186} height={298} style={{ borderRadius: 14 }} alt="" />
            <div style={{ marginTop: 14, fontSize: 30, fontWeight: 700, color: GOLD, display: "flex" }}>{String(n)}</div>
          </div>
        ))}
      </div>
    ),
    { width: 1200, height: 420, fonts: await loadFonts() },
  );
  return Buffer.from(await res.arrayBuffer());
}
