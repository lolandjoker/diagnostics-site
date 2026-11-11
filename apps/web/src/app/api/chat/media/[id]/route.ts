/**
 * Фото и видео из общего хранилища чата (chat_media) — сообщения рассылки от экспертов. Адрес знает тот, кто
 * видит сообщение: id — uuid, не угадать. Видео отдаём частями (Range): без этого браузеры на iPhone его не играют.
 * Последние файлы держим в памяти (MEDIA_CACHE_ITEMS): рассылку открывают многие сразу, а видео — до 50 МБ.
 */
import { getDb } from "@/db";
import { getChatMedia } from "@/lib/chat";
import { isUuid } from "@/lib/leads";

export const dynamic = "force-dynamic";

const MEDIA_CACHE_ITEMS = 4;
type Media = { mime: string; data: Buffer };
const cache = ((globalThis as unknown as { __diagChatMedia?: Map<string, Media> }).__diagChatMedia ??= new Map());

async function load(id: string): Promise<Media | null> {
  const hit = cache.get(id);
  if (hit) {
    // Свежий — в конец очереди
    cache.delete(id);
    cache.set(id, hit);
    return hit;
  }
  const f = await getChatMedia(await getDb(), id);
  if (!f) return null;
  cache.set(id, f);
  while (cache.size > MEDIA_CACHE_ITEMS) cache.delete(cache.keys().next().value!);
  return f;
}

const headers = (mime: string) => ({
  "Content-Type": mime,
  "Accept-Ranges": "bytes",
  // Файл не меняется; private — не кэшировать на общих прокси
  "Cache-Control": "private, max-age=31536000, immutable",
  "Content-Security-Policy": "default-src 'none'",
});

export async function GET(req: Request, ctx: RouteContext<"/api/chat/media/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response(null, { status: 404 });
  const f = await load(id);
  if (!f) return new Response(null, { status: 404 });
  const size = f.data.length;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    // bytes=a-b, bytes=a- (до конца), bytes=-n (последние n)
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return new Response(new Uint8Array(f.data.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers(f.mime), "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(f.data), { headers: { ...headers(f.mime), "Content-Length": String(size) } });
}
