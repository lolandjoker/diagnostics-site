/** Картинка сертификата эксперта — для его профиля. */
import { getDb } from "@/db";
import { getCertificate } from "@/lib/certificates";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/experts/[id]/certificates/[certId]">) {
  const { id, certId } = await ctx.params;
  if (!/^\d{1,9}$/.test(id) || !/^\d{1,9}$/.test(certId)) return new Response(null, { status: 404 });
  const cert = await getCertificate(await getDb(), Number(id), Number(certId));
  if (!cert) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(cert.data), {
    headers: {
      "Content-Type": cert.mime,
      // Сертификат не меняется: заменить — значит удалить и загрузить новый (с другим адресом)
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
