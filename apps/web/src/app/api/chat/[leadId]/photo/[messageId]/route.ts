/** Фото из чата. Доступ — как к самому чату: по id заявки в адресе. */
import { getDb } from "@/db";
import { getMessagePhoto } from "@/lib/chat";
import { isUuid } from "@/lib/leads";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/chat/[leadId]/photo/[messageId]">) {
  const { leadId, messageId } = await ctx.params;
  if (!isUuid(leadId) || !/^\d{1,10}$/.test(messageId)) return new Response(null, { status: 404 });
  const photo = await getMessagePhoto(await getDb(), leadId, Number(messageId));
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.mime,
      // Фото сообщения не меняется; private — не кэшировать на общих прокси
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
