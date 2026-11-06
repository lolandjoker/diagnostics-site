/**
 * Геолокация клиента по IP — по базе DB-IP City Lite (CC BY 4.0, пакет @ip-location-db/dbip-city-mmdb)
 * прямо на нашем сервере: IP никуда не уходит и не сохраняется, в заявку пишем только страну и город.
 * IP — первый адрес X-Forwarded-For: Caddy подставляет туда адрес клиента сам.
 * База IPv4 загружается при первом запросе (≈60 МБ в памяти), IPv6 — только если встретится такой адрес.
 */
import { isIP } from "node:net";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { type Reader, type Response, open } from "maxmind";
import { headers } from "next/headers";
import type { Db } from "@/db";
import { leads } from "@/db/schema";
import { rememberedLeadId } from "./leads";

interface GeoRecord {
  city?: string;
  country_code?: string;
}

export interface Geo {
  country: string;
  city: string | null;
}

const DIR = () => path.join(process.cwd(), "node_modules/@ip-location-db/dbip-city-mmdb");

/** Базы — общие для процесса (route handlers и серверные действия — разные экземпляры модуля). */
const holder = globalThis as unknown as { __diagGeo?: Partial<Record<4 | 6, Promise<Reader<Response> | null>>> };
const readers = (holder.__diagGeo ??= {});

function reader(version: 4 | 6): Promise<Reader<Response> | null> {
  readers[version] ??= open(path.join(DIR(), `dbip-city-ipv${version}.mmdb`)).catch((err: unknown) => {
    console.warn(`Геобаза IPv${version}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  return readers[version]!;
}

/** Локальные и служебные адреса — не клиент. */
function isPrivate(ip: string): boolean {
  return (
    /^(10\.|127\.|169\.254\.|192\.168\.|0\.)/.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) ||
    /^(::1$|f[cd]|fe80:)/i.test(ip)
  );
}

export async function lookupIp(raw: string | null | undefined): Promise<Geo | null> {
  const ip = raw?.trim().replace(/^::ffff:/, "") ?? "";
  const version = isIP(ip);
  if (version === 0 || isPrivate(ip)) return null;
  try {
    const r = await reader(version === 6 ? 6 : 4);
    const rec = r?.get(ip) as GeoRecord | null | undefined;
    if (!rec?.country_code) return null;
    return { country: rec.country_code.toUpperCase(), city: rec.city?.trim() || null };
  } catch {
    return null;
  }
}

/** IP клиента из заголовков запроса. */
export function clientIp(h: Headers): string | null {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || null;
}

/**
 * Старая заявка без геолокации: владелец (заявка запомнена в этом браузере) открыл свою страницу —
 * определяем по текущему IP. Чужой браузер (например, сотрудник по ссылке) не трогаем.
 */
export async function backfillLeadGeo(db: Db, lead: { id: string; geoCountry: string | null }): Promise<void> {
  if (lead.geoCountry) return;
  if ((await rememberedLeadId()) !== lead.id) return;
  await rememberLeadGeo(db, lead.id, clientIp(await headers())).catch(() => {});
}

/** Записать геолокацию в заявку, если её там ещё нет. */
export async function rememberLeadGeo(db: Db, leadId: string, ip: string | null): Promise<void> {
  const geo = await lookupIp(ip);
  if (!geo) return;
  await db
    .update(leads)
    .set({ geoCountry: geo.country, geoCity: geo.city })
    .where(and(eq(leads.id, leadId), isNull(leads.geoCountry)));
}
