/** «Сводка» → «География»: сколько заявок и чатов из каких стран и городов (по IP при заявке, lib/geo.ts). */
import { and, count, desc, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, leads } from "@/db/schema";
import { within } from "./period";

export interface GeoRow {
  country: string;
  /** null — строка страны целиком. */
  city: string | null;
  leads: number;
  /** Из них начали чат с экспертом. */
  chats: number;
}

export interface GeoStats {
  countries: GeoRow[];
  cities: GeoRow[];
  /** Заявки без геолокации (старые, до того как начали определять, или IP не нашёлся в базе). */
  unknown: number;
}

const CITY_LIMIT = 15;

export async function geoStats(db: Db, since: Date | null, until: Date | null = null): Promise<GeoStats> {
  const period = within(leads.createdAt, since, until);
  const chats = sql<number>`count(*) filter (where exists (select 1 from ${conversations} c where c.lead_id = "leads"."id"))`.mapWith(Number);
  const [countries, cities, [unknown]] = await Promise.all([
    db
      .select({ country: leads.geoCountry, leads: count(), chats })
      .from(leads)
      .where(and(isNotNull(leads.geoCountry), period))
      .groupBy(leads.geoCountry)
      .orderBy(desc(count())),
    db
      .select({ country: leads.geoCountry, city: leads.geoCity, leads: count(), chats })
      .from(leads)
      .where(and(isNotNull(leads.geoCountry), isNotNull(leads.geoCity), period))
      .groupBy(leads.geoCountry, leads.geoCity)
      .orderBy(desc(count()))
      .limit(CITY_LIMIT),
    db
      .select({ n: count() })
      .from(leads)
      .where(and(isNull(leads.geoCountry), period)),
  ]);
  return {
    countries: countries.map((r) => ({ country: r.country!, city: null, leads: Number(r.leads), chats: r.chats })),
    cities: cities.map((r) => ({ country: r.country!, city: r.city, leads: Number(r.leads), chats: r.chats })),
    unknown: Number(unknown?.n ?? 0),
  };
}
