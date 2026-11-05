/**
 * Плашка эксперта для сообщений бота — узкая картинка, как шапка чата на сайте: круглое фото, имя,
 * специализация, ★ рейтинг и статус. Подпись под картинкой — само сообщение эксперта.
 * Рисуется на сервере (next/og), шрифт — Manrope, как на сайте.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { ExpertStatus } from "./experts";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 240;

type Font = { name: string; data: ArrayBuffer; weight: 500 | 700; style: "normal" };
let fonts: Promise<Font[]> | null = null;

/** Manrope из assets/fonts: кириллица и латиница, 500 и 700 (satori читает woff, не woff2). */
function loadFonts(): Promise<Font[]> {
  fonts ??= Promise.all(
    (["cyrillic", "latin"] as const).flatMap((subset) =>
      ([500, 700] as const).map(async (weight) => {
        const buf = await readFile(path.join(process.cwd(), "assets/fonts", `manrope-${subset}-${weight}-normal.woff`));
        return { name: "Manrope", data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), weight, style: "normal" as const };
      }),
    ),
  );
  return fonts;
}

export interface CardExpert {
  /** «Ксения Никитина | Нумеролог» — до черты имя, после — специализация. */
  name: string;
  /** Рейтинг в десятых (46 → 4,6). */
  rating: number;
  status: ExpertStatus;
  photo: { mime: string; data: Buffer } | null;
}

const STATUS: Record<ExpertStatus, { label: string; color: string } | null> = {
  online: { label: "в сети", color: "#5fd08a" },
  busy: { label: "на консультации", color: "#e8b65a" },
  offline: null,
};

const GOLD = "#e2bf78";

export function splitExpertName(full: string): { name: string; role: string } {
  const i = full.indexOf("|");
  return i < 0 ? { name: full.trim(), role: "" } : { name: full.slice(0, i).trim(), role: full.slice(i + 1).trim() };
}

/** PNG плашки эксперта. */
export async function expertCardPng(e: CardExpert): Promise<Buffer> {
  const { name, role } = splitExpertName(e.name);
  const status = STATUS[e.status];
  // Фото — маленьким PNG: satori не читает WebP, а большое фото только замедляет отрисовку
  const small = e.photo ? await sharp(e.photo.data).resize(336, 336, { fit: "cover" }).png().toBuffer().catch(() => null) : null;
  const photo = small ? `data:image/png;base64,${small.toString("base64")}` : null;
  const initial = name.slice(0, 1).toUpperCase();
  const rating = (e.rating / 10).toFixed(1).replace(".", ",");

  const res = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 56px",
          fontFamily: "Manrope",
          color: "#f4eee2",
          background: "linear-gradient(100deg, #231a3d 0%, #160f29 55%, #0d0918 100%)",
        }}
      >
        <div style={{ position: "relative", display: "flex", width: 168, height: 168, flexShrink: 0 }}>
          {photo ? (
            <img
              src={photo}
              width={168}
              height={168}
              style={{ borderRadius: 84, objectFit: "cover", border: `3px solid ${GOLD}55` }}
              alt=""
            />
          ) : (
            <div
              style={{
                width: 168,
                height: 168,
                borderRadius: 84,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 72,
                fontWeight: 700,
                color: GOLD,
                background: "#2c2148",
              }}
            >
              {initial}
            </div>
          )}
          {status && (
            <div
              style={{
                position: "absolute",
                right: 6,
                bottom: 6,
                width: 34,
                height: 34,
                borderRadius: 17,
                background: status.color,
                border: "6px solid #1b1430",
              }}
            />
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginLeft: 40, flexGrow: 1, minWidth: 0 }}>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {name}
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 14, fontSize: 38, fontWeight: 500 }}>
            {role && <span style={{ color: "#c9bfd8", marginRight: 28 }}>{role}</span>}
            <svg width="36" height="36" viewBox="0 0 24 24" style={{ marginRight: 10 }}>
              <path fill={GOLD} d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" />
            </svg>
            <span style={{ color: GOLD, fontWeight: 700 }}>{rating}</span>
            {status && (
              <span style={{ display: "flex", alignItems: "center", marginLeft: 28, color: status.color }}>
                <span style={{ width: 14, height: 14, borderRadius: 7, background: status.color, marginRight: 12 }} />
                {status.label}
              </span>
            )}
          </div>
        </div>
      </div>
    ),
    { width: CARD_WIDTH, height: CARD_HEIGHT, fonts: await loadFonts() },
  );
  return Buffer.from(await res.arrayBuffer());
}
