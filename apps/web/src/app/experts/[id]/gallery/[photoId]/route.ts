/** Дополнительное фото эксперта — для листания в профиле. */
import { getDb } from "@/db";
import { getGalleryPhoto } from "@/lib/gallery";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/experts/[id]/gallery/[photoId]">) {
  const { id, photoId } = await ctx.params;
  if (!/^\d{1,9}$/.test(id) || !/^\d{1,9}$/.test(photoId)) return new Response(null, { status: 404 });
  const photo = await getGalleryPhoto(await getDb(), Number(id), Number(photoId));
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.mime,
      // Фото не меняется: «сделать главным» переносит его в другое место с другим адресом
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
