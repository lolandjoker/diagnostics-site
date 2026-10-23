/** Фото эксперта для карточки на сайте. */
import { getDb } from "@/db";
import { getExpertPhoto } from "@/lib/experts";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/experts/[id]/photo">) {
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return new Response(null, { status: 404 });
  const photo = await getExpertPhoto(await getDb(), Number(id));
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.mime,
      // Адрес фото меняется (?v=…) при каждой замене, поэтому кэшировать можно надолго
      "Cache-Control": "public, max-age=86400",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
